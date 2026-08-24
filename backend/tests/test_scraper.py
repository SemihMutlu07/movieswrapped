import asyncio

import pytest
from bs4 import BeautifulSoup

from app.services import scraper


class FakeSession:
    def __init__(self):
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        self.closed = True

    def close(self):
        self.closed = True

    def get(self, url, timeout):
        # Overview fetch in _sync_scrape_profile_sources hits this — empty body skips count parsing
        return FakeResponse(200, "")


def _run_scraper_executor_inline(monkeypatch):
    """Keep scraper async tests hermetic; they validate orchestration, not threads."""
    running_loop = asyncio.get_running_loop()

    class InlineExecutorLoop:
        def run_in_executor(self, executor, func):
            future = running_loop.create_future()
            try:
                future.set_result(func())
            except BaseException as exc:
                future.set_exception(exc)
            return future

    monkeypatch.setattr(scraper.asyncio, "get_event_loop", lambda: InlineExecutorLoop())


def test_scrape_profile_sources_reuses_one_session(monkeypatch):
    sessions: list[FakeSession] = []
    calls: list[tuple] = []

    def fake_new_session():
        session = FakeSession()
        sessions.append(session)
        return session

    def fake_warm_session(session):
        calls.append(("warm", id(session)))

    def fake_scrape_diary(username, max_pages, session=None):
        calls.append(("diary", id(session), username, max_pages))
        return [{"title": "Diary Film", "year": "2024", "rating": None, "watch_date": "2024-01-01"}]

    def fake_scrape_grid(username, max_pages, session=None):
        calls.append(("grid", id(session), username, max_pages))
        return [{"title": "Grid Film", "year": "2024", "rating": 4.0, "watch_date": ""}]

    monkeypatch.setattr(scraper, "_new_session", fake_new_session)
    monkeypatch.setattr(scraper, "_warm_session", fake_warm_session)
    monkeypatch.setattr(scraper, "_sync_scrape_diary", fake_scrape_diary)
    monkeypatch.setattr(scraper, "_sync_scrape_films_grid", fake_scrape_grid)

    result = scraper._sync_scrape_profile_sources("semihmutsuz", 60)

    assert isinstance(result, scraper.ProfileScrapeSources)
    assert len(sessions) == 1
    assert sessions[0].closed is True
    assert result.diary[0]["title"] == "Diary Film"
    assert result.grid[0]["title"] == "Grid Film"
    assert result.review_count == 0  # no fake overview page
    assert result.film_count == 0
    assert result.reviews == []  # include_reviews defaults to False
    assert calls == [
        ("warm", id(sessions[0])),
        ("diary", id(sessions[0]), "semihmutsuz", 60),
        ("grid", id(sessions[0]), "semihmutsuz", 60),
    ]


class FakeResponse:
    def __init__(self, status_code, text=""):
        self.status_code = status_code
        self.text = text


class WatchlistSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.closed = False
        self.urls: list[str] = []

    def get(self, url, timeout):
        self.urls.append(url)
        return self.responses.pop(0)

    def close(self):
        self.closed = True


def test_scrape_watchlist_parses_grid_items_and_closes_owned_session(monkeypatch):
    html = """
    <ul>
      <li class="griditem">
        <div data-component-class="LazyPoster" data-item-name="Inception (2010)" data-item-slug="/film/inception/"></div>
      </li>
      <li class="griditem">
        <div data-component-class="LazyPoster" data-item-name="Aftersun (2022)" data-item-slug="/film/aftersun/"></div>
      </li>
    </ul>
    """
    session = WatchlistSession([
        FakeResponse(200, html),
        FakeResponse(200, ""),
    ])

    monkeypatch.setattr(scraper, "_new_session", lambda: session)
    monkeypatch.setattr(scraper, "_warm_session", lambda s: None)
    monkeypatch.setattr(scraper, "PAGE_DELAY", 0)

    films = scraper._sync_scrape_watchlist("semihmutsuz", 5)

    assert session.closed is True
    assert session.urls == [
        "https://letterboxd.com/semihmutsuz/watchlist/page/1/",
        "https://letterboxd.com/semihmutsuz/watchlist/page/2/",
    ]
    assert films == [
        {"title": "Inception", "year": "2010", "rating": None, "watch_date": "", "slug": "/film/inception/", "poster_url": ""},
        {"title": "Aftersun", "year": "2022", "rating": None, "watch_date": "", "slug": "/film/aftersun/", "poster_url": ""},
    ]


