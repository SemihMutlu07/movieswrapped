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


@pytest.mark.asyncio
async def test_tmdb_warm_starts_before_reviews_finish(monkeypatch):
    """Film TMDB fetches share the wall clock with the review branch."""
    import time

    events: list[tuple[str, float]] = []

    def diary(*_args, **_kwargs):
        return [{
            "title": "Film A",
            "year": "2024",
            "rating": 5,
            "watch_date": "2024-06-01",
        }]

    def reviews(*_args, **_kwargs):
        time.sleep(0.25)
        events.append(("reviews_done", time.monotonic()))
        return [{
            "title": "Film A",
            "year": "2024",
            "date": "2024-06-01",
            "review_text": "A full sentence",
        }]

    async def resolve(_session, _title, _year, _uri):
        events.append(("resolve", time.monotonic()))
        await asyncio.sleep(0.05)
        return 11

    async def details(_session, tmdb_id):
        events.append(("details", time.monotonic()))
        return {"tmdb_id": tmdb_id}

    captured: dict[str, str] = {}

    async def analysis(_session, csv_files, task_id=None):
        import pandas as pd

        captured["review"] = str(pd.read_csv(csv_files["reviews.csv"])["Review"].iloc[0])
        return {
            "total_films": 1,
            "all_films": [{"title": "Film A", "poster_path": "/a.jpg"}],
            "review_analysis": {"reviews": [{"text": captured["review"]}]},
        }

    monkeypatch.setattr(scraper, "_sync_scrape_diary", diary)
    monkeypatch.setattr(scraper, "_sync_scrape_films_grid", lambda *_a, **_k: [])
    monkeypatch.setattr(scraper, "_sync_scrape_overview", lambda *_a, **_k: (1, 0, [], None))
    monkeypatch.setattr(scraper, "_sync_scrape_reviews", reviews)
    monkeypatch.setattr("app.services.tmdb_client.resolve_tmdb_id", resolve)
    monkeypatch.setattr("app.services.tmdb_client.fetch_comprehensive_film_details", details)
    monkeypatch.setattr(
        "app.services.scrape_pipeline.process_comprehensive_letterboxd_data",
        analysis,
    )

    started = time.monotonic()
    stats = await scrape_and_analyze(object(), "user1", analysis_period="lifetime")
    elapsed = time.monotonic() - started

    resolve_at = next(stamp for name, stamp in events if name == "resolve")
    reviews_at = next(stamp for name, stamp in events if name == "reviews_done")
    assert resolve_at < reviews_at
    assert captured["review"] == "A full sentence"
    assert stats["scraped_reviews_with_text"] == 1
    assert elapsed < 0.5


@pytest.mark.asyncio
async def test_warm_film_cache_is_reused_by_the_same_tmdb_calls(tmp_path, monkeypatch):
    from app.services import tmdb_client
    from app.services.scrape_pipeline import _warm_film_tmdb_cache

    monkeypatch.setattr(tmdb_client, "CACHE_DIR", tmp_path)
    calls: list[str] = []

    class _Response:
        def __init__(self, payload):
            self.status = 200
            self.headers = {}
            self._payload = payload

        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        def raise_for_status(self):
            return None

        async def json(self):
            return self._payload

    def _get(url, params=None):
        del params
        calls.append(url)
        if url.endswith("search/movie"):
            payload = {
                "results": [{
                    "id": 11,
                    "title": "Film A",
                    "original_title": "Film A",
                    "release_date": "2024-05-01",
                    "vote_count": 10,
                    "popularity": 1,
                }]
            }
        elif url.endswith("/credits"):
            payload = {"id": 11, "crew": [], "cast": []}
        elif url.endswith("/keywords"):
            payload = {"id": 11, "keywords": []}
        else:
            payload = {
                "id": 11,
                "title": "Film A",
                "genres": [],
                "production_countries": [],
                "production_companies": [],
                "release_date": "2024-05-01",
            }
        return _Response(payload)

    session = MagicMock()
    session.get.side_effect = _get

    await _warm_film_tmdb_cache(session, [{"title": "Film A", "year": "2024"}])
    warmed = len(calls)
    assert warmed == 4

    resolved = await tmdb_client.resolve_tmdb_id(session, "Film A", "2024", None)
    await tmdb_client.fetch_comprehensive_film_details(session, resolved)
    assert resolved == 11
    assert len(calls) == warmed


@pytest.mark.asyncio
async def test_profile_scrape_still_raises_diary_http_error(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("Letterboxd returned HTTP 502 for 'user'")

    monkeypatch.setattr(scraper, "_sync_scrape_diary", boom)
    monkeypatch.setattr(scraper, "_sync_scrape_films_grid", lambda *_a, **_k: [])
    monkeypatch.setattr(scraper, "_sync_scrape_overview", lambda *_a, **_k: (0, 0, [], None))
    monkeypatch.setattr(scraper, "_sync_scrape_reviews", lambda *_a, **_k: [])

    with pytest.raises(RuntimeError, match="HTTP 502"):
        await scraper.scrape_profile_sources("user", max_pages=1, include_reviews=True)


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
