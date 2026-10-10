"""Single-slot Camoufox pool for the X370 worker.

Rewritten from the 2026-08-29 decision (original file was never in git):
one warm persistent context, challenge wait, empty-doc retry, three consecutive
navigation timeouts recreate the slot on the same profile. Concurrency is 1.
Render must not import this module — scraper.py loads it only when
SCRAPE_TRANSPORT=stealth_browser.
"""
from __future__ import annotations

from dataclasses import dataclass
import logging
import os
from pathlib import Path
import threading
from typing import Any, Optional

logger = logging.getLogger("letterboxd_wrapped.camoufox_pool")

NAV_TIMEOUT_LIMIT = 3
EMPTY_HTML_MIN = 500
GOTO_TIMEOUT_MS = 45_000
CHALLENGE_WAIT_MS = 25_000
DEFAULT_RESTART_EVERY = 8


class SlotDeadError(RuntimeError):
    """Browser slot wedged (repeated navigation timeouts). Recreate and retry."""


@dataclass
class BrowserResponse:
    status_code: int
    text: str
    url: str = ""


def _profile_dir() -> Path:
    raw = os.getenv("CAMOUFOX_PROFILE_DIR") or str(
        Path.home() / ".local" / "share" / "movieswrapped" / "camoufox-profile"
    )
    path = Path(raw).expanduser()
    path.mkdir(parents=True, exist_ok=True)
    return path


def _restart_every() -> int:
    try:
        value = int(os.getenv("CAMOUFOX_RESTART_EVERY", str(DEFAULT_RESTART_EVERY)))
    except ValueError:
        value = DEFAULT_RESTART_EVERY
    return max(1, value)


def _looks_like_challenge(html: str) -> bool:
    head = html[:1000]
    return ("Just a moment" in head and "challenges.cloudflare.com" in head) or (
        "Attention Required! | Cloudflare" in html[:500]
    )


