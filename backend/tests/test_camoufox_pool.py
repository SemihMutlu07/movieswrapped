"""Camoufox pool behaviour without launching a browser."""
from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.services.camoufox_pool import CamoufoxPool, SlotDeadError, _looks_like_challenge


class TimeoutError(Exception):
    """Name contains timeout so the pool treats it as a navigation timeout."""


def _factory(page: MagicMock):
    browser = MagicMock()
    return lambda _profile: (None, browser, page)


def test_challenge_html_detected():
    html = "<html><head><title>Just a moment...</title></head>" + ("challenges.cloudflare.com" * 2)
    assert _looks_like_challenge(html)


def test_empty_document_retries_then_200(tmp_path: Path):
    page = MagicMock()
    page.goto.return_value = None
    page.content.side_effect = ["tiny", "<html>" + ("film" * 200) + "</html>"]
    pool = CamoufoxPool(profile_dir=tmp_path, restart_every=8, browser_factory=_factory(page))
    resp = pool.fetch_sync("https://letterboxd.com/u/")
    assert resp.status_code == 200
    assert page.goto.call_count == 2


def test_three_nav_timeouts_recreate_slot(tmp_path: Path):
    page = MagicMock()
    calls = {"n": 0}

    def goto(*_a, **_k):
        calls["n"] += 1
        if calls["n"] <= 3:
            raise TimeoutError("Timeout 45000ms exceeded")
        return None

    page.goto.side_effect = goto
    page.content.return_value = "<html>" + ("ok" * 300) + "</html>"
    created = {"n": 0}

    def factory(_profile):
        created["n"] += 1
        return (None, MagicMock(), page)

    pool = CamoufoxPool(profile_dir=tmp_path, restart_every=8, browser_factory=factory)
    assert pool.fetch_sync("https://letterboxd.com/a/").status_code == 0
    assert pool.fetch_sync("https://letterboxd.com/b/").status_code == 0
    third = pool.fetch_sync("https://letterboxd.com/c/")
    assert third.status_code == 200
    assert created["n"] == 2


def test_restart_every_n_jobs_closes_browser(tmp_path: Path):
    page = MagicMock()
    page.goto.return_value = None
    page.content.return_value = "<html>" + ("x" * 500) + "</html>"
    created = {"n": 0}

    def factory(_profile):
        created["n"] += 1
        browser = MagicMock()
        return (None, browser, page)

    pool = CamoufoxPool(profile_dir=tmp_path, restart_every=2, browser_factory=factory)
    assert pool.fetch_sync("https://letterboxd.com/one/").status_code == 200
    pool.note_job_done()
    assert created["n"] == 1
    pool.note_job_done()
    assert created["n"] == 1  # closed after 2 jobs; next fetch launches again
    assert pool.fetch_sync("https://letterboxd.com/two/").status_code == 200
    assert created["n"] == 2


def test_slot_dead_error_message():
    err = SlotDeadError("3 consecutive navigation timeouts")
    assert "timeout" in str(err)
