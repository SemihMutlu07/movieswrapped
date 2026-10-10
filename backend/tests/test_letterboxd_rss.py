"""Official Letterboxd member RSS client — fixture parse, fetch errors, pipeline wiring."""

from pathlib import Path
from unittest.mock import MagicMock

import pytest

from app.services import letterboxd_rss
from app.services.letterboxd_rss import (
    FEED_ITEM_CAP,
    ProfileRss,
    RssItem,
    RssUnavailable,
    fetch_profile_rss,
    parse_letterboxd_rss,
    preview_rss_items,
)
from app.services import scrape_pipeline
from app.services.scrape_pipeline import scrape_and_analyze
from app.services.scraper import ProfileScrapeSources

FIXTURE = Path(__file__).parent / "fixtures" / "letterboxd_member_rss.xml"


@pytest.fixture(autouse=True)
def _clear_rss_cache():
    letterboxd_rss.clear_rss_fingerprints()
    yield
    letterboxd_rss.clear_rss_fingerprints()


def test_parse_fixture_rss_has_54_items_tmdb_and_ratings():
    rss = parse_letterboxd_rss(FIXTURE.read_bytes(), username="sampleuser")
    assert len(rss.items) == 54
    assert rss.checksum
    assert rss.latest_guid == "letterboxd-review-1000"
    assert rss.latest_watched_date == "2026-10-09"

    first = rss.items[0]
    assert first.title == "Digger"
    assert first.year == "2026"
    assert first.rating == 3.0
    assert first.tmdb_movie_id == "1248832"
    assert first.poster_url and first.poster_url.startswith("https://a.ltrbxd.com/")

    with_tmdb = [item for item in rss.items if item.tmdb_movie_id]
    with_rating = [item for item in rss.items if item.rating is not None]
    assert len(with_tmdb) >= 50
    assert len(with_rating) >= 36
    assert any(item.tmdb_movie_id is None for item in rss.items)
    assert any(item.rating is None for item in rss.items)


def test_parse_fixture_checksum_is_stable():
    raw = FIXTURE.read_bytes()
    a = parse_letterboxd_rss(raw, username="sampleuser")
    b = parse_letterboxd_rss(raw, username="sampleuser")
    assert a.checksum == b.checksum
    assert len(a.checksum) == 64


def test_preview_rss_items_caps_unique_titles():
    items = [
        RssItem(title="Digger", year="2026", poster_url="https://a.ltrbxd.com/p.jpg"),
        RssItem(title="Digger", year="2026"),
        RssItem(title="Aftersun", year="2022"),
    ]
    preview = preview_rss_items(items, limit=8)
    assert [row["title"] for row in preview] == ["Digger", "Aftersun"]
    assert preview[0]["poster_url"].startswith("https://")


def test_fetch_profile_rss_404_is_not_found(monkeypatch):
    resp = MagicMock(status_code=404, text="Not Found", content=b"Not Found")
    monkeypatch.setattr(letterboxd_rss.requests.Session, "get", lambda self, url, timeout=10: resp)
    with pytest.raises(ValueError, match="not found"):
        fetch_profile_rss("missing_user")
    assert letterboxd_rss.last_rss_fingerprint("missing_user") is None


def test_fetch_profile_rss_403_is_unavailable_not_missing(monkeypatch):
    resp = MagicMock(status_code=403, text="Forbidden", content=b"Forbidden")
    monkeypatch.setattr(letterboxd_rss.requests.Session, "get", lambda self, url, timeout=10: resp)
    with pytest.raises(RssUnavailable, match="blocked"):
        fetch_profile_rss("public_user")


def test_fetch_profile_rss_success_caches_fingerprint(monkeypatch):
    raw = FIXTURE.read_bytes()
    resp = MagicMock(status_code=200, text=raw.decode("utf-8"), content=raw)
    monkeypatch.setattr(letterboxd_rss.requests.Session, "get", lambda self, url, timeout=10: resp)
    rss = fetch_profile_rss("sampleuser")
    assert len(rss.items) == 54
    stored = letterboxd_rss.last_rss_fingerprint("sampleuser")
    assert stored is not None
    assert stored.checksum == rss.checksum
    assert stored.item_count == 54
    assert stored.latest_guid == rss.latest_guid


@pytest.mark.asyncio
async def test_scrape_pipeline_rss_404_does_not_html_scrape(monkeypatch):
    diary_calls = []

    def boom(*_args, **_kwargs):
        raise AssertionError("HTML scrape must not run after RSS 404")

    def fake_rss(username):
        raise ValueError(f"User '{username}' not found")

    monkeypatch.setattr(scrape_pipeline, "fetch_profile_rss", fake_rss)
    monkeypatch.setattr(scrape_pipeline, "probe_profile_access", boom)
    monkeypatch.setattr(scrape_pipeline, "scrape_profile_sources", boom)

    with pytest.raises(ValueError, match="not found"):
        await scrape_and_analyze(object(), "ghost")
    assert diary_calls == []


