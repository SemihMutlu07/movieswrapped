"""POST /api/rss-fingerprint — existence + cache identity, never a library."""

from pathlib import Path
from unittest.mock import patch

import pytest
from httpx import ASGITransport, AsyncClient

from app.services.letterboxd_rss import RssUnavailable, parse_letterboxd_rss

FIXTURE = Path(__file__).parent / "fixtures" / "letterboxd_member_rss.xml"


@pytest.fixture
async def client():
    with patch.dict("os.environ", {"TMDB_API_KEY": "test-key"}):
        from app.main import create_app

        app = create_app()
        app.state.aiohttp_session = object()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


@pytest.mark.asyncio
async def test_rss_fingerprint_returns_guid_not_items(client, monkeypatch):
    rss = parse_letterboxd_rss(FIXTURE.read_bytes(), username="sampleuser")

    def fake_fetch(username: str):
        assert username == "sampleuser"
        return rss

    monkeypatch.setattr("app.routes.rss.fetch_profile_rss", fake_fetch)
    response = await client.post("/api/rss-fingerprint", json={"username": "SampleUser"})
    assert response.status_code == 200
    body = response.json()
    assert body["username"] == "sampleuser"
    assert body["preview_only"] is True
    assert body["latest_guid"] == "letterboxd-review-1000"
    assert body["latest_watched_date"] == "2026-10-09"
    assert body["checksum"] == rss.checksum
    assert body["item_count"] == 54
    assert "sample" not in body
    assert "items" not in body


@pytest.mark.asyncio
async def test_rss_fingerprint_missing_user_is_404(client, monkeypatch):
    def fake_fetch(username: str):
        raise ValueError(f"User '{username}' not found")

    monkeypatch.setattr("app.routes.rss.fetch_profile_rss", fake_fetch)
    response = await client.post("/api/rss-fingerprint", json={"username": "ghost"})
    assert response.status_code == 404
    assert response.json()["detail"]["error_code"] == "user_not_found"


@pytest.mark.asyncio
async def test_rss_fingerprint_blocked_is_unavailable_not_scrape(client, monkeypatch):
    def fake_fetch(_username: str):
        raise RssUnavailable("Letterboxd RSS for 'alice' was blocked")

    monkeypatch.setattr("app.routes.rss.fetch_profile_rss", fake_fetch)
    response = await client.post("/api/rss-fingerprint", json={"username": "alice"})
    assert response.status_code == 503
    assert response.json()["detail"]["error_code"] == "rss_unavailable"


@pytest.mark.asyncio
async def test_rss_fingerprint_rejects_invalid_username(client):
    response = await client.post("/api/rss-fingerprint", json={"username": "bad user"})
    assert response.status_code == 400
    assert response.json()["detail"]["error_code"] == "invalid_username"


@pytest.mark.asyncio
async def test_rss_fingerprint_does_not_html_scrape(client, monkeypatch):
    def boom(*_args, **_kwargs):
        raise AssertionError("HTML scrape must not run for a fingerprint check")

    rss = parse_letterboxd_rss(FIXTURE.read_bytes(), username="alice")
    monkeypatch.setattr("app.routes.rss.fetch_profile_rss", lambda _u: rss)
    monkeypatch.setattr("app.services.scraper.scrape_profile_sources", boom)
    monkeypatch.setattr("app.services.scraper.probe_profile_access", boom)
    response = await client.post("/api/rss-fingerprint", json={"username": "alice"})
    assert response.status_code == 200
