"""The 2.5 minute story was a one-connection walk plus a tail stacked after it.

Diary page 3 showed 150 films at about 9 seconds: 50 films a page, 3 seconds
a page. August 2026 measured diary 452 + grid 725 in about 67 seconds, which
is the same clock (10 diary pages + 11 grid pages + probe and overview).
That walk is already over 60 seconds. 30 seconds is one grid pass and drops
dates. The tail that stacked on top was three TMDB calls per film and a
Letterboxd permalink per truncated review.
"""
from __future__ import annotations

import asyncio
import math
import threading
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from app.config import settings
from app.services import scrape_cache, scraper
from app.services.scraper import ProfileScrapeSources
from app.services.tmdb_client import fetch_comprehensive_film_details


def test_measured_walk_is_over_a_minute_and_not_thirty_seconds():
    seconds_per_page = 9 / 3
    diary_pages = math.ceil(452 / 50)
    grid_pages = math.ceil(725 / 72)
    overhead_pages = 2
    walk_seconds = (diary_pages + grid_pages + overhead_pages) * seconds_per_page
    assert seconds_per_page == 3
    assert diary_pages == 10
    assert grid_pages == 11
    assert walk_seconds == 69
    assert walk_seconds > 60
    grid_only_seconds = math.ceil(741 / 72) * seconds_per_page
    assert grid_only_seconds == 33
    assert grid_only_seconds > 30


def test_grid_is_skipped_only_when_unique_diary_covers_the_library(monkeypatch):
    grid_calls: list[str] = []
    covered = [
        {"title": "Heat", "year": "1995", "rating": None, "watch_date": "2020-01-01"},
        {"title": "Ali", "year": "2001", "rating": None, "watch_date": "2020-01-02"},
    ]
    # Two diary rows, one title: a rewatch is not the whole library.
    rewatch = [
        {"title": "Heat", "year": "1995", "rating": None, "watch_date": "2020-01-01"},
        {"title": "Heat", "year": "1995", "rating": None, "watch_date": "2021-01-01"},
    ]

    def overview_count(count: int):
        def _overview(*_args, **_kwargs):
            return (count, 0, [], None)
        return _overview

    monkeypatch.setattr(scraper, "_sync_scrape_films_grid", lambda *_a, **_k: grid_calls.append("grid") or [{"title": "Extra", "year": "1999"}])
    monkeypatch.setattr(scraper, "_new_session", lambda: MagicMock())
    monkeypatch.setattr(scraper, "_warm_session", lambda _s: None)

    monkeypatch.setattr(scraper, "_sync_scrape_overview", overview_count(2))
    monkeypatch.setattr(scraper, "_sync_scrape_diary", lambda *_a, **_k: covered)
    covered_sources = scraper._sync_scrape_profile_sources("dave", 3, session=MagicMock(), skip_probe=True)
    assert grid_calls == []
    assert covered_sources.grid == []

    grid_calls.clear()
    monkeypatch.setattr(scraper, "_sync_scrape_overview", overview_count(2))
    monkeypatch.setattr(scraper, "_sync_scrape_diary", lambda *_a, **_k: rewatch)
    short_sources = scraper._sync_scrape_profile_sources("dave", 3, session=MagicMock(), skip_probe=True)
    assert grid_calls == ["grid"]
    assert short_sources.grid[0]["title"] == "Extra"


def test_diary_pages_emit_films_before_the_next_fetch(monkeypatch):
    events: list[tuple[str, object]] = []

    def fake_fetch(_session, url, timeout=10):
        page = 1 if url.endswith("/page/1/") else 2
        title = "Heat" if page == 1 else "Ali"
        events.append(("fetch", page))
        html = f"""
        <html><body>
          <div class="paginate-pages"><a>1</a><a>2</a></div>
          <table><tr class="diary-entry-row">
            <td class="col-production"><a href="/film/{title.lower()}/">{title}</a></td>
            <td class="col-releaseyear">1995</td>
            <td class="col-daydate"><a href="/dave/films/for/2024/01/02/">2</a></td>
          </tr></table>
        </body></html>
        """
        return MagicMock(status_code=200, text=html)

    monkeypatch.setattr(scraper, "_fetch", fake_fetch)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_a, **_k: None)
    scraper._sync_scrape_diary(
        "dave",
        5,
        session=MagicMock(),
        on_films=lambda films: events.append(("films", films[0]["title"])),
    )
    assert events == [("fetch", 1), ("films", "Heat"), ("fetch", 2), ("films", "Ali")]


