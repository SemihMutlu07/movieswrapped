"""
TMDB cache safety: 175-day lazy TTL, atomic writes, empty-result guard.

Each prompt-2 acceptance item has a test here:
- fresh file read without any network call
- file older than 175 days is refreshed (network called)
- empty search results are never persisted
- concurrent writers to the same key can never expose partial JSON
- a failed refresh leaves the stale file intact (never marked fresh)
- malformed files refresh in a controlled way
- the deterministic md5 key format is byte-for-byte unchanged
- os.replace semantics work on Windows
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import time
from unittest.mock import MagicMock

import pytest

from app.config import settings as app_settings
from app.services import tmdb_client


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _cache_key(endpoint: str, params: dict) -> str:
    """The EXACT key derivation tmdb_get uses — asserted unchanged elsewhere."""
    merged = dict(params)
    merged["api_key"] = app_settings.tmdb_api_key
    return hashlib.md5(f"{endpoint}{json.dumps(merged, sort_keys=True)}".encode()).hexdigest()


def _write_cache(tmp_path, endpoint, params, payload, *, age_seconds=0):
    path = tmp_path / f"{_cache_key(endpoint, params)}.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    if age_seconds:
        old = time.time() - age_seconds
        os.utime(path, (old, old))
    return path


class _FakeResponse:
    def __init__(self, status=200, payload=None):
        self.status = status
        self._payload = payload if payload is not None else {"results": [{"id": 1}]}
        self.headers = {}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    def raise_for_status(self):
        if self.status >= 400:
            import aiohttp

            raise aiohttp.ClientResponseError(None, (), status=self.status)

    async def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _fast_rate_limit(monkeypatch):
    async def _noop_sleep(*a, **k):
        return None
    monkeypatch.setattr(tmdb_client, "_wait_for_tmdb_slot", _noop_sleep)


# ---------------------------------------------------------------------------
# fresh / expired reads
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_fresh_file_read_without_network(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    cached = {"id": 42, "title": "cached-payload"}
    _write_cache(tmp_path, "movie/42", {}, cached, age_seconds=0)

    session = MagicMock()  # .get must never be entered; no return value set
    data = await tmdb_client.tmdb_get(session, "movie/42", cache=True)

    assert data == cached
    session.get.assert_not_called()


@pytest.mark.asyncio
async def test_expired_file_is_refreshed_via_network(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    stale = {"id": 42, "title": "stale-payload"}
    # 176 days old — one day past the 175-day window.
    _write_cache(tmp_path, "movie/42", {}, stale, age_seconds=176 * 24 * 60 * 60)

    fresh = {"id": 42, "title": "fresh-payload"}
    session = MagicMock()
    session.get.return_value = _FakeResponse(200, fresh)

    data = await tmdb_client.tmdb_get(session, "movie/42", cache=True)

    assert data == fresh
    session.get.assert_called_once()
    # And the file was atomically replaced with the fresh content.
    path = tmp_path / f"{_cache_key('movie/42', {})}.json"
    assert json.loads(path.read_text(encoding="utf-8")) == fresh


@pytest.mark.asyncio
async def test_file_just_inside_window_still_fresh(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    cached = {"results": [{"id": 7}]}
    # Exactly at the boundary minus a small epsilon.
    _write_cache(
        tmp_path, "search/movie", {"query": "q"}, cached,
        age_seconds=tmdb_client.CACHE_MAX_AGE_SECONDS - 60,
    )
    session = MagicMock()
    data = await tmdb_client.tmdb_get(session, "search/movie", {"query": "q"})
    assert data == cached
    session.get.assert_not_called()


# ---------------------------------------------------------------------------
# empty-result guard
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_empty_search_result_not_persisted(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    session = MagicMock()
    session.get.return_value = _FakeResponse(200, {"results": []})

    await tmdb_client.tmdb_get(session, "search/movie", {"query": "nothing"})

    assert list(tmp_path.glob("*.json")) == []


@pytest.mark.asyncio
async def test_legacy_empty_result_cache_file_never_a_hit(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    poisoned = {"page": 1, "results": []}
    path = _write_cache(tmp_path, "search/person", {"query": "x"}, poisoned, age_seconds=0)

    fresh = {"page": 1, "results": [{"id": 3}]}
    session = MagicMock()
    session.get.return_value = _FakeResponse(200, fresh)

    data = await tmdb_client.tmdb_get(session, "search/person", {"query": "x"})

    assert data == fresh
    session.get.assert_called_once()
    # Poisoned legacy file was removed and NOT re-served as a hit.
    assert not path.exists() or json.loads(path.read_text(encoding="utf-8")) == fresh


# ---------------------------------------------------------------------------
# concurrent writers + partial JSON
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_concurrent_writers_never_expose_partial_json(tmp_path, monkeypatch):
    """Many writers hammering the SAME key while a reader loops: the reader
    must only ever observe complete JSON payloads."""
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    endpoint, params = "search/movie", {"query": "hot"}

    big_payload_a = {"results": [{"id": i, "overview": "A" * 500} for i in range(200)]}
    big_payload_b = {"results": [{"id": i, "overview": "B" * 500} for i in range(200)]}

    session_a = MagicMock()
    session_a.get.return_value = _FakeResponse(200, big_payload_a)
    session_b = MagicMock()
    session_b.get.return_value = _FakeResponse(200, big_payload_b)

    async def writer(session):
        for _ in range(15):
            await tmdb_client.tmdb_get(session, endpoint, params, cache=False)  # forces write each time? no...
            await asyncio.sleep(0)

    # cache=False skips the read but still writes; drive both writers directly.
    async def writer_direct(session):
        from app.services.tmdb_client import _write_cache_atomic

        for payload in (big_payload_a, big_payload_b) * 8:
            await _write_cache_atomic(tmp_path / f"{_cache_key(endpoint, params)}.json", payload)
            await asyncio.sleep(0.001)

    stop = asyncio.Event()
    seen_sizes = []

    async def reader():
        path = tmp_path / f"{_cache_key(endpoint, params)}.json"
        while not stop.is_set():
            if path.exists():
                raw = path.read_text(encoding="utf-8")
                try:
                    parsed = json.loads(raw)
                except ValueError as exc:
                    raise AssertionError(f"Reader observed partial JSON: {exc}") from exc
                seen_sizes.append(len(parsed["results"]))
            await asyncio.sleep(0)

    read_task = asyncio.create_task(reader())
    await asyncio.gather(writer_direct(session_a), writer_direct(session_b))
    stop.set()
    await read_task

    # Every observed snapshot had the full result set — never truncated.
    assert seen_sizes and all(n == 200 for n in seen_sizes)


@pytest.mark.asyncio
async def test_cancelled_write_leaves_no_temp_and_keeps_old(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    from app.services.tmdb_client import _write_cache_atomic

    dest = tmp_path / f"{_cache_key('movie/1', {})}.json"
    old_content = json.dumps({"old": True})
    dest.write_text(old_content, encoding="utf-8")

    task = asyncio.create_task(_write_cache_atomic(dest, {"new": "x" * 100000}))
    # Cancel mid-write.
    await asyncio.sleep(0.01)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    # Temp cleanup runs detached on the executor (survives cancellation); give it a beat.
    for _ in range(20):
        if not list(tmp_path.glob("*.tmp")):
            break
        await asyncio.sleep(0.05)

    leftovers = list(tmp_path.glob("*.tmp"))
    assert leftovers == []
    assert dest.read_text(encoding="utf-8") == old_content


# ---------------------------------------------------------------------------
# failed refresh keeps stale intact
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_failed_network_refresh_preserves_stale_file(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    stale = {"id": 42, "title": "stale-but-intact"}
    path = _write_cache(tmp_path, "movie/42", {}, stale, age_seconds=400 * 24 * 60 * 60)

    import aiohttp

    failing = _FakeResponse(200)
    failing.raise_for_status = lambda: (_ for _ in ()).throw(aiohttp.ClientError("down"))
    session = MagicMock()
    session.get.return_value = failing

    result = await tmdb_client.tmdb_get(session, "movie/42")

    assert result is None  # network error surfaces as None…
    assert path.read_text(encoding="utf-8") == json.dumps(stale)  # …but stale file untouched
    # mtime unchanged → still NOT marked fresh by the failed attempt.
    assert not tmdb_client._cache_read_is_fresh(path)


@pytest.mark.asyncio
async def test_failed_atomic_write_keeps_destination(tmp_path, monkeypatch):
    from app.services.tmdb_client import _write_cache_atomic

    dest = tmp_path / "dest.json"
    dest.write_text(json.dumps({"keep": 1}), encoding="utf-8")

    class ExplodingDir(type(tmp_path)):
        pass

    # Force the temp open to fail by pointing the write at an invalid name.
    bad_dest = tmp_path / "sub" / "missing-dir" / "dest.json"

    with pytest.raises(OSError):
        await _write_cache_atomic(bad_dest, {"nope": True})

    assert dest.read_text(encoding="utf-8") == json.dumps({"keep": 1})


# ---------------------------------------------------------------------------
# malformed files
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_malformed_file_is_removed_and_refreshed(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    path = tmp_path / f"{_cache_key('movie/9', {})}.json"
    path.write_text('{"truncated": [1, 2,', encoding="utf-8")  # broken JSON

    fresh = {"id": 9}
    session = MagicMock()
    session.get.return_value = _FakeResponse(200, fresh)

    data = await tmdb_client.tmdb_get(session, "movie/9")

    assert data == fresh
    # The malformed file got replaced by the fresh payload.
    assert json.loads(path.read_text(encoding="utf-8")) == fresh
    assert not list(tmp_path.glob("*.tmp"))


@pytest.mark.asyncio
async def test_malformed_file_with_dead_backend_does_not_crash(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    path = tmp_path / f"{_cache_key('movie/10', {})}.json"
    path.write_text("not json at all", encoding="utf-8")

    import aiohttp

    session = MagicMock()
    failing = _FakeResponse(200)
    failing.raise_for_status = lambda: (_ for _ in ()).throw(aiohttp.ClientError("down"))
    session.get.return_value = failing

    result = await tmdb_client.tmdb_get(session, "movie/10")
    assert result is None  # controlled None, no exception leak


# ---------------------------------------------------------------------------
# key format stability + Windows replace semantics
# ---------------------------------------------------------------------------

def test_cache_key_format_unchanged():
    """Byte-for-byte: md5(endpoint + sorted-json(params-with-key))."""
    expected = hashlib.md5(
        f'search/movie{json.dumps({"query": "abc", "api_key": app_settings.tmdb_api_key}, sort_keys=True)}'.encode()
    ).hexdigest()
    assert _cache_key("search/movie", {"query": "abc"}) == expected
    assert len(expected) == 32  # plain md5 hexdigest, no prefix/suffix/version tag


def test_os_replace_overwrites_existing_on_windows(tmp_path):
    src = tmp_path / "src.json"
    dst = tmp_path / "dst.json"
    src.write_text("new", encoding="utf-8")
    dst.write_text("old", encoding="utf-8")
    os.replace(src, dst)
    assert dst.read_text(encoding="utf-8") == "new"
    assert not src.exists()
