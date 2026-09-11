"""
Film dataset builders for Letterboxd Wrapped.

Extracted from the analysis.py orchestrator (formerly inline Sections 3 and
15): TMDB-enrichment coverage reporting, and the per-film "rated_films" /
"all_films" datasets used by the results UI's film modals. Both are pure
functions over already-enriched DataFrames.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

import pandas as pd


def compute_data_quality(films_enriched: pd.DataFrame) -> Dict[str, Any]:
    """TMDB-enrichment coverage: which fields are populated, and how much,
    across the whole enriched film set."""
    enriched_films_summary = {
        "total_enriched": len(films_enriched[films_enriched["tmdb_id"].notna()]),
        "budget_data_available": len(films_enriched[films_enriched["budget"] > 0]),
        "revenue_data_available": len(films_enriched[films_enriched["revenue"] > 0]),
        "popularity_data_available": len(films_enriched[films_enriched["popularity"] > 0]),
        "keywords_data_available": len(
            films_enriched[films_enriched["keywords_full"].apply(
                lambda x: isinstance(x, list) and len(x) > 0
            )]
        ),
        "countries_data_available": len(
            films_enriched[films_enriched["production_countries"].apply(
                lambda x: isinstance(x, list) and len(x) > 0
            )]
        ),
    }

    total_films = len(films_enriched)
    data_quality_report = {
        "total_films_analyzed": total_films,
        "tmdb_match_rate": round(
            (len(films_enriched[films_enriched["tmdb_id"].notna()]) / total_films) * 100, 1
        ) if total_films > 0 else 0,
        "budget_coverage": round(
            (len(films_enriched[films_enriched["budget"] > 0]) / total_films) * 100, 1
        ) if total_films > 0 else 0,
        "revenue_coverage": round(
            (len(films_enriched[films_enriched["revenue"] > 0]) / total_films) * 100, 1
        ) if total_films > 0 else 0,
        "popularity_coverage": round(
            (len(films_enriched[films_enriched["popularity"] > 0]) / total_films) * 100, 1
        ) if total_films > 0 else 0,
        "keywords_coverage": round(
            (len(films_enriched[films_enriched["keywords_full"].apply(
                lambda x: isinstance(x, list) and len(x) > 0
            )]) / total_films) * 100, 1
        ) if total_films > 0 else 0,
        "countries_coverage": round(
            (len(films_enriched[films_enriched["production_countries"].apply(
                lambda x: isinstance(x, list) and len(x) > 0
            )]) / total_films) * 100, 1
        ) if total_films > 0 else 0,
        "storytelling_readiness": (
            "excellent" if total_films > 0 and (len(films_enriched[films_enriched["tmdb_id"].notna()]) / total_films) > 0.8
            else "good" if total_films > 0 and (len(films_enriched[films_enriched["tmdb_id"].notna()]) / total_films) > 0.6
            else "limited"
        ),
    }

    return {
        "enriched_films_summary": enriched_films_summary,
        "data_quality_report": data_quality_report,
    }


def _clean_year(value: Any) -> Optional[int]:
    try:
        if pd.isna(value):
            return None
        return int(value)
    except Exception:
        return None


def _clean_rating(value: Any) -> Optional[float]:
    try:
        if pd.isna(value):
            return None
        return float(value)
    except Exception:
        return None


def _community_rating(value: Any) -> Optional[float]:
    # TMDB vote_average is a 0-10 community score; normalize to the user's 0-5
    # scale so per-film deltas are comparable. 0 means "no votes" -> no signal.
    try:
        if pd.isna(value):
            return None
        score = float(value)
        return round(score / 2.0, 1) if score > 0 else None
    except Exception:
        return None


def build_film_datasets(analysis_df: pd.DataFrame) -> Dict[str, Any]:
    """Per-film datasets for the results UI: rated_films (sorted highest-first,
    only rows the user rated) and all_films (every watched film, enriched)."""
    if "rating" in analysis_df.columns:
        rated_rows = analysis_df[analysis_df["rating"].notna()]
        rated_films = [
            {
                "title": str(row.get("title") or ""),
                "year": _clean_year(row.get("year")),
                "rating": float(row.get("rating")),
                "your_rating": float(row.get("rating")),
                "community_rating": _community_rating(row.get("vote_average")),
                "average_rating": float(row.get("vote_average", 0)) / 2.0 if pd.notna(row.get("vote_average")) else None,
                "poster_path": row.get("poster_path") if isinstance(row.get("poster_path"), str) else "",
                "popularity": float(row.get("popularity", 0)) if pd.notna(row.get("popularity")) else 0.0,
                "letterboxd_uri": (
                    str(row.get("letterboxd_uri"))
                    if pd.notna(row.get("letterboxd_uri")) and str(row.get("letterboxd_uri")).strip()
                    else None
                ),
            }
            for _, row in rated_rows.sort_values("rating", ascending=False).iterrows()
        ]
    else:
        rated_films = []

    all_films = [
        {
            "title": str(row.get("title") or ""),
            "letterboxd_title": str(row.get("letterboxd_title") or row.get("title") or ""),
            "original_title": (
                str(row.get("original_title"))
                if pd.notna(row.get("original_title")) and str(row.get("original_title")).strip()
                else None
            ),
            "year": _clean_year(row.get("year")),
            "director": row.get("director") if pd.notna(row.get("director")) else None,
            "genres": row.get("genres") if isinstance(row.get("genres"), list) else [],
            "countries": row.get("countries") if isinstance(row.get("countries"), list) else [],
            "language": row.get("language") if pd.notna(row.get("language")) else None,
            "runtime": _clean_year(row.get("runtime")),
            "poster_path": row.get("poster_path") if isinstance(row.get("poster_path"), str) else "",
            "decade": row.get("decade") if pd.notna(row.get("decade")) else None,
            "rating": _clean_rating(row.get("rating")) if "rating" in analysis_df.columns else None,
            "cast": row.get("cast") if isinstance(row.get("cast"), list) else [],
            "average_rating": float(row.get("vote_average", 0)) / 2.0 if pd.notna(row.get("vote_average")) else None,
            "popularity": float(row.get("popularity", 0)) if pd.notna(row.get("popularity")) else 0.0,
            "letterboxd_uri": (
                str(row.get("letterboxd_uri"))
                if pd.notna(row.get("letterboxd_uri")) and str(row.get("letterboxd_uri")).strip()
                else None
            ),
        }
        for _, row in analysis_df.iterrows()
    ]

    return {"rated_films": rated_films, "all_films": all_films}