def test_review_listing_does_not_fetch_permalinks(monkeypatch):
    urls: list[str] = []
    html = """
    <html><body>
      <article class="production-viewing">
        <div data-component-class="LazyPoster" data-item-slug="heat"></div>
        <h2 class="primaryname"><a href="/dave/film/heat/1/">Heat</a></h2>
        <span class="releasedate">1995</span>
        <div class="body-text">A long note that ends with…</div>
      </article>
    </body></html>
    """

    def fake_fetch(_session, url, timeout=10):
        urls.append(url)
        return MagicMock(status_code=200, text=html)

    monkeypatch.setattr(scraper, "_fetch", fake_fetch)
    monkeypatch.setattr(scraper.time, "sleep", lambda *_a, **_k: None)
    reviews = scraper._sync_scrape_reviews("dave", max_pages=1, session=MagicMock())
    assert urls == ["https://letterboxd.com/dave/reviews/films/page/1/"]
    assert reviews[0]["review_text"].endswith("…")


@pytest.mark.asyncio
async def test_film_details_are_one_tmdb_round_trip(monkeypatch):
    calls: list[tuple[str, object]] = []

    async def fake_get(_session, endpoint, params=None, cache=True):
        calls.append((endpoint, params))
        return {
            "title": "Heat",
            "genres": [{"name": "Crime"}],
            "release_date": "1995-12-15",
            "production_countries": [],
            "production_companies": [],
            "credits": {"crew": [{"job": "Director", "name": "Michael Mann"}], "cast": []},
            "keywords": {"keywords": [{"name": "heist"}]},
        }

    monkeypatch.setattr("app.services.tmdb_client.tmdb_get", fake_get)
    details = await fetch_comprehensive_film_details(object(), 949)
    assert calls == [("movie/949", {"append_to_response": "credits,keywords"})]
    assert details["director"] == "Michael Mann"
    assert details["keywords"] == ["heist"]


@pytest.mark.asyncio
async def test_tmdb_warm_starts_during_the_letterboxd_walk(monkeypatch):
    order: list[str] = []
    release = threading.Event()
    film = {"title": "Heat", "year": "1995", "rating": 4.5, "watch_date": "2024-06-01"}

    def sync_sources(
        username,
        max_pages,
        include_reviews=False,
        trace_callback=None,
        diary_cutoff=None,
        include_grid=True,
        skip_probe=False,
        session=None,
        on_films=None,
    ):
        order.append("walk")
        assert on_films is not None
        on_films([film])
        assert release.wait(timeout=2)
        order.append("walk-done")
        return ProfileScrapeSources(diary=[film], grid=[], film_count=1)

    async def fake_warm(_session, films):
        assert films[0]["title"] == "Heat"
        order.append("warm")
        release.set()

    async def fake_window(*_args, **_kwargs):
        order.append("analyze")
        return {"total_films": 1}

    monkeypatch.setattr("app.services.scrape_pipeline.probe_profile_access", lambda *_a, **_k: None)
    monkeypatch.setattr("app.services.scraper._sync_scrape_profile_sources", sync_sources)
    monkeypatch.setattr("app.services.scrape_pipeline._warm_scraped_films", fake_warm)
    monkeypatch.setattr("app.services.scrape_pipeline._analyze_window", fake_window)

    from app.services.scrape_pipeline import scrape_and_analyze

    stats = await scrape_and_analyze(object(), "dave", analysis_period="lifetime")
    assert stats["total_films"] == 1
    assert order.index("warm") < order.index("walk-done")
    assert order.index("analyze") > order.index("walk-done")


@pytest.mark.asyncio
async def test_repeat_username_hits_memory_when_supabase_is_off(monkeypatch):
    monkeypatch.setattr(settings, "supabase_url", "")
    monkeypatch.setattr(settings, "supabase_anon_key", "")
    monkeypatch.setattr(settings, "supabase_ops_email", "")
    monkeypatch.setattr(settings, "supabase_ops_password", "")
    scrape_cache._memory.clear()
    assert await scrape_cache.lookup_scrape_cache("semihmutsuz", "lifetime") is None
    scrape_cache.store_scrape_cache("SemihMutsuz", "lifetime", {"total_films": 741})
    hit = await scrape_cache.lookup_scrape_cache("semihmutsuz", "lifetime")
    assert hit == {"total_films": 741}
    scrape_cache._memory[("semihmutsuz", "lifetime")] = (
        datetime.now(timezone.utc) - timedelta(seconds=1),
        {"total_films": 741},
    )
    assert await scrape_cache.lookup_scrape_cache("semihmutsuz", "lifetime") is None
    scrape_cache._memory.clear()
