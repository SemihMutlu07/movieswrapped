"""Poster selection: vote_count inside a language pool, not vote_average."""

from tests.poster_eval_set import SUSPECT_FILMS
from app.services.tmdb_client import fetch_comprehensive_film_details, select_poster_path


def _poster(path, lang, votes, average, aspect=0.667):
    return {
        "file_path": path,
        "iso_639_1": lang,
        "vote_count": votes,
        "vote_average": average,
        "aspect_ratio": aspect,
    }


def test_suspect_eval_ids_match_the_named_films():
    """Burning, Shoplifters, and Decision to Leave are not the earlier wrong ids."""
    by_title = {title: movie_id for movie_id, _lang, title in SUSPECT_FILMS}
    assert by_title["Burning"] == 491584
    assert by_title["Shoplifters"] == 505192
    assert by_title["Decision to Leave"] == 705996
    ids = {movie_id for movie_id, _lang, _title in SUSPECT_FILMS}
    assert ids.isdisjoint({498229, 493922, 626332})
    assert len(SUSPECT_FILMS) == len(ids) == 36


def test_vote_average_leader_loses_to_higher_vote_count():
    """Fight Club / Godfather pattern: a one-vote 10.0 must not beat the consensus poster."""
    posters = [
        _poster("/odd.jpg", "en", 1, 10.0),
        _poster("/primary.jpg", "en", 2, 5.2),
        _poster("/popular.jpg", "en", 46, 5.4),
    ]
    assert select_poster_path("/primary.jpg", posters, "en") == "/popular.jpg"


def test_primary_kept_when_it_has_the_most_votes():
    posters = [
        _poster("/primary.jpg", "en", 40, 5.1),
        _poster("/alt.jpg", "en", 12, 8.0),
    ]
    assert select_poster_path("/primary.jpg", posters, "en") == "/primary.jpg"


def test_single_vote_does_not_replace_primary():
    posters = [
        _poster("/primary.jpg", "en", 0, 0),
        _poster("/lone.jpg", "en", 1, 10.0),
    ]
    assert select_poster_path("/primary.jpg", posters, "en") == "/primary.jpg"


def test_textless_poster_does_not_beat_an_english_poster():
    """Null-language art can be heavily voted and still the wrong one-sheet."""
    posters = [
        _poster("/primary.jpg", "en", 4, 5.2),
        _poster("/textless.jpg", None, 80, 6.0),
    ]
    assert select_poster_path("/primary.jpg", posters, "en") == "/primary.jpg"


def test_unvoted_english_poster_blocks_textless_override():
    posters = [
        _poster("/primary.jpg", "en", 0, 0),
        _poster("/textless.jpg", None, 80, 6.0),
    ]
    assert select_poster_path("/primary.jpg", posters, "en") == "/primary.jpg"


def test_original_language_used_when_no_english_poster_exists():
    posters = [
        _poster("/ru-odd.jpg", "ru", 1, 9.0),
        _poster("/ru-popular.jpg", "ru", 20, 5.1),
        _poster("/textless.jpg", None, 50, 5.5),
    ]
    assert select_poster_path("/ru-odd.jpg", posters, "ru") == "/ru-popular.jpg"


def test_english_poster_beats_a_more_voted_original_language_poster():
    posters = [
        _poster("/ko.jpg", "ko", 100, 5.5),
        _poster("/en.jpg", "en", 8, 5.1),
    ]
    assert select_poster_path("/ko.jpg", posters, "ko") == "/en.jpg"


def test_non_poster_aspect_is_ignored():
    posters = [
        _poster("/banner.jpg", "en", 90, 5.5, aspect=1.78),
        _poster("/primary.jpg", "en", 3, 5.1),
    ]
    assert select_poster_path("/primary.jpg", posters, "en") == "/primary.jpg"


def test_empty_images_keeps_primary():
    assert select_poster_path("/primary.jpg", None, "en") == "/primary.jpg"
    assert select_poster_path("/primary.jpg", [], "en") == "/primary.jpg"


def test_no_primary_uses_highest_english_vote_count():
    posters = [
        _poster("/odd.jpg", "en", 2, 9.0),
        _poster("/popular.jpg", "en", 15, 5.0),
    ]
    assert select_poster_path("", posters, "ja") == "/popular.jpg"


async def test_comprehensive_fetch_applies_vote_count_rule(monkeypatch):
    async def fake_get(session, endpoint, params=None, cache=True):
        del session, params, cache
        if endpoint.endswith("/images"):
            return {
                "posters": [
                    _poster("/primary.jpg", "en", 1, 9.9),
                    _poster("/popular.jpg", "en", 22, 5.2),
                ]
            }
        if endpoint.endswith("/credits"):
            return {"crew": [], "cast": []}
        if endpoint.endswith("/keywords"):
            return {"keywords": []}
        return {
            "poster_path": "/primary.jpg",
            "original_language": "ru",
            "title": "Come and See",
            "genres": [],
            "production_countries": [],
            "production_companies": [],
        }

    monkeypatch.setattr("app.services.tmdb_client.tmdb_get", fake_get)
    result = await fetch_comprehensive_film_details(None, 25237)
    assert result["poster_path"] == "/popular.jpg"
