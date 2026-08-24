"""Per-job TMDB telemetry collection.

Every desktop-worker job (and inline scrape) creates one ``TmdbCollector`` and
installs it as the current context via :func:`collecting` (an asyncio-friendly
``ContextVar`` scope). ``tmdb_client.tmdb_get`` reports every cache lookup,
outbound request, retry, 429 and error to whichever collector is active — so
concurrent jobs each see only their own numbers. No module-global mutable
counters: two collectors never mix.

Privacy: collectors only accumulate integers and endpoint-family names.
Usernames, film titles, query strings and API keys must never be passed in.
"""

from __future__ import annotations

import time
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Any, Iterator

# Endpoint families we distinguish. Anything else falls into "other".
SEARCH_FAMILY = "search"
METADATA_FAMILY = "metadata"


def endpoint_family(endpoint: str) -> str:
    """Classify a TMDB endpoint path into a coarse family for counting."""
    if endpoint.startswith("search/"):
        return SEARCH_FAMILY
    if endpoint.startswith("movie/"):
        return METADATA_FAMILY
    return "other"


class TmdbCollector:
    """Mutable per-job aggregate of TMDB activity.

    All mutations happen inside ``tmdb_get`` on the same event loop as the job,
    so no locking is needed; the ContextVar binding is what keeps concurrent
    jobs isolated (each asyncio task inherits its own copy).
    """

    __slots__ = (
        "cache_hits",
        "cache_misses",
        "outbound_requests",
        "empty_results",
        "network_errors",
        "retries",
        "tmdb_429s",
        "_by_family",
        "_started",
        "_tmdb_match_seconds",
        "_tmdb_metadata_seconds",
    )

    def __init__(self) -> None:
        self.cache_hits: int = 0
        self.cache_misses: int = 0
        self.outbound_requests: int = 0
        self.empty_results: int = 0
        self.network_errors: int = 0
        self.retries: int = 0
        self.tmdb_429s: int = 0
        self._by_family: dict[str, dict[str, int]] = {}
        self._started = time.monotonic()
        self._tmdb_match_seconds: float | None = None
        self._tmdb_metadata_seconds: float | None = None

    # -- family bookkeeping -------------------------------------------------

    def _family(self, family: str) -> dict[str, int]:
        bucket = self._by_family.get(family)
        if bucket is None:
            bucket = {
                "cache_hits": 0,
                "cache_misses": 0,
                "outbound_requests": 0,
                "empty_results": 0,
                "network_errors": 0,
                "retries": 0,
                "tmdb_429s": 0,
            }
            self._by_family[family] = bucket
        return bucket

    # -- recording hooks (called by tmdb_client) -----------------------------

    def record_cache_hit(self, family: str) -> None:
        self.cache_hits += 1
        self._family(family)["cache_hits"] += 1

    def record_cache_miss(self, family: str) -> None:
        self.cache_misses += 1
        self._family(family)["cache_misses"] += 1

    def record_outbound_request(self, family: str) -> None:
        self.outbound_requests += 1
        self._family(family)["outbound_requests"] += 1

    def record_empty_result(self, family: str) -> None:
        self.empty_results += 1
        self._family(family)["empty_results"] += 1

    def record_retry(self, family: str) -> None:
        """One extra attempt after a 429 backoff sleep."""
        self.retries += 1
        self._family(family)["retries"] += 1

    def record_429(self, family: str) -> None:
        self.tmdb_429s += 1
        self._family(family)["tmdb_429s"] += 1

    def record_network_error(self, family: str) -> None:
        self.network_errors += 1
        self._family(family)["network_errors"] += 1

    # -- stage timings (set by analysis pipeline) ----------------------------

    def set_tmdb_match_seconds(self, seconds: float | int) -> None:
        self._tmdb_match_seconds = round(float(seconds), 3)

    def set_tmdb_metadata_seconds(self, seconds: float | int) -> None:
        self._tmdb_metadata_seconds = round(float(seconds), 3)

    # -- snapshot -------------------------------------------------------------

    def snapshot(self) -> dict[str, Any]:
        """Aggregate payload for worker postback / run log.

        Integer counts + endpoint-family breakdown + stage timings only — no
        request content. ``elapsed_seconds`` is wall time under collection.
        """
        return {
            "tmdb_match_seconds": self._tmdb_match_seconds,
            "tmdb_metadata_seconds": self._tmdb_metadata_seconds,
            "local_statistics_seconds": self._statistics_seconds(),
            "cache_hits": self.cache_hits,
            "cache_misses": self.cache_misses,
            "outbound_requests": self.outbound_requests,
            "empty_results": self.empty_results,
            "network_errors": self.network_errors,
            "retries": self.retries,
            "tmdb_429s": self.tmdb_429s,
            "by_endpoint_family": {name: dict(bucket) for name, bucket in sorted(self._by_family.items())},
        }

    def _statistics_seconds(self) -> float | None:
        """Wall seconds spent computing local statistics.

        Approximated as collector lifetime minus TMDB match/metadata windows
        when those are known; otherwise the plain elapsed time. Good enough for
        per-job observability without threading timers through every compute_*.
        """
        elapsed = time.monotonic() - self._started
        tmdb_window = 0.0
        if self._tmdb_match_seconds is not None:
            tmdb_window += self._tmdb_match_seconds
        if self._tmdb_metadata_seconds is not None:
            tmdb_window += self._tmdb_metadata_seconds
        local = elapsed - tmdb_window
        return round(max(0.0, local), 3)


_CURRENT_COLLECTOR: ContextVar[TmdbCollector | None] = ContextVar("tmdb_collector", default=None)


@contextmanager
def collecting(collector: TmdbCollector) -> Iterator[TmdbCollector]:
    """Bind ``collector`` as the current job's collector within the block.

    ContextVar-based: async child tasks spawned inside the block inherit it;
    sibling/concurrent jobs with their own ``collecting`` scope do not.
    """
    token: Token = _CURRENT_COLLECTOR.set(collector)
    try:
        yield collector
    finally:
        _CURRENT_COLLECTOR.reset(token)


def current() -> TmdbCollector | None:
    """The active collector for this task, or None when not collecting."""
    return _CURRENT_COLLECTOR.get()