@pytest.mark.parametrize("status", [403, 429])
def test_scrape_watchlist_raises_for_block_status(monkeypatch, status):
    session = WatchlistSession([FakeResponse(status, "blocked")])
    monkeypatch.setattr(scraper, "_new_session", lambda: session)
    monkeypatch.setattr(scraper, "_warm_session", lambda s: None)
    with pytest.raises(scraper.WatchlistScrapeError, match=str(status)) as caught:
        scraper._sync_scrape_watchlist("user", 1)
    assert caught.value.error_code == "watchlist_blocked"


def test_scrape_watchlist_rejects_cloudflare_and_malformed_empty(monkeypatch):
    for html in ("<title>Just a moment...</title><div>Cloudflare</div>", "<html><main>unexpected</main></html>"):
        session = WatchlistSession([FakeResponse(200, html)])
        monkeypatch.setattr(scraper, "_new_session", lambda: session)
        monkeypatch.setattr(scraper, "_warm_session", lambda s: None)
        with pytest.raises(scraper.WatchlistScrapeError):
            scraper._sync_scrape_watchlist("user", 1)


def test_scrape_watchlist_accepts_evidenced_empty(monkeypatch):
    html = '<html><body><div class="js-watchlist-content"><p>Your watchlist is empty</p></div></body></html>'
    session = WatchlistSession([FakeResponse(200, html)])
    monkeypatch.setattr(scraper, "_new_session", lambda: session)
    monkeypatch.setattr(scraper, "_warm_session", lambda s: None)
    assert scraper._sync_scrape_watchlist("user", 1) == []


def test_scrape_watchlist_rejects_empty_container_without_explicit_empty_state(monkeypatch):
    html = '<html><body><div class="js-watchlist-content"><ul class="film-grid"></ul></div></body></html>'
    session = WatchlistSession([FakeResponse(200, html)])
    monkeypatch.setattr(scraper, "_new_session", lambda: session)
    monkeypatch.setattr(scraper, "_warm_session", lambda s: None)

    with pytest.raises(scraper.WatchlistScrapeError) as caught:
        scraper._sync_scrape_watchlist("user", 1)
    assert caught.value.error_code == "watchlist_malformed_response"


def test_scrape_watchlist_wraps_transport_failure(monkeypatch):
    session = WatchlistSession([])
    monkeypatch.setattr(scraper, "_new_session", lambda: session)
    monkeypatch.setattr(scraper, "_warm_session", lambda s: None)
    monkeypatch.setattr(scraper, "_fetch", lambda *args, **kwargs: (_ for _ in ()).throw(OSError("offline")))
    with pytest.raises(scraper.WatchlistScrapeError, match="transport error") as caught:
        scraper._sync_scrape_watchlist("user", 1)
    assert caught.value.error_code == "watchlist_transport_error"


def test_parse_review_cards_extracts_fields_and_likes():
    html = """
    <article class="production-viewing">
      <div data-component-class="LazyPoster" data-item-slug="memories-of-underdevelopment"></div>
      <div class="body">
        <header><div class="topline">
          <h2 class="primaryname"><a href="/semihmutsuz/film/memories-of-underdevelopment/">Memories of Underdevelopment</a></h2>
          <span class="releasedate">1968</span>
        </div></header>
        <span class="inline-rating"><svg aria-label="★★★★"><title>★★★★</title></svg></span>
        <span class="date"><time class="timestamp" datetime="2024-03-04">04 Mar 2024</time></span>
        <div class="js-review-body body-text"><p>Sergio's gaze is sharper than any thesis on alienation.</p></div>
        <p data-component-class="LikeComponent" data-count="12"></p>
      </div>
    </article>
    <article class="production-viewing">
      <div data-component-class="LazyPoster" data-item-slug="aftersun"></div>
      <div class="body">
        <header><div class="topline">
          <h2 class="primaryname"><a href="/u/film/aftersun/">Aftersun</a></h2>
          <span class="releasedate">2022</span>
        </div></header>
        <div class="js-review-body body-text"><p>Quiet, devastating.</p></div>
      </div>
    </article>
    """
    soup = BeautifulSoup(html, "html.parser")
    reviews = scraper._parse_review_cards(soup)

    assert len(reviews) == 2
    first = reviews[0]
    assert first["title"] == "Memories of Underdevelopment"
    assert first["year"] == "1968"
    assert first["slug"] == "memories-of-underdevelopment"
    assert first["rating"] == 4.0  # ★★★★ → 4.0 stars
    assert first["review_text"].startswith("Sergio's gaze")
    assert first["date"] == "2024-03-04"
    assert first["like_count"] == 12

    second = reviews[1]
    assert second["title"] == "Aftersun"
    assert second["like_count"] is None  # no LikeComponent present