class CamoufoxPool:
    def __init__(
        self,
        *,
        profile_dir: Optional[Path] = None,
        restart_every: Optional[int] = None,
        browser_factory: Optional[Any] = None,
    ) -> None:
        self.profile_dir = profile_dir or _profile_dir()
        self.restart_every = restart_every or _restart_every()
        self._browser_factory = browser_factory
        self._lock = threading.Lock()
        self._cm = None
        self._browser = None
        self._page = None
        self._jobs_on_browser = 0
        self._nav_timeouts = 0

    def fetch_sync(self, url: str, timeout: int = 45) -> BrowserResponse:
        with self._lock:
            return self._fetch_locked(url, timeout=timeout)

    def note_job_done(self) -> None:
        with self._lock:
            self._jobs_on_browser += 1
            if self._jobs_on_browser >= self.restart_every:
                logger.info("Restarting Camoufox after %s jobs", self._jobs_on_browser)
                self._close_locked()

    def restart(self) -> None:
        with self._lock:
            self._close_locked()

    def close(self) -> None:
        with self._lock:
            self._close_locked()

    def _fetch_locked(self, url: str, timeout: int) -> BrowserResponse:
        last_error: Optional[Exception] = None
        for attempt in range(2):
            try:
                self._ensure_browser()
                return self._goto(url, timeout=timeout)
            except SlotDeadError as exc:
                last_error = exc
                logger.warning("Camoufox slot dead (%s); recreating profile session", exc)
                self._close_locked()
            except Exception as exc:  # noqa: BLE001 — surface as empty response, scraper raises
                last_error = exc
                logger.warning("Camoufox fetch failed for %s: %s", url, exc)
                break
        logger.error("Camoufox could not fetch %s: %s", url, last_error)
        return BrowserResponse(status_code=0, text="", url=url)

    def _ensure_browser(self) -> None:
        if self._page is not None:
            return
        factory = self._browser_factory or _launch_camoufox
        cm, browser, page = factory(self.profile_dir)
        self._cm = cm
        self._browser = browser
        self._page = page
        self._jobs_on_browser = 0
        self._nav_timeouts = 0

    def _close_locked(self) -> None:
        cm, page, browser = self._cm, self._page, self._browser
        self._cm = None
        self._page = None
        self._browser = None
        self._jobs_on_browser = 0
        self._nav_timeouts = 0
        for obj in (page, browser):
            closer = getattr(obj, "close", None)
            if callable(closer):
                try:
                    _run_maybe_async(closer)
                except Exception:  # noqa: BLE001
                    pass
        if cm is not None:
            exit_cm = getattr(cm, "__exit__", None)
            if callable(exit_cm):
                try:
                    exit_cm(None, None, None)
                except Exception:  # noqa: BLE001
                    pass

    def _goto(self, url: str, timeout: int) -> BrowserResponse:
        page = self._page
        if page is None:
            raise SlotDeadError("no page")
        timeout_ms = max(int(timeout * 1000), GOTO_TIMEOUT_MS)
        try:
            _run_maybe_async(page.goto, url, wait_until="domcontentloaded", timeout=timeout_ms)
            self._nav_timeouts = 0
        except Exception as exc:
            if not _is_timeout(exc):
                raise
            self._nav_timeouts += 1
            logger.warning("Camoufox nav timeout %s/%s on %s", self._nav_timeouts, NAV_TIMEOUT_LIMIT, url)
            if self._nav_timeouts >= NAV_TIMEOUT_LIMIT:
                raise SlotDeadError(f"{self._nav_timeouts} consecutive navigation timeouts") from exc
            return BrowserResponse(status_code=0, text="", url=url)

        html = str(_run_maybe_async(page.content) or "")
        if _looks_like_challenge(html):
            logger.info("Cloudflare challenge on %s; waiting", url)
            try:
                _run_maybe_async(
                    getattr(page, "wait_for_function", lambda *a, **k: None),
                    "() => !document.title.includes('Just a moment')",
                    timeout=CHALLENGE_WAIT_MS,
                )
            except Exception:
                pass
            html = str(_run_maybe_async(page.content) or "")

        if len(html) < EMPTY_HTML_MIN:
            logger.warning("Empty document (%s bytes) for %s; retrying once", len(html), url)
            try:
                _run_maybe_async(page.goto, url, wait_until="domcontentloaded", timeout=timeout_ms)
                html = str(_run_maybe_async(page.content) or "")
            except Exception as exc:
                if _is_timeout(exc):
                    self._nav_timeouts += 1
                    if self._nav_timeouts >= NAV_TIMEOUT_LIMIT:
                        raise SlotDeadError("empty-doc retry timed out") from exc
                html = ""
            if len(html) < EMPTY_HTML_MIN:
                return BrowserResponse(status_code=0, text=html, url=url)

        if _looks_like_challenge(html):
            return BrowserResponse(status_code=403, text=html, url=url)
        return BrowserResponse(status_code=200, text=html, url=url)


_POOL: Optional[CamoufoxPool] = None
_POOL_GUARD = threading.Lock()


def get_pool() -> CamoufoxPool:
    global _POOL
    with _POOL_GUARD:
        if _POOL is None:
            _POOL = CamoufoxPool()
        return _POOL


def fetch_sync(url: str, timeout: int = 45) -> BrowserResponse:
    return get_pool().fetch_sync(url, timeout=timeout)


def note_job_done() -> None:
    get_pool().note_job_done()


def close_pool() -> None:
    global _POOL
    with _POOL_GUARD:
        if _POOL is not None:
            _POOL.close()
            _POOL = None


def _is_timeout(exc: BaseException) -> bool:
    name = type(exc).__name__.lower()
    return "timeout" in name or "timeout" in str(exc).lower()


def _run_maybe_async(fn, *args, **kwargs):
    if not callable(fn):
        return fn
    result = fn(*args, **kwargs)
    import asyncio

    if asyncio.iscoroutine(result):
        return asyncio.run(result)
    return result


def _launch_camoufox(profile_dir: Path):
    try:
        from camoufox.sync_api import Camoufox
    except ImportError as exc:
        raise RuntimeError(
            "camoufox is not installed. On the X370 run scripts/install-x370-worker.sh"
        ) from exc

    kwargs = {
        "headless": True,
        "persistent_context": True,
        "user_data_dir": str(profile_dir),
        "os": "linux",
    }
    cm = Camoufox(**kwargs)
    browser = cm.__enter__()
    page = browser.new_page()
    return cm, browser, page
