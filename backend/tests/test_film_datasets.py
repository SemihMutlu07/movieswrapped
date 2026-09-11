"""Unit tests for the film_datasets module (extracted from analysis.py)."""

from __future__ import annotations

import pandas as pd
import pytest

from app.services.film_datasets import compute_data_quality, build_film_datasets


def _films_enriched(n_total=10, n_tmdb=8, n_budget=4, n_revenue=3, n_pop=6, n_keywords=2, n_countries=5):
    return pd.DataFrame({
        "tmdb_id": [i if i < n_tmdb else None for i in range(n_total)],
        "budget": [100 if i < n_budget else 0 for i in range(n_total)],
        "revenue": [100 if i < n_revenue else 0 for i in range(n_total)],
        "popularity": [1.0 if i < n_pop else 0 for i in range(n_total)],
        "keywords_full": [["a"] if i < n_keywords else [] for i in range(n_total)],
        "production_countries": [["US"] if i < n_countries else [] for i in range(n_total)],
    })


class TestComputeDataQuality:
    def test_zero_films_guard(self):
        result = compute_data_quality(_films_enriched(n_total=0, n_tmdb=0, n_budget=0, n_revenue=0, n_pop=0, n_keywords=0, n_countries=0))
        report = result["data_quality_report"]
        assert report["total_films_analyzed"] == 0
        assert report["tmdb_match_rate"] == 0
        assert report["storytelling_readiness"] == "limited"

    def test_coverage_percentages(self):
        result = compute_data_quality(_films_enriched(n_total=10, n_tmdb=8, n_budget=4))
        assert result["enriched_films_summary"]["total_enriched"] == 8
        assert result["enriched_films_summary"]["budget_data_available"] == 4
        assert result["data_quality_report"]["tmdb_match_rate"] == 80.0
        assert result["data_quality_report"]["budget_coverage"] == 40.0

    def test_storytelling_readiness_excellent_above_80_percent(self):
        result = compute_data_quality(_films_enriched(n_total=10, n_tmdb=9))
        assert result["data_quality_report"]["storytelling_readiness"] == "excellent"

    def test_storytelling_readiness_good_between_60_and_80_percent(self):
        result = compute_data_quality(_films_enriched(n_total=10, n_tmdb=7))
        assert result["data_quality_report"]["storytelling_readiness"] == "good"

    def test_storytelling_readiness_limited_at_or_below_60_percent(self):
        result = compute_data_quality(_films_enriched(n_total=10, n_tmdb=5))
        assert result["data_quality_report"]["storytelling_readiness"] == "limited"


class TestBuildFilmDatasets:
    def test_no_rating_column_yields_empty_rated_films(self):
        analysis_df = pd.DataFrame({"title": ["A"], "year": [2020]})
        result = build_film_datasets(analysis_df)
        assert result["rated_films"] == []
        assert len(result["all_films"]) == 1
        assert result["all_films"][0]["rating"] is None

    def test_rated_films_only_include_rated_rows_sorted_descending(self):
        analysis_df = pd.DataFrame({
            "title": ["A", "B", "C"],
            "year": [2020, 2021, 2022],
            "rating": [3.0, None, 5.0],
        })
        result = build_film_datasets(analysis_df)
        assert len(result["rated_films"]) == 2  # B excluded (no rating)
        assert [f["title"] for f in result["rated_films"]] == ["C", "A"]  # 5.0 before 3.0
        assert len(result["all_films"]) == 3  # all_films includes every row

    def test_community_rating_normalizes_tmdb_0_to_10_scale_and_treats_zero_as_no_signal(self):
        analysis_df = pd.DataFrame({
            "title": ["A", "B"],
            "year": [2020, 2021],
            "rating": [4.0, 4.0],
            "vote_average": [8.0, 0.0],
        })
        result = build_film_datasets(analysis_df)
        by_title = {f["title"]: f for f in result["rated_films"]}
        assert by_title["A"]["community_rating"] == 4.0  # 8.0 / 2
        assert by_title["B"]["community_rating"] is None  # 0 => no votes => no signal

    def test_all_films_defaults_for_missing_optional_fields(self):
        analysis_df = pd.DataFrame({"title": ["A"], "year": [2020]})
        result = build_film_datasets(analysis_df)
        film = result["all_films"][0]
        assert film["genres"] == []
        assert film["countries"] == []
        assert film["cast"] == []
        assert film["poster_path"] == ""
        assert film["letterboxd_title"] == "A"
        assert film["original_title"] is None

    def test_all_films_keeps_letterboxd_and_original_titles(self):
        analysis_df = pd.DataFrame({
            "title": ["Memorias del subdesarrollo"],
            "letterboxd_title": ["Memories of Underdevelopment"],
            "original_title": ["Memorias del subdesarrollo"],
            "year": [1968],
            "poster_path": ["/mem.jpg"],
            "letterboxd_uri": ["https://boxd.it/29Dq"],
        })
        film = build_film_datasets(analysis_df)["all_films"][0]
        assert film["title"] == "Memorias del subdesarrollo"
        assert film["letterboxd_title"] == "Memories of Underdevelopment"
        assert film["original_title"] == "Memorias del subdesarrollo"
        assert film["poster_path"] == "/mem.jpg"
        assert film["letterboxd_uri"] == "https://boxd.it/29Dq"
