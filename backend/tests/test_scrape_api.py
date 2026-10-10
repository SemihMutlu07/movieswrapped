"""Tests for Letterboxd public profile scraping, scrape pipeline, and API endpoints."""

import asyncio
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import ASGITransport, AsyncClient

from app import task_manager
from app.services import scraper
from app.services.scrape_pipeline import (
    ScrapeAnalysisEmpty,
    analysis_period_bounds,
    normalize_analysis_period,
    scrape_and_analyze,
)


# ---- fixtures ----------------------------------------------------------------


@pytest.fixture
async def client():
    """ASGI test client with mocked aiohttp_session."""
    with patch.dict("os.environ", {"TMDB_API_KEY": "test-key"}):
        from app.main import create_app

        app = create_app()
        app.state.aiohttp_session = object()
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as ac:
            yield ac


# ---- period normalization & bounds ------------------------------------------


def test_normalize_analysis_period():
    assert normalize_analysis_period(None) == "lifetime"
    assert normalize_analysis_period("") == "lifetime"
    assert normalize_analysis_period("lifetime") == "lifetime"
    assert normalize_analysis_period("year") == "year"
    assert normalize_analysis_period("month") == "month"
    assert normalize_analysis_period("YEAR") == "year"

    with pytest.raises(ValueError, match="Unknown analysis period"):
        normalize_analysis_period("week")
    with pytest.raises(ValueError, match="Unknown analysis period"):
        normalize_analysis_period("all_time")


def test_analysis_period_bounds():
    fixed_today = date(2026, 7, 25)
    start, end = analysis_period_bounds("lifetime", today=fixed_today)
    assert start is None
    assert end == fixed_today

    start, end = analysis_period_bounds("year", today=fixed_today)
    assert start == date(2025, 7, 25)
    assert end == fixed_today

    start, end = analysis_period_bounds("month", today=fixed_today)
    assert start == date(2026, 6, 25)
    assert end == fixed_today

    # Leap year handling / month-end boundaries
    leap_today = date(2024, 2, 29)
    start, end = analysis_period_bounds("year", today=leap_today)
    assert start == date(2023, 2, 28)
    assert end == leap_today

    jan_today = date(2026, 1, 31)
    start, end = analysis_period_bounds("month", today=jan_today)
    assert start == date(2025, 12, 31)
    assert end == jan_today


# ---- route validation --------------------------------------------------------


@pytest.mark.asyncio
async def test_scrape_route_submission(client: AsyncClient):
    with patch("app.routes.analyze._run_scrape", new=AsyncMock()):
        r = await client.post("/api/scrape-profile", json={"username": "valid_user_123"})
        assert r.status_code == 202
        data = r.json()
        assert "task_id" in data
        assert "poll_token" in data
        assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_scrape_route_rejects_invalid_username(client: AsyncClient):
    r = await client.post("/api/scrape-profile", json={"username": ""})
    assert r.status_code == 400
    assert r.json()["detail"]["error_code"] == "invalid_username"

    r = await client.post("/api/scrape-profile", json={"username": "user with spaces"})
    assert r.status_code == 400
    assert r.json()["detail"]["error_code"] == "invalid_username"

    r = await client.post("/api/scrape-profile", json={"username": "user<script>"})
    assert r.status_code == 400
    assert r.json()["detail"]["error_code"] == "invalid_username"