def test_parse_review_cards_preserves_exact_review_path_with_rewatch_suffix():
    # The heading href is the review permalink; a rewatch keeps a trailing index
    # like /user/film/slug/2/ which must survive so we can hit its /likes/ page.
    html = """
    <article class="production-viewing">
      <div data-component-class="LazyPoster" data-item-slug="stalker"></div>
      <div class="body"><header><div class="topline">
        <h2 class="primaryname"><a href="/semihmutsuz/film/stalker/2/">Stalker</a></h2>
        <span class="releasedate">1979</span>
      </div></header></div>
    </article>
    """
    soup = BeautifulSoup(html, "html.parser")
    reviews = scraper._parse_review_cards(soup)
    assert reviews[0]["slug"] == "stalker"
    assert reviews[0]["review_path"] == "/semihmutsuz/film/stalker/2/"


def test_parse_liker_cards_extracts_identity_and_validates_avatar_host():
    html = """
    <ul>
      <li><div class="person-summary">
        <a href="/alice/" class="avatar"><img src="https://a.ltrbxd.com/av/alice.jpg" alt="Alice"></a>
        <a href="/alice/" class="name">Alice A</a>
      </div></li>
      <li><div class="person-summary">
        <a href="/bob/" class="avatar"><img src="https://evil.com/bob.jpg" alt="Bob"></a>
        <a href="/bob/" class="name">Bob</a>
      </div></li>
    </ul>
    """
    soup = BeautifulSoup(html, "html.parser")
    likers = scraper._parse_liker_cards(soup)
    assert likers[0] == {"username": "alice", "display_name": "Alice A",
                         "avatar_url": "https://a.ltrbxd.com/av/alice.jpg"}
    # Foreign-host avatar is dropped to None, but the identity is still captured.
    assert likers[1]["username"] == "bob"
    assert likers[1]["avatar_url"] is None


def test_scrape_review_likers_skips_http_when_no_likes(monkeypatch):
    def boom(*a, **k):
        raise AssertionError("must not fetch when like_count == 0")
    monkeypatch.setattr(scraper, "_fetch", boom)
    likers, complete = scraper._scrape_review_likers("/u/film/x/", 0, object())
    assert likers == []
    assert complete is True


def test_scrape_review_likers_parses_and_uses_exact_path(monkeypatch):
    page = """
    <li><div class="person-summary">
      <a href="/alice/" class="name">Alice</a>
      <img src="https://a.ltrbxd.com/av/alice.jpg" alt="Alice">
    </div></li>
    """
    session = WatchlistSession([FakeResponse(200, page)])
    monkeypatch.setattr(scraper, "PAGE_DELAY", 0)
    likers, complete = scraper._scrape_review_likers("/semihmutsuz/film/stalker/2/", 1, session)
    assert session.urls == ["https://letterboxd.com/semihmutsuz/film/stalker/2/likes/"]
    assert [l["username"] for l in likers] == ["alice"]
    assert complete is True


