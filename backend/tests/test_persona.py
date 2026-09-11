"""Unit tests for the persona module."""

from __future__ import annotations

import pandas as pd
import pytest

from app.services.persona import (
    compute_cinematic_persona,
    compute_film_age_analysis,
    compute_furthest_destination,
    compute_insights,
    compute_runtime_persona,
    compute_secret_obsession,
    compute_story_analytics,
)


class TestComputeCinematicPersona:
    def test_known_persona(self):
        result = compute_cinematic_persona("Action", "2020s", "USA")
        assert result["persona"] == "Blockbuster Addict"
        assert "explosions" in result["description"]

    def test_known_persona_japan(self):
        result = compute_cinematic_persona("Animation", "2000s", "Japan")
        assert result["persona"] == "Anime Connoisseur"

    def test_fallback_by_genre(self):
        result = compute_cinematic_persona("Horror", "1990s", "France")
        assert result["persona"] == "Horror Devotee"

    def test_generic_fallback(self):
        result = compute_cinematic_persona("Musical", "2020s", "India")
        assert result["persona"] == "Musical Enthusiast"

    def test_unknown_fallbacks(self):
        result = compute_cinematic_persona("Unknown", "Unknown", "Unknown")
        assert result["persona"] == "Genre-Defying Enthusiast"

    def test_empty_strings(self):
        result = compute_cinematic_persona("", "", "")
        assert result["persona"] == "Genre-Defying Enthusiast"


class TestComputeFilmAgeAnalysis:
    def test_basic(self):
        films_enriched = pd.DataFrame({
            "release_date": [
                "2020-01-01",
                "2015-06-15",
                "2023-03-10",
                "2000-12-25",
                "2018-07-07",
            ],
        })
        result = compute_film_age_analysis(films_enriched)
        assert result is not None
        assert "average_age" in result
        assert "recent_percentage" in result

    def test_no_release_date(self):
        films_enriched = pd.DataFrame({"title": ["A"]})
        assert compute_film_age_analysis(films_enriched) is None

    def test_empty(self):
        assert compute_film_age_analysis(pd.DataFrame()) is None

    def test_all_nulls(self):
        films_enriched = pd.DataFrame({"release_date": [None, None]})
        assert compute_film_age_analysis(films_enriched) is None


class TestComputeInsights:
    def test_time_invested(self):
        stats = {"days_watched": 10}
        insights = compute_insights(stats)
        assert any(i["title"] == "Time Invested" for i in insights)
        assert any("10" in i["description"] for i in insights if i["title"] == "Time Invested")

    def test_director_obsession(self):
        stats = {
            "most_watched_director": {"name": "Nolan", "count": 5},
        }
        insights = compute_insights(stats)
        assert any("Director Obsession" in i["title"] for i in insights)

    def test_easy_to_please(self):
        stats = {"average_rating": 4.5}
        insights = compute_insights(stats)
        assert any("Easy to Please" in i["title"] for i in insights)

    def test_tough_critic(self):
        stats = {"average_rating": 2.5}
        insights = compute_insights(stats)
        assert any("Tough Critic" in i["title"] for i in insights)

    def test_global_explorer(self):
        stats = {"total_countries": 15}
        insights = compute_insights(stats)
        assert any("Global Cinema Explorer" in i["title"] for i in insights)

    def test_empty_stats(self):
        assert compute_insights({}) == []


class TestComputeSecretObsession:
    def test_non_genre_keyword(self):
        stats = {
            "keywords_analytics": {
                "top_keywords": [
                    {"keyword": "explosion", "count": 5},
                    {"keyword": "car chase", "count": 3},
                ],
            },
            "top_genres": [
                {"name": "Action", "count": 10},
                {"name": "Comedy", "count": 5},
            ],
        }
        result = compute_secret_obsession(stats)
        assert result == "explosion"

    def test_keyword_is_genre(self):
        stats = {
            "keywords_analytics": {
                "top_keywords": [
                    {"keyword": "Action", "count": 5},
                    {"keyword": "Thriller", "count": 3},
                ],
            },
            "top_genres": [
                {"name": "Action", "count": 10},
                {"name": "Thriller", "count": 5},
            ],
        }
        result = compute_secret_obsession(stats)
        # Both keywords are genre names — no non-genre keyword found but function
        # still returns the first that ISN'T in genre_names. "Action" is in genre_names,
        # so it's skipped. "Thriller" is also in genre_names. Returns None.
        assert result is None

    def test_no_keywords(self):
        assert compute_secret_obsession({}) is None


