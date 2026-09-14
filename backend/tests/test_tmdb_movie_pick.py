from app.services.tmdb_client import pick_movie_result_id, poster_path_from_search_results

SHYAMALAN_SPLIT_ID = 381288
ECARTEE_SPLIT_ID = 411000  # Côté-Collins Écartée (2016), not Shyamalan Split

ECARTEE = {
    "id": ECARTEE_SPLIT_ID,
    "title": "Split",
    "original_title": "Écartée",
    "release_date": "2016-09-09",
    "popularity": 3.6,
    "vote_count": 12,
    "poster_path": "/ecartee.jpg",
}
SHYAMALAN_SPLIT = {
    "id": SHYAMALAN_SPLIT_ID,
    "title": "Split",
    "original_title": "Split",
    "release_date": "2017-01-20",
    "popularity": 80.0,
    "vote_count": 16000,
    "poster_path": "/split.jpg",
}


def test_pick_movie_prefers_matching_year_not_first_hit():
    results = [
        {"id": 1, "title": "1917", "release_date": "2017-01-01", "popularity": 90, "original_language": "es"},
        {"id": 530915, "title": "1917", "release_date": "2019-12-25", "popularity": 40, "original_language": "en"},
    ]
    assert pick_movie_result_id(results, 2019) == 530915


def test_pick_movie_without_year_keeps_first_result():
    results = [
        {"id": 1, "title": "Heat", "release_date": "1995-12-15", "popularity": 10},
        {"id": 2, "title": "Heat", "release_date": "1986-01-01", "popularity": 80},
    ]
    assert pick_movie_result_id(results, None) == 1


def test_pick_movie_empty_results():
    assert pick_movie_result_id([], 2019) is None


def test_poster_path_from_search_results_follows_year_pick():
    results = [
        {"id": 1, "title": "1917", "release_date": "2017-01-01", "popularity": 90, "poster_path": "/wrong.jpg"},
        {"id": 530915, "title": "1917", "release_date": "2019-12-25", "popularity": 40, "poster_path": "/right.jpg"},
    ]
    assert poster_path_from_search_results(results, 2019) == "/right.jpg"


def test_poster_path_from_search_results_empty():
    assert poster_path_from_search_results([], 2019) is None


def test_split_2016_does_not_pick_ecartee_namesake():
    """Diary Split / 2016 must resolve to Shyamalan Split (TMDB 2017), never Écartée."""
    assert pick_movie_result_id([ECARTEE, SHYAMALAN_SPLIT], 2016, "Split") == SHYAMALAN_SPLIT_ID
    assert pick_movie_result_id([ECARTEE, SHYAMALAN_SPLIT], 2016, "Split") != ECARTEE_SPLIT_ID


def test_exact_year_does_not_beat_popular_same_title_one_year_off():
    """Exact-year namesake must not outrank a much more voted title match ±1 year."""
    obscure_exact_year = {
        "id": 111,
        "title": "Split",
        "original_title": "Split",
        "release_date": "2016-09-09",
        "popularity": 3.6,
        "vote_count": 8,
    }
    popular_off_by_one = {
        "id": SHYAMALAN_SPLIT_ID,
        "title": "Split",
        "original_title": "Split",
        "release_date": "2017-01-20",
        "popularity": 80.0,
        "vote_count": 16000,
    }
    assert pick_movie_result_id([obscure_exact_year, popular_off_by_one], 2016, "Split") == SHYAMALAN_SPLIT_ID


def test_original_title_identity_beats_inflated_namesake_popularity():
    """A translated English title (Écartée as Split) must not win on vote_count alone."""
    hyped_ecartee = {**ECARTEE, "popularity": 99.0, "vote_count": 99_000}
    quiet_split = {**SHYAMALAN_SPLIT, "popularity": 1.0, "vote_count": 1}
    assert pick_movie_result_id([hyped_ecartee, quiet_split], 2016, "Split") == SHYAMALAN_SPLIT_ID


def test_letterboxd_slug_identifies_ecartee_when_that_film_was_logged():
    assert pick_movie_result_id(
        [ECARTEE, SHYAMALAN_SPLIT],
        2016,
        "Split",
        letterboxd_uri="https://letterboxd.com/film/ecartee/",
    ) == ECARTEE_SPLIT_ID


def test_unrelated_high_vote_title_cannot_steal_a_named_search():
    other = {
        "id": 99,
        "title": "Completely Different",
        "original_title": "Completely Different",
        "release_date": "2016-01-01",
        "popularity": 99.0,
        "vote_count": 99_000,
        "poster_path": "/wrong.jpg",
    }
    assert pick_movie_result_id([other, SHYAMALAN_SPLIT], 2016, "Split") == SHYAMALAN_SPLIT_ID