def test_scrape_review_likers_follows_pagination(monkeypatch):
    p1 = """
    <div class="person-summary"><a href="/a/" class="name">A</a></div>
    <div class="paginate-nextprev"><a class="next" href="/x/likes/page/2/">Older</a></div>
    """
    p2 = """<div class="person-summary"><a href="/b/" class="name">B</a></div>"""
    session = WatchlistSession([FakeResponse(200, p1), FakeResponse(200, p2)])
    monkeypatch.setattr(scraper, "PAGE_DELAY", 0)
    likers, complete = scraper._scrape_review_likers("/u/film/x/", 5, session)
    assert session.urls == [
        "https://letterboxd.com/u/film/x/likes/",
        "https://letterboxd.com/u/film/x/likes/page/2/",
    ]
    assert [l["username"] for l in likers] == ["a", "b"]
    assert complete is True


def test_scrape_review_likers_partial_on_http_error(monkeypatch):
    p1 = """
    <div class="person-summary"><a href="/a/" class="name">A</a></div>
    <div class="paginate-nextprev"><a class="next" href="/x/likes/page/2/">Older</a></div>
    """
    session = WatchlistSession([FakeResponse(200, p1), FakeResponse(429, "")])
    monkeypatch.setattr(scraper, "PAGE_DELAY", 0)
    likers, complete = scraper._scrape_review_likers("/u/film/x/", 9, session)
    assert [l["username"] for l in likers] == ["a"]  # keep what we found
    assert complete is False  # but flag it incomplete


def test_sync_scrape_reviews_attaches_likers_and_survives_one_failure(monkeypatch):
    monkeypatch.setattr(scraper, "PAGE_DELAY", 0)
    rev_p1 = """
    <article class="production-viewing">
      <div data-component-class="LazyPoster" data-item-slug="a"></div>
      <div class="body"><header><div class="topline">
        <h2 class="primaryname"><a href="/u/film/a/">A</a></h2><span class="releasedate">2020</span>
      </div></header><p data-component-class="LikeComponent" data-count="2"></p></div>
    </article>
    <article class="production-viewing">
      <div data-component-class="LazyPoster" data-item-slug="b"></div>
      <div class="body"><header><div class="topline">
        <h2 class="primaryname"><a href="/u/film/b/">B</a></h2><span class="releasedate">2021</span>
      </div></header><p data-component-class="LikeComponent" data-count="5"></p></div>
    </article>
    """
    b_likes = """<div class="person-summary"><a href="/fan/" class="name">Fan</a></div>"""
    traces: list[tuple] = []
    session = WatchlistSession([
        FakeResponse(200, rev_p1),   # reviews page 1
        FakeResponse(200, ""),       # reviews page 2 → empty, stop paging
        FakeResponse(403, ""),       # A's likers → blocked (partial)
        FakeResponse(200, b_likes),  # B's likers → ok
    ])
    reviews = scraper._sync_scrape_reviews(
        "u", 5, session=session, include_likers=True,
        trace_callback=lambda stage, msg, data: traces.append((stage, data)),
    )
    assert [r["title"] for r in reviews] == ["A", "B"]
    # A's crawl failed but did not abort B's.
    assert reviews[0]["likers"] == [] and reviews[0]["likers_complete"] is False
    assert [l["username"] for l in reviews[1]["likers"]] == ["fan"]
    assert reviews[1]["likers_complete"] is True
    done = [d for s, d in traces if s == "review_likers_done"][0]
    assert done["review_likers_total"] == 2 and done["review_likers_completed"] == 1


def test_rating_from_svg_label_handles_halves():
    assert scraper._rating_from_svg_label("★★★½") == 3.5
    assert scraper._rating_from_svg_label("★★★★") == 4.0
    assert scraper._rating_from_svg_label("½") == 0.5
    assert scraper._rating_from_svg_label("") is None


def test_preview_items_caps_and_drops_untrusted_posters():
    sample = scraper.preview_items(
        [
            {"title": "Heat", "year": "1995", "poster_url": "https://a.ltrbxd.com/resized/heat.jpg"},
            {"title": "Heat", "year": "1995", "poster_url": "https://evil.example/heat.jpg"},
            {"title": "Inside", "year": "2023", "poster_url": "http://a.ltrbxd.com/inside.jpg"},
            {"title": "  ", "year": "1999"},
            {"title": "Kader", "year": "2006", "poster_url": "https://evil.example/kader.jpg"},
        ]
        + [{"title": f"Filler {i}"} for i in range(12)],
        limit=8,
    )
    assert [item["title"] for item in sample] == ["Heat", "Inside", "Kader"] + [f"Filler {i}" for i in range(5)]
    assert sample[0]["poster_url"].startswith("https://a.ltrbxd.com/")
    assert "poster_url" not in sample[1]
    assert "poster_url" not in sample[2]
    assert len(sample) == 8