@pytest.mark.asyncio
async def test_scrape_route_rejects_invalid_period(client: AsyncClient):
    r = await client.post(
        "/api/scrape-profile",
        json={"username": "validuser", "period": "decade"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["error_code"] == "invalid_analysis_period"


@pytest.mark.asyncio
async def test_scrape_route_rejects_invalid_json(client: AsyncClient):
    r = await client.post(
        "/api/scrape-profile",
        content=b"not json",
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 400
    assert r.json()["detail"]["error_code"] == "invalid_json"


# ---- progress & trace exposure -----------------------------------------------


@pytest.mark.asyncio
async def test_scrape_progress_exposure(client: AsyncClient):
    task_id = task_manager.create_task_state("test-client")
    task = task_manager.get_task_state(task_id)
    assert task is not None
    token = task.poll_token

    task_manager.set_task_running(task_id)
    task_manager.update_task_progress(
        task_id, "scrape_started", "Scraping profile", metrics={"pages": 1}
    )

    r = await client.get(f"/api/progress/{task_id}", headers={"X-Task-Token": token})
    assert r.status_code == 200
    payload = r.json()
    assert payload["status"] == "running"
    assert payload["stage"] == "scrape_started"
    assert "trace_events" in payload
    assert len(payload["trace_events"]) == 1
    assert payload["trace_events"][0]["stage"] == "scrape_started"


# ---- failure handling does not report success --------------------------------


@pytest.mark.asyncio
async def test_run_scrape_empty_period_failure():
    from app.routes.analyze import _run_scrape

    task_id = task_manager.create_task_state("test-client")
    empty_exc = ScrapeAnalysisEmpty("testuser", scraper_ok=True, period_empty=True)

    with patch(
        "app.routes.analyze.scrape_and_analyze", new=AsyncMock(side_effect=empty_exc)
    ):
        await _run_scrape(task_id, object(), "testuser", "month")

    task = task_manager.get_task_state(task_id)
    assert task is not None
    assert task.status == "failed"
    assert task.error_code == "no_films_in_period"
    assert task.result is None
    assert "No diary films found" in (task.error or "")


@pytest.mark.asyncio
async def test_run_scrape_cloudflare_or_rate_limit_failure():
    from app.routes.analyze import _run_scrape

    # Cloudflare block
    task_id = task_manager.create_task_state("test-client")
    block_exc = ValueError("Letterboxd is blocking automated access to this profile.")
    with patch(
        "app.routes.analyze.scrape_and_analyze", new=AsyncMock(side_effect=block_exc)
    ):
        await _run_scrape(task_id, object(), "blocked_user", "lifetime")

    task = task_manager.get_task_state(task_id)
    assert task is not None
    assert task.status == "failed"
    assert task.error_code == "scrape_blocked"
    assert task.result is None

    # Rate limit
    task_id2 = task_manager.create_task_state("test-client")
    rl_exc = ValueError("Letterboxd rate limit hit. Please wait a moment.")
    with patch(
        "app.routes.analyze.scrape_and_analyze", new=AsyncMock(side_effect=rl_exc)
    ):
        await _run_scrape(task_id2, object(), "rl_user", "lifetime")

    task2 = task_manager.get_task_state(task_id2)
    assert task2 is not None
    assert task2.status == "failed"
    assert task2.error_code == "rate_limit_exceeded"
    assert task2.result is None


@pytest.mark.asyncio
async def test_run_scrape_unexpected_exception():
    from app.routes.analyze import _run_scrape

    task_id = task_manager.create_task_state("test-client")
    with patch(
        "app.routes.analyze.scrape_and_analyze",
        new=AsyncMock(side_effect=RuntimeError("Connection reset")),
    ):
        await _run_scrape(task_id, object(), "err_user", "lifetime")

    task = task_manager.get_task_state(task_id)
    assert task is not None
    assert task.status == "failed"
    assert task.error_code == "scrape_failed"
    assert task.result is None


# ---- scrape pipeline windowing and provenance --------------------------------


@pytest.mark.asyncio
async def test_scrape_pipeline_windowing_and_provenance(monkeypatch):
    sources = scraper.ProfileScrapeSources(
        diary=[
            {"title": "Film A", "year": "2025", "rating": 5, "watch_date": "2026-07-01"},
            {"title": "Film B", "year": "2024", "rating": 4, "watch_date": "2024-01-01"},
        ],
        grid=[{"title": "Film C", "year": "2023", "rating": None, "watch_date": ""}],
        film_count=3,
        review_count=1,
        reviews=[
            {"title": "Film A", "year": "2025", "date": "2026-07-01", "review_text": "Superb"},
        ],
        favorite_films=[{"title": "Film A", "year": "2025"}],
        profile_avatar_url="https://img.letterboxd.com/avatar.jpg",
    )

    captured = {}

    async def fake_sources(*args, **kwargs):
        captured.update(kwargs)
        return sources

    async def fake_analysis(_session, csv_files, *_args, **_kwargs):
        import pandas as pd

        watched = pd.read_csv(csv_files["watched.csv"])
        return {
            "total_films": len(watched),
            "all_films": [{"title": "Film A", "poster_path": "/poster_a.jpg"}],
            "review_analysis": {"reviews": []},
        }

    monkeypatch.setattr(
        "app.services.scrape_pipeline.scrape_profile_sources", fake_sources
    )
    monkeypatch.setattr(
        "app.services.scrape_pipeline.process_comprehensive_letterboxd_data",
        fake_analysis,
    )

    stats = await scrape_and_analyze(object(), "user1", analysis_period="lifetime")

    assert captured["include_grid"] is True
    assert stats["scraped_username"] == "user1"
    assert stats["scraped_film_count"] == 3
    assert stats["scraped_diary_count"] == 2
    assert stats["profile_avatar_url"] == "https://img.letterboxd.com/avatar.jpg"
    assert stats["favorite_films"] == [
        {"title": "Film A", "year": "2025", "poster_path": "/poster_a.jpg"}
    ]
    assert stats["analysis_period"]["key"] == "lifetime"


# ---- scraper HTTP error handling --------------------------------------------


def test_scraper_diary_http_failure_raises(monkeypatch):
    mock_resp = MagicMock()
    mock_resp.status_code = 502
    mock_resp.text = "Bad Gateway"
    monkeypatch.setattr(scraper, "_fetch", lambda *args, **kwargs: mock_resp)

    session = MagicMock()
    with pytest.raises(RuntimeError, match="Letterboxd returned HTTP 502"):
        scraper._sync_scrape_diary("fail_user", 1, session=session)


def test_scraper_grid_http_failure_raises(monkeypatch):
    mock_resp = MagicMock()
    mock_resp.status_code = 500
    mock_resp.text = "Internal Server Error"
    monkeypatch.setattr(scraper, "_fetch", lambda *args, **kwargs: mock_resp)

    session = MagicMock()
    with pytest.raises(RuntimeError, match="Letterboxd returned HTTP 500"):
        scraper._sync_scrape_films_grid("fail_user", 1, session=session)


def test_probe_profile_access_cloudflare_is_terminal(monkeypatch):
    calls: list[str] = []

    def fake_fetch(_session, url, timeout=10):
        calls.append(url)
        resp = MagicMock()
        resp.status_code = 403
        resp.text = "Forbidden"
        return resp

    monkeypatch.setattr(scraper, "_fetch", fake_fetch)
    with pytest.raises(ValueError, match="blocking automated access"):
        scraper._probe_profile_access("public_user")
    assert calls == ["https://letterboxd.com/public_user/films/page/1/"]


def test_probe_profile_access_challenge_html_is_terminal(monkeypatch):
    body = "Just a moment..." + ("x" * 80) + "challenges.cloudflare.com"
    monkeypatch.setattr(
        scraper, "_fetch", lambda *args, **kwargs: MagicMock(status_code=200, text=body)
    )
    with pytest.raises(ValueError, match="blocking automated access"):
        scraper._probe_profile_access("public_user")


def test_probe_profile_access_404_is_not_found(monkeypatch):
    resp = MagicMock(status_code=404, text="Not Found")
    monkeypatch.setattr(scraper, "_fetch", lambda *args, **kwargs: resp)
    with pytest.raises(ValueError, match="not found"):
        scraper._probe_profile_access("missing_user")


def test_scraper_diary_403_does_not_paginate(monkeypatch):
    calls: list[str] = []

    def fake_fetch(_session, url, timeout=10):
        calls.append(url)
        return MagicMock(status_code=403, text="Forbidden")

    monkeypatch.setattr(scraper, "_fetch", fake_fetch)
    with pytest.raises(ValueError, match="blocking automated access"):
        scraper._sync_scrape_diary("user", 5, session=MagicMock())
    assert calls == ["https://letterboxd.com/user/films/diary/page/1/"]


def test_scraper_grid_403_does_not_paginate(monkeypatch):
    calls: list[str] = []

    def fake_fetch(_session, url, timeout=10):
        calls.append(url)
        return MagicMock(status_code=403, text="Forbidden")

    monkeypatch.setattr(scraper, "_fetch", fake_fetch)
    with pytest.raises(ValueError, match="blocking automated access"):
        scraper._sync_scrape_films_grid("user", 5, session=MagicMock())
    assert calls == ["https://letterboxd.com/user/films/page/1/"]


@pytest.mark.asyncio
async def test_scrape_profile_sources_does_not_paginate_after_block(monkeypatch):
    diary_calls = []

    def probe_block(username, session=None):
        raise ValueError("Letterboxd is blocking automated access to this profile.")

    def diary(*args, **kwargs):
        diary_calls.append(args)
        return []

    monkeypatch.setattr(scraper, "_probe_profile_access", probe_block)
    monkeypatch.setattr(scraper, "_sync_scrape_diary", diary)
    monkeypatch.setattr(scraper, "_sync_scrape_films_grid", diary)
    monkeypatch.setattr(scraper, "_sync_scrape_overview", lambda *a, **k: (0, 0, [], None))
    monkeypatch.setattr(scraper, "_sync_scrape_reviews", diary)

    with pytest.raises(ValueError, match="blocking automated access"):
        await scraper.scrape_profile_sources("blocked_user", include_reviews=True)
    assert diary_calls == []


def test_scraper_reviews_http_block_and_rate_limit(monkeypatch):
    session = MagicMock()

    # 403 block
    resp_403 = MagicMock(status_code=403, text="Forbidden")
    monkeypatch.setattr(scraper, "_fetch", lambda *args, **kwargs: resp_403)
    with pytest.raises(ValueError, match="blocking automated access"):
        scraper._sync_scrape_reviews("user", 1, session=session)

    # 429 rate limit
    resp_429 = MagicMock(status_code=429, text="Too Many Requests")
    monkeypatch.setattr(scraper, "_fetch", lambda *args, **kwargs: resp_429)
    with pytest.raises(ValueError, match="rate limit hit"):
        scraper._sync_scrape_reviews("user", 1, session=session)

    # 500 error
    resp_500 = MagicMock(status_code=500, text="Server Error")
    monkeypatch.setattr(scraper, "_fetch", lambda *args, **kwargs: resp_500)
    with pytest.raises(RuntimeError, match="Letterboxd returned HTTP 500"):
        scraper._sync_scrape_reviews("user", 1, session=session)


def test_kind_for_url_routes_diary_to_safari():
    assert scraper._kind_for_url("https://letterboxd.com/dave/films/diary/page/2/") == "safari"
    assert scraper._kind_for_url("https://letterboxd.com/dave/films/page/2/") == "plain"
    assert scraper._kind_for_url("https://letterboxd.com/dave/") == "plain"


def test_last_page_reads_paginate_links():
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(
        '<div class="paginate-pages"><a>1</a><a>2</a><a>14</a></div>',
        "html.parser",
    )
    assert scraper._last_page(soup) == 14
    assert scraper._last_page(BeautifulSoup("<div></div>", "html.parser")) == 1


def test_parse_grid_items_reads_ratings_from_tile():
    from bs4 import BeautifulSoup

    html = """
    <ul>
      <li class="griditem">
        <div data-item-slug="heat" data-item-name="Heat (1995)"></div>
        <span class="rating rated-9">★★★★½</span>
      </li>
    </ul>
    """
    films = scraper._parse_grid_items(BeautifulSoup(html, "html.parser"))
    assert films == [
        {
            "title": "Heat",
            "year": "1995",
            "rating": 4.5,
            "watch_date": "",
            "slug": "heat",
            "poster_url": "",
        }
    ]


def test_sources_from_bookmarklet_maps_watched_date():
    sources = scraper.sources_from_bookmarklet({
        "films": [{"title": "Heat", "year": 1995, "rating": 4.5, "slug": "heat"}],
        "diary": [{
            "title": "Heat",
            "year": 1995,
            "rating": 4.5,
            "watchedDate": "2024-01-02",
            "slug": "heat",
        }],
    })
    assert sources.film_count == 1
    assert sources.grid[0]["title"] == "Heat"
    assert sources.diary[0]["watch_date"] == "2024-01-02"
    assert sources.diary[0]["rating"] == 4.5


@pytest.mark.asyncio
async def test_import_scrape_route_submission(client: AsyncClient):
    with patch("app.routes.analyze._run_scrape", new=AsyncMock()):
        r = await client.post(
            "/api/import-scrape",
            json={
                "user": "dave",
                "films": [{"title": "Heat", "year": 1995}],
                "diary": [],
            },
        )
        assert r.status_code == 202
        data = r.json()
        assert "task_id" in data
        assert data["status"] == "pending"


@pytest.mark.asyncio
async def test_import_scrape_rejects_empty_payload(client: AsyncClient):
    r = await client.post("/api/import-scrape", json={"user": "dave", "films": [], "diary": []})
    assert r.status_code == 400
    assert r.json()["detail"]["error_code"] == "no_films"