@pytest.mark.asyncio
async def test_scrape_pipeline_rss_preview_after_html_probe(monkeypatch):
    traces: list[tuple[str, dict]] = []
    html_calls = []

    def fake_fetch(username: str) -> ProfileRss:
        return parse_letterboxd_rss(FIXTURE.read_bytes(), username=username)

    def fake_probe(username: str) -> None:
        traces.append(("probed", {"username": username}))

    async def fake_sources(*_args, **kwargs):
        html_calls.append(kwargs)
        return ProfileScrapeSources(
            diary=[{"title": "HTML Only", "year": "2024", "rating": 4, "watch_date": "2026-07-01"}],
            grid=[],
            film_count=1,
            review_count=0,
        )

    async def fake_analysis(_session, csv_files, *_args, **_kwargs):
        import pandas as pd

        watched = pd.read_csv(csv_files["watched.csv"])
        return {
            "total_films": len(watched),
            "all_films": [{"title": "HTML Only", "poster_path": "/x.jpg"}],
            "review_analysis": {"reviews": []},
        }

    monkeypatch.setattr(scrape_pipeline, "fetch_profile_rss", fake_fetch)
    monkeypatch.setattr(scrape_pipeline, "probe_profile_access", fake_probe)
    monkeypatch.setattr(scrape_pipeline, "scrape_profile_sources", fake_sources)
    monkeypatch.setattr(
        scrape_pipeline, "process_comprehensive_letterboxd_data", fake_analysis
    )

    def trace(stage, message, metrics=None):
        traces.append((stage, metrics or {}))

    stats = await scrape_and_analyze(
        object(), "sampleuser", analysis_period="lifetime", trace_callback=trace
    )

    preview = next(metrics for stage, metrics in traces if stage == "rss_preview")
    assert traces[0][0] == "scrape_started"
    assert any(stage == "probed" for stage, _ in traces)
    preview_index = next(i for i, (stage, _) in enumerate(traces) if stage == "rss_preview")
    probed_index = next(i for i, (stage, _) in enumerate(traces) if stage == "probed")
    assert probed_index < preview_index
    assert preview["item_count"] == 54
    assert preview["preview_only"] is True
    assert preview["feed_cap"] == FEED_ITEM_CAP
    assert preview["sample"][0]["title"] == "Digger"
    assert html_calls[0]["skip_probe"] is True
    # Cinema scale / analysis sees HTML diary, not 54 RSS items.
    assert stats["total_films"] == 1
    assert stats["scraped_film_count"] == 1
    assert stats["rss"]["item_count"] == 54
    assert stats["rss"]["preview_only"] is True
    assert stats["rss"]["checksum"]


@pytest.mark.asyncio
async def test_scrape_pipeline_html_block_skips_rss_preview(monkeypatch):
    traces: list[str] = []

    monkeypatch.setattr(
        scrape_pipeline,
        "fetch_profile_rss",
        lambda username: parse_letterboxd_rss(FIXTURE.read_bytes(), username=username),
    )

    def blocked(username: str) -> None:
        raise ValueError("Letterboxd is blocking automated access to this profile.")

    async def html_should_not_run(*_a, **_k):
        raise AssertionError("pagination must not start after HTML probe block")

    monkeypatch.setattr(scrape_pipeline, "probe_profile_access", blocked)
    monkeypatch.setattr(scrape_pipeline, "scrape_profile_sources", html_should_not_run)

    with pytest.raises(ValueError, match="blocking automated access"):
        await scrape_and_analyze(
            object(),
            "blocked_user",
            trace_callback=lambda stage, message, metrics=None: traces.append(stage),
        )
    assert "rss_preview" not in traces
    assert "scrape_started" in traces


@pytest.mark.asyncio
async def test_scrape_pipeline_rss_unavailable_falls_through_to_html(monkeypatch):
    def unavailable(_username: str):
        raise RssUnavailable("Letterboxd RSS for 'user1' was blocked")

    async def fake_sources(*_args, **kwargs):
        assert kwargs.get("skip_probe") is True
        return ProfileScrapeSources(
            diary=[{"title": "Film A", "year": "2025", "rating": 5, "watch_date": "2026-07-01"}],
            grid=[],
            film_count=1,
        )

    async def fake_analysis(_session, csv_files, *_args, **_kwargs):
        import pandas as pd

        watched = pd.read_csv(csv_files["watched.csv"])
        return {"total_films": len(watched), "all_films": [], "review_analysis": {"reviews": []}}

    monkeypatch.setattr(scrape_pipeline, "fetch_profile_rss", unavailable)
    monkeypatch.setattr(scrape_pipeline, "probe_profile_access", lambda _u: None)
    monkeypatch.setattr(scrape_pipeline, "scrape_profile_sources", fake_sources)
    monkeypatch.setattr(
        scrape_pipeline, "process_comprehensive_letterboxd_data", fake_analysis
    )

    stats = await scrape_and_analyze(object(), "user1", analysis_period="lifetime")
    assert stats["total_films"] == 1
    assert "rss" not in stats