def test_sync_scrape_reviews_walks_pages_and_stops_on_empty(monkeypatch):
    page_html = """
    <article class="production-viewing">
      <div data-component-class="LazyPoster" data-item-slug="x"></div>
      <div class="body">
        <header><div class="topline">
          <h2 class="primaryname"><a href="/u/film/x/">X</a></h2>
          <span class="releasedate">2024</span>
        </div></header>
        <div class="js-review-body body-text"><p>ok</p></div>
        <p data-component-class="LikeComponent" data-count="3"></p>
      </div>
    </article>
    """
    session = WatchlistSession([
        FakeResponse(200, page_html),
        FakeResponse(200, "<main></main>"),  # empty page → loop should stop
    ])

    monkeypatch.setattr(scraper, "_new_session", lambda: session)
    monkeypatch.setattr(scraper, "_warm_session", lambda s: None)
    monkeypatch.setattr(scraper, "PAGE_DELAY", 0)

    reviews = scraper._sync_scrape_reviews("semihmutsuz", 5)

    assert session.closed is True
    assert session.urls == [
        "https://letterboxd.com/semihmutsuz/reviews/films/page/1/",
        "https://letterboxd.com/semihmutsuz/reviews/films/page/2/",
    ]
    assert len(reviews) == 1
    assert reviews[0]["title"] == "X"
    assert reviews[0]["like_count"] == 3


def test_sync_scrape_profile_sources_skips_reviews_by_default(monkeypatch):
    calls: list[str] = []

    monkeypatch.setattr(scraper, "_new_session", lambda: FakeSession())
    monkeypatch.setattr(scraper, "_warm_session", lambda s: None)
    monkeypatch.setattr(scraper, "_sync_scrape_diary", lambda u, m, session=None: [])
    monkeypatch.setattr(scraper, "_sync_scrape_films_grid", lambda u, m, session=None: [])

    def fail_if_called(*args, **kwargs):
        calls.append("reviews")
        return []

    monkeypatch.setattr(scraper, "_sync_scrape_reviews", fail_if_called)

    result = scraper._sync_scrape_profile_sources("semihmutsuz", 5)
    assert calls == []
    assert result.reviews == []


def test_sync_scrape_profile_sources_includes_reviews_when_flagged(monkeypatch):
    monkeypatch.setattr(scraper, "_new_session", lambda: FakeSession())
    monkeypatch.setattr(scraper, "_warm_session", lambda s: None)
    monkeypatch.setattr(scraper, "_sync_scrape_diary", lambda u, m, session=None: [])
    monkeypatch.setattr(scraper, "_sync_scrape_films_grid", lambda u, m, session=None: [])
    monkeypatch.setattr(
        scraper,
        "_sync_scrape_reviews",
        lambda u, m, session=None, include_likers=False: [{"title": "X", "like_count": 7, "review_text": "ok"}],
    )

    result = scraper._sync_scrape_profile_sources("semihmutsuz", 5, include_reviews=True)
    assert result.reviews == [{"title": "X", "like_count": 7, "review_text": "ok"}]


async def test_scrape_profile_sources_runs_sources_in_parallel(monkeypatch):
    """Async orchestrator merges diary/grid/overview (each its own thread+session)."""
    _run_scraper_executor_inline(monkeypatch)
    monkeypatch.setattr(scraper, "_sync_scrape_diary",
                        lambda u, p, s=None, t=None: [{"title": "D", "year": "2024", "rating": None, "watch_date": "2024-01-01"}])
    monkeypatch.setattr(scraper, "_sync_scrape_films_grid",
                        lambda u, p, s=None, t=None: [{"title": "G", "year": "2024", "rating": 4.0, "watch_date": ""}])
    monkeypatch.setattr(scraper, "_sync_scrape_overview", lambda u, s=None, t=None: (42, 7, [], None))

    result = await scraper.scrape_profile_sources("semihmutsuz", 5)

    assert result.diary[0]["title"] == "D"
    assert result.grid[0]["title"] == "G"
    assert result.film_count == 42
    assert result.review_count == 7
    assert result.reviews == []  # include_reviews defaults False


