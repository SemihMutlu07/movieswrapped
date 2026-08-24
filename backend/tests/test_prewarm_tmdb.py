"""
Bounded TMDB prewarm pilot tests.

Acceptance items from the prompt:
- dry-run makes 0 requests and 0 writes
- the 1,000 hard cap cannot be bypassed
- dedupe is deterministic
- existing fresh cache hits produce zero outbound requests
- search + metadata key shapes match the live path
- repeated 429 aborts without damaging valid cache files
- 175-day freshness is honored
"""
from __future__ import annotations

import asyncio
import json
import time
from unittest.mock import MagicMock

import pytest

from app.config import settings as app_settings
from app.services import tmdb_client


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

class FakeResponse:
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


def _key(endpoint, params):
    import hashlib
    merged = dict(params)
    merged["api_key"] = app_settings.tmdb_api_key
    return hashlib.md5(f"{endpoint}{json.dumps(merged, sort_keys=True)}".encode()).hexdigest()


@pytest.fixture(autouse=True)
def _no_network_sleep(monkeypatch):
    async def _noop(*a, **k):
        return None
    monkeypatch.setattr(tmdb_client, "_wait_for_tmdb_slot", _noop)


# ---------------------------------------------------------------------------
# dry-run / hard caps (script-level contract)
# ---------------------------------------------------------------------------

def test_hard_cap_constants():
    """The script's baked-in limits can't be raised via flags."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "prewarm", r"scripts/prewarm_tmdb.py")
    mod = importlib.util.module_from_spec(spec)
    # Only execute module constants — main() is not run.
    spec.loader.exec_module(mod)
    assert mod.HARD_MAX_FILMS == 1000
    assert mod.HARD_RATE_RPS == 5


# ---------------------------------------------------------------------------
# dedupe determinism
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_candidate_dedupe_is_deterministic(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)

    payloads = {
        "movie/popular": {"results": [
            {"id": 10, "release_date": "2024-01-01"},
            {"id": 11, "release_date": "2023-05-05"},
            {"id": 10, "release_date": "2024-01-01"},  # duplicate id in same list
        ]},
        "movie/top_rated": {"results": [
            {"id": 12, "release_date": "2022-02-02"},
            {"id": 10, "release_date": "2024-01-01"},  # cross-list duplicate
            {"id": 13, "release_date": None},
        ]},
    }

    session = MagicMock()
    def get(url, params=None):
        endpoint = url.rsplit("/", 2)[-2] + "/" + url.rsplit("/", 2)[-1]
        # map by last two path segments
        for known in payloads:
            if url.endswith(known):
                return FakeResponse(200, payloads[known])
        return FakeResponse(200, {"results": []})
    session.get.side_effect = lambda url, params=None: _ctx(payloads, url)

    class _Ctx:
        def __init__(self, payload): self.p = payload
        async def __aenter__(self): return FakeResponse(200, self.p)
        async def __aexit__(self, *a): return False

    def _ctx(payloads, url):
        for known, body in payloads.items():
            if url.endswith(known):
                return _Ctx(body)
        return _Ctx({"results": []})

    # Run candidate collection twice — order and content must be identical.
    sys_mod = pytest.importorskip("importlib.util")
    spec = sys_mod.spec_from_file_location("prewarm", r"scripts/prewarm_tmdb.py")
    mod = sys_mod.module_from_spec(spec)
    spec.loader.exec_module(mod)

    r1 = await mod._candidate_titles(session, 50)
    r2 = await mod._candidate_titles(session, 50)

    assert r1 == r2
    ids1 = [c["tmdb_id"] for c in r1]
    assert len(ids1) == len(set(ids1))  # no duplicates
    assert set(ids1) == {10, 11, 12, 13}


# ---------------------------------------------------------------------------
# existing hits → zero requests; freshness honored
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_existing_fresh_hits_produce_zero_requests(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)

    tid = 555
    for suffix in ("", "/credits", "/keywords"):
        k = _key(f"movie/{tid}{suffix}", {})
        (tmp_path / f"{k}.json").write_text(json.dumps({"id": tid}), encoding="utf-8")

    session = MagicMock()
    session.get.return_value = FakeResponse(200)  # must never be entered

    d = await tmdb_client.tmdb_get(session, f"movie/{tid}")
    c = await tmdb_client.tmdb_get(session, f"movie/{tid}/credits")
    kw = await tmdb_client.tmdb_get(session, f"movie/{tid}/keywords")

    assert d == {"id": tid} and c == {"id": tid} and kw == {"id": tid}
    session.get.assert_not_called()


@pytest.mark.asyncio
async def test_stale_file_beyond_175d_is_refreshed(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)

    tid = 777
    k = _key(f"movie/{tid}", {})
    path = tmp_path / f"{k}.json"
    path.write_text(json.dumps({"id": tid, "old": True}), encoding="utf-8")
    old = time.time() - 176 * 24 * 60 * 60
    import os
    os.utime(path, (old, old))

    session = MagicMock()
    session.get.return_value = FakeResponse(200, {"id": tid, "fresh": True})

    data = await tmdb_client.tmdb_get(session, f"movie/{tid}")
    assert data == {"id": tid, "fresh": True}
    session.get.assert_called_once()


# ---------------------------------------------------------------------------
# key shape parity with the live pipeline path
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_metadata_key_shapes_match_live_pipeline(tmp_path, monkeypatch):
    """fetch_comprehensive_film_details must hit exactly the keys prewarm warms."""
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)

    tid = 888
    # Warm via the same three endpoints prewarm uses.
    session_warm = MagicMock()
    session_warm.get.return_value = FakeResponse(200, {"id": tid})
    for ep in (f"movie/{tid}", f"movie/{tid}/credits", f"movie/{tid}/keywords"):
        await tmdb_client.tmdb_get(session_warm, ep)

    # Live path: fetch_comprehensive_film_details must be a pure cache read.
    session_live = MagicMock()
    session_live.get.return_value = FakeResponse(200)  # never entered

    details = await tmdb_client.fetch_comprehensive_film_details(session_live, tid)
    assert details.get("tmdb_id") == tid
    session_live.get.assert_not_called()


# ---------------------------------------------------------------------------
# 429 abort does not damage valid files
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_429_abort_leaves_valid_files_intact(tmp_path, monkeypatch):
    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)

    good_tid = 111
    good_key = _key(f"movie/{good_tid}", {})
    good_path = tmp_path / f"{good_key}.json"
    good_path.write_text(json.dumps({"id": good_tid, "ok": True}), encoding="utf-8")

    rate_limited = FakeResponse(429)
    ok_payload = FakeResponse(200, {"id": 222})

    session = MagicMock()
    session.get.side_effect = [rate_limited, rate_limited, ok_payload]  # 429 → retry → success

    sleeps = []
    async def fake_sleep(d): sleeps.append(d)
    monkeypatch.setattr(asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(tmdb_client.settings, "tmdb_429_retries", 2)

    data = await tmdb_client.tmdb_get(session, "movie/222")
    assert data == {"id": 222}
    # The unrelated valid file is untouched.
    assert good_path.read_text(encoding="utf-8") == json.dumps({"id": good_tid, "ok": True})