class TestComputeRuntimePersona:
    def test_marathoner(self):
        stats = {"average_runtime": 135}
        assert compute_runtime_persona(stats) == "The Marathoner"

    def test_sprinter(self):
        stats = {"average_runtime": 90}
        assert compute_runtime_persona(stats) == "The Sprinter"

    def test_balanced(self):
        stats = {"average_runtime": 115}
        assert compute_runtime_persona(stats) == "The Balanced Viewer"

    def test_no_runtime(self):
        assert compute_runtime_persona({}) == "The Balanced Viewer"


class TestComputeFurthestDestination:
    def test_finds_non_usa_uk(self):
        stats = {
            "top_countries": [
                {"name": "USA", "count": 50},
                {"name": "Japan", "count": 10},
                {"name": "France", "count": 5},
            ],
        }
        assert compute_furthest_destination(stats) == "Japan"

    def test_only_usa_uk(self):
        stats = {
            "top_countries": [
                {"name": "USA", "count": 50},
                {"name": "UK", "count": 10},
            ],
        }
        assert compute_furthest_destination(stats) is None

    def test_no_countries(self):
        assert compute_furthest_destination({}) is None


class TestComputeStoryAnalytics:
    def test_time_spent_story(self):
        stats = {"days_watched": 5}
        films_enriched = pd.DataFrame()
        films_df = pd.DataFrame()
        diary_df = pd.DataFrame({"parsed_date": pd.to_datetime([])})
        result = compute_story_analytics(stats, films_enriched, films_df, diary_df)
        assert "time_spent_story" in result
        assert "5" in result["time_spent_story"]

    def test_most_active_day(self):
        stats: dict = {}
        films_enriched = pd.DataFrame()
        films_df = pd.DataFrame()
        diary_df = pd.DataFrame({
            "parsed_date": pd.to_datetime([
                "2024-01-15", "2024-01-15", "2024-01-15",
                "2024-02-01",
            ]),
        })
        result = compute_story_analytics(stats, films_enriched, films_df, diary_df)
        assert "most_active_day" in result
        assert result["most_active_day"]["films"] == 3
        assert result["most_active_day"]["date"] == "2024-01-15"

    def test_cinematic_passport(self):
        stats = {
            "top_countries": [{"name": "USA", "count": 50}],
            "total_countries": 15,
            "total_directors": 60,
        }
        films_enriched = pd.DataFrame()
        films_df = pd.DataFrame()
        diary_df = pd.DataFrame()
        result = compute_story_analytics(stats, films_enriched, films_df, diary_df)
        assert "cinematic_passport" in result
        assert result["cinematic_passport"]["countries"] == 15
        assert result["cinematic_passport"]["directors"] == 60
        assert "cultural anthropologist" in result["cinematic_passport"]["country_story"]

    def test_cinema_archetype(self):
        stats = {
            "average_runtime": 115,
            "fun_statistics": {
                "film_age_analysis": {"average_age": 5},
            },
        }
        films_enriched = pd.DataFrame({
            "popularity": [40.0, 50.0, 60.0],
        })
        films_df = pd.DataFrame()
        diary_df = pd.DataFrame()
        result = compute_story_analytics(stats, films_enriched, films_df, diary_df)
        assert "cinema_archetype" in result
        # popularity avg=50 > 30, film_age=5 < 15 → Pop Culture Professor
        assert result["cinema_archetype"]["type"] == "Pop Culture Professor"

    def test_viewing_season(self):
        stats = {
            "monthly_viewing_habits": [
                {"month": "2024-06", "count": 10},
                {"month": "2024-07", "count": 15},
                {"month": "2024-12", "count": 5},
            ],
        }
        films_enriched = pd.DataFrame()
        films_df = pd.DataFrame()
        diary_df = pd.DataFrame()
        result = compute_story_analytics(stats, films_enriched, films_df, diary_df)
        assert "viewing_season" in result
        # 25 total: 10+15 in summer, 5 in winter → Summer
        assert result["viewing_season"]["season"] == "Summer"
        assert "percentage" in result["viewing_season"]

    def test_empty_inputs(self):
        stats: dict = {}
        films_enriched = pd.DataFrame()
        films_df = pd.DataFrame()
        diary_df = pd.DataFrame()
        result = compute_story_analytics(stats, films_enriched, films_df, diary_df)
        # Should not crash, returns empty dict
        assert isinstance(result, dict)