async def test_scrape_profile_sources_raises_when_both_film_sources_fail(monkeypatch):
    """If diary AND grid both fail, the real error (e.g. 'not found') must surface."""
    _run_scraper_executor_inline(monkeypatch)
    def boom(u, p, s=None, t=None):
        raise ValueError(f"User '{u}' not found")
    monkeypatch.setattr(scraper, "_sync_scrape_diary", boom)
    monkeypatch.setattr(scraper, "_sync_scrape_films_grid", boom)
    monkeypatch.setattr(scraper, "_sync_scrape_overview", lambda u, s=None, t=None: (0, 0, [], None))

    with pytest.raises(ValueError, match="not found"):
        await scraper.scrape_profile_sources("ghost", 5)


async def test_scrape_profile_sources_survives_one_source_failing(monkeypatch):
    """One film source failing is tolerated — the other still produces results."""
    _run_scraper_executor_inline(monkeypatch)
    monkeypatch.setattr(scraper, "_sync_scrape_diary",
                        lambda u, p, s=None, t=None: (_ for _ in ()).throw(ValueError("rate limit")))
    monkeypatch.setattr(scraper, "_sync_scrape_films_grid",
                        lambda u, p, s=None, t=None: [{"title": "G", "year": "2024", "rating": 4.0, "watch_date": ""}])
    monkeypatch.setattr(scraper, "_sync_scrape_overview", lambda u, s=None, t=None: (10, 0, [], None))

    result = await scraper.scrape_profile_sources("semihmutsuz", 5)

    assert result.diary == []
    assert result.grid[0]["title"] == "G"


def test_parse_diary_rows_dates_rows_without_month_link():
    """Letterboxd renders the month <a> only on the FIRST row of each month;
    later rows in the same month have an empty .col-monthdate. The day cell's
    href carries the full /for/YYYY/MM/DD/ date, so every diary row must still
    get a watch_date — not just the first row of each month.

    Regression: requiring a month-link dropped ~88% of diary dates, collapsing
    a 410-entry diary to ~47 'watched' rows (one per distinct month).
    """
    html = """
    <table><tbody>
      <tr class="diary-entry-row">
        <td class="col-monthdate"><a href="/u/films/diary/for/2024/03/">Mar 2024</a></td>
        <td class="col-daydate"><a href="/u/films/diary/for/2024/03/15/">15</a></td>
        <td class="col-production"><a href="/film/a/">Film A</a></td>
        <td class="col-releaseyear">2020</td>
        <td class="col-rating"><span class="rating rated-8"></span></td>
      </tr>
      <tr class="diary-entry-row">
        <td class="col-monthdate"></td>
        <td class="col-daydate"><a href="/u/films/diary/for/2024/03/14/">14</a></td>
        <td class="col-production"><a href="/film/b/">Film B</a></td>
        <td class="col-releaseyear">2019</td>
        <td class="col-rating"><span class="rating rated-6"></span></td>
      </tr>
    </tbody></table>
    """
    soup = BeautifulSoup(html, "html.parser")
    films = scraper._parse_diary_rows(soup)

    by_title = {f["title"]: f for f in films}
    assert by_title["Film A"]["watch_date"] == "2024-03-15"
    # Film B has no month-link but a dated day-link — must still be dated.
    assert by_title["Film B"]["watch_date"] == "2024-03-14"


def test_diary_to_csv_dicts_keeps_undated_films_in_watched():
    """Undated films (grid-only / IMDB bulk imports with no Letterboxd watch
    date) must still count as watched and rated — only the diary timeline is
    gated by watch_date.

    Regression: c5adb3c excluded undated films from watched/ratings too, which
    collapsed full ~700-film profiles down to just the dated diary subset.
    """
    films = [
        {"title": "Dated", "year": 2020, "rating": 4.0, "watch_date": "2024-03-15"},
        {"title": "Undated", "year": 2019, "rating": 3.5, "watch_date": ""},
    ]
    result = scraper.diary_to_csv_dicts(films)

    watched_titles = {r["Name"] for r in result["watched"]}
    rated_titles = {r["Name"] for r in result["ratings"]}
    diary_titles = {r["Name"] for r in result["diary"]}

    # Both films count as watched and rated...
    assert watched_titles == {"Dated", "Undated"}
    assert rated_titles == {"Dated", "Undated"}
    # ...but only the dated film feeds the diary timeline.
    assert diary_titles == {"Dated"}


# ── Profile avatar extraction (trust boundary) ──────────────────────────────
# The avatar URL is scraped from an untrusted page and later surfaced to the
# browser / persisted. Only an https URL on Letterboxd's own CDN may pass —
# anything else (http downgrade, attacker-controlled host) must be dropped.

def _overview_avatar(monkeypatch, avatar_src: str) -> str | None:
    html = f'<div id="avatar-large"><img src="{avatar_src}"></div>'
    monkeypatch.setattr(scraper, "_fetch", lambda s, url, timeout=10: FakeResponse(200, html))
    _, _, _, avatar_url = scraper._sync_scrape_overview("semihmutsuz", session=object())
    return avatar_url


def test_overview_captures_https_letterboxd_avatar(monkeypatch):
    src = "https://a.ltrbxd.com/resized/avatar/upload/1/2/3/avtr.jpg"
    assert _overview_avatar(monkeypatch, src) == src


def test_overview_rejects_non_https_avatar(monkeypatch):
    # http downgrade — reject even on the correct host.
    assert _overview_avatar(monkeypatch, "http://a.ltrbxd.com/resized/avtr.jpg") is None


def test_overview_rejects_foreign_host_avatar(monkeypatch):
    # https but attacker-controlled host must not be surfaced/persisted.
    assert _overview_avatar(monkeypatch, "https://evil.com/avtr.jpg") is None
    # A look-alike suffix must not slip past the host check either.
    assert _overview_avatar(monkeypatch, "https://ltrbxd.com.evil.com/avtr.jpg") is None


async def test_scrape_avatar_only_returns_validated_avatar(monkeypatch):
    """CSV/ZIP path's lightweight avatar job reuses the same overview fetch + trust-boundary check."""
    _run_scraper_executor_inline(monkeypatch)
    src = "https://a.ltrbxd.com/resized/avatar/upload/1/2/3/avtr.jpg"
    html = f'<div id="avatar-large"><img src="{src}"></div>'
    monkeypatch.setattr(scraper, "_fetch", lambda s, url, timeout=10: FakeResponse(200, html))
    assert await scraper.scrape_avatar_only("semihmutsuz") == src


async def test_scrape_avatar_only_returns_none_when_unavailable(monkeypatch):
    """No avatar element on the page must not raise — CSV path treats this as 'no avatar'."""
    _run_scraper_executor_inline(monkeypatch)
    monkeypatch.setattr(scraper, "_fetch", lambda s, url, timeout=10: FakeResponse(200, "<div></div>"))
    assert await scraper.scrape_avatar_only("semihmutsuz") is None


def test_review_listing_truncation_heuristic():
    assert scraper._review_listing_looks_truncated("excerpt ends here…") is True
    assert scraper._review_listing_looks_truncated("excerpt ends here...") is True
    assert scraper._review_listing_looks_truncated("x" * 700) is True
    assert scraper._review_listing_looks_truncated("complete short review") is False


def test_hydrate_truncated_review_texts_fetches_detail_page(monkeypatch):
    listing_excerpt = "partial text that keeps going…"
    full_text = "partial text that keeps going with many more words on the detail page"
    detail_html = f'<div class="js-review-body body-text"><p>{full_text}</p></div>'
    session = WatchlistSession([FakeResponse(200, detail_html)])
    reviews = [
        {
            "title": "Long Film",
            "review_path": "/semihmutsuz/film/long-film/1/",
            "review_text": listing_excerpt,
        }
    ]
    monkeypatch.setattr(scraper, "PAGE_DELAY", 0)
    scraper._hydrate_truncated_review_texts(reviews, session)
    assert reviews[0]["review_text"] == full_text
    assert session.urls == ["https://letterboxd.com/semihmutsuz/film/long-film/1/"]
