"""
Letterboxd Wrapped — comprehensive analysis pipeline.

Orchestrates CSV loading, TMDB enrichment, and delegates sub-computations
to dedicated modules (ratings, geography, people, persona) to keep each
focus area maintainable and testable.
"""

from __future__ import annotations

import asyncio
import logging as _logging
import os
import time
from collections import Counter
from datetime import datetime
from typing import Any, Dict, Optional

import aiohttp
import pandas as pd

from app import task_manager
from app.analysis_utils import compute_cinema_scale, compute_cinema_scale_inputs
from app.services.film_datasets import compute_data_quality, build_film_datasets
from app.services.milestones import compute_milestones
from app.services.viewing_habits import compute_date_analytics, compute_rewatch_champions
from app.services.geography import (
    compute_country_analytics,
    compute_country_iso_data,
    compute_country_language_stats,
    compute_keyword_analytics,
    compute_world_tour,
)
from app.services.people import (
    compute_actor_counts,
    compute_all_cast_counts,
    compute_actor_profiles,
    compute_actors_with_ratings,
    compute_decade_stats,
    compute_director_counts,
    compute_director_deep_analysis,
    compute_director_profiles,
    compute_directors_with_ratings,
    compute_favorite_genre_combo,
    compute_genre_stats,
    compute_movie_crush,
    compute_my_star,
    compute_popularity_info,
    compute_signature_duo,
    resolve_profile_paths,
)
from app.services.persona import (
    compute_cinematic_persona,
    compute_film_age_analysis,
    compute_furthest_destination,
    compute_insights,
    compute_runtime_persona,
    compute_secret_obsession,
    compute_story_analytics,
)
from app.services.ratings import (
    compute_budget_revenue_analytics,
    compute_fun_rating_stats,
    compute_highest_budget_film,
    compute_highest_grossing_film,
    compute_rating_personality,
    compute_rating_stats,
)
from app.services.review_analysis import compute_review_metrics


async def process_comprehensive_letterboxd_data(
    session: aiohttp.ClientSession,
    csv_files: Dict[str, str],
    task_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Process Letterboxd data with concurrent TMDB enrichment.

    Loads CSV exports, enriches with TMDB metadata, then delegates to
    specialised modules for ratings, geography, people, and persona analysis.
    """
    _bench_logger = _logging.getLogger("letterboxd_wrapped")
    logger = _bench_logger
    t0 = time.perf_counter()

    def _progress(stage: str, message: str, progress: int = 0, total: int = 0) -> None:
        if task_id:
            task_manager.update_task_progress(task_id, stage, message, progress, total)
        else:
            logger.info("[%s] %s (%d/%d)", stage, message, progress, total)

    # -----------------------------------------------------------------------
    # 1. LOAD CSV DATA
    # -----------------------------------------------------------------------
    _progress("loading", "Loading CSV data files...", 0, 5)

    watched_df = pd.read_csv(csv_files["watched.csv"]) if "watched.csv" in csv_files else pd.DataFrame()
    ratings_df = pd.read_csv(csv_files["ratings.csv"]) if "ratings.csv" in csv_files else pd.DataFrame()
    diary_df = pd.read_csv(csv_files["diary.csv"]) if "diary.csv" in csv_files else pd.DataFrame()
    reviews_df = pd.read_csv(csv_files["reviews.csv"]) if "reviews.csv" in csv_files else pd.DataFrame()

    if watched_df.empty:
        raise ValueError("\u274c watched.csv is required for analysis.")

    films_df = watched_df.rename(columns={"Name": "title", "Year": "year"})

    if not ratings_df.empty:
        ratings_df_renamed = ratings_df[["Name", "Year", "Rating"]].rename(
            columns={"Name": "title", "Year": "year", "Rating": "rating"}
        )
        films_df = pd.merge(films_df, ratings_df_renamed, on=["title", "year"], how="left")

    unique_films = films_df[["title", "year"]].drop_duplicates().reset_index(drop=True)

    t1 = time.perf_counter()
    total_rows = len(watched_df) + len(ratings_df) + len(diary_df) + len(reviews_df)
    _bench_logger.info("[bench] parsed %d files, %d rows, %d ms", len(csv_files), total_rows, int((t1 - t0) * 1000))

    _progress("processing", f"Found {len(unique_films)} unique films", 1, 3)

    # -----------------------------------------------------------------------
    # 2. TMDB MATCHING + METADATA ENRICHMENT
    # -----------------------------------------------------------------------
    _progress("tmdb_matching", "Matching films to TMDb (fast)...", 0, len(unique_films))

    from app.services.tmdb_client import (
        fetch_comprehensive_film_details,
        resolve_tmdb_id,
    )
    from app.services.tmdb_telemetry import current as _tmdb_current

    _collector = _tmdb_current()

    resolve_tasks = [resolve_tmdb_id(session, row["title"], row["year"]) for _, row in unique_films.iterrows()]
    tmdb_match_started = time.perf_counter()
    tmdb_ids = await asyncio.gather(*resolve_tasks)
    if _collector is not None:
        _collector.set_tmdb_match_seconds(time.perf_counter() - tmdb_match_started)
    unique_films["tmdb_id"] = tmdb_ids
    match_rate = unique_films["tmdb_id"].notna().mean() * 100
    matched_count = int(unique_films["tmdb_id"].notna().sum())

    t2 = time.perf_counter()
    _bench_logger.info("[bench] tmdb match: %d/%d films, %d ms", matched_count, len(unique_films), int((t2 - t1) * 1000))

    _progress("tmdb_matching", f"Matched {match_rate:.1f}% of films", len(unique_films), len(unique_films))

    unique_tmdb_ids = unique_films["tmdb_id"].dropna().unique()
    _progress("tmdb_metadata", "Gathering film metadata (fast)...", 0, len(unique_tmdb_ids))
    metadata_started = time.perf_counter()
    fetch_tasks = [fetch_comprehensive_film_details(session, tmdb_id) for tmdb_id in unique_tmdb_ids]
    metadata_results = await asyncio.gather(*fetch_tasks)
    if _collector is not None:
        _collector.set_tmdb_metadata_seconds(time.perf_counter() - metadata_started)
    metadata_df = pd.DataFrame([m for m in metadata_results if m])
    _progress("tmdb_metadata", "Metadata collection complete", len(unique_tmdb_ids), len(unique_tmdb_ids))

    films_enriched = pd.merge(unique_films, metadata_df, on="tmdb_id", how="left", suffixes=("_csv", "_tmdb"))
    if "title_tmdb" in films_enriched.columns:
        films_enriched["title"] = films_enriched["title_tmdb"].fillna(films_enriched["title_csv"])
    else:
        films_enriched["title"] = films_enriched["title_csv"]
    films_enriched.drop(
        columns=[col for col in ["title_csv", "title_tmdb"] if col in films_enriched.columns],
        inplace=True,
    )

    t3 = time.perf_counter()
    enriched_count = len(films_enriched[films_enriched["tmdb_id"].notna()])
    _bench_logger.info("[bench] enriched %d films, %d ms", enriched_count, int((t3 - t2) * 1000))

    _progress("analyzing", "Generating comprehensive statistics...", 0, 10)

    stats: Dict[str, Any] = {}

    # -----------------------------------------------------------------------
    # 3. ENRICHED FILM DATA SUMMARY
    # -----------------------------------------------------------------------
    stats.update(compute_data_quality(films_enriched))

    # -----------------------------------------------------------------------
    # 4. BASIC STATS
    # -----------------------------------------------------------------------
    stats["total_films"] = len(films_df)

    rewatched_count = 0
    if "Rewatch" in films_df.columns:
        rewatch_mask = films_df["Rewatch"].fillna("No").astype(str).str.strip().str.lower().eq("yes")
        rewatched_count = int(rewatch_mask.sum())
    stats["rewatched_count"] = rewatched_count

    stats.update(compute_rewatch_champions(diary_df, films_enriched))

    stats["films_with_metadata"] = len(metadata_df)
    stats["metadata_coverage"] = round((len(metadata_df) / len(unique_films)) * 100, 1) if len(unique_films) > 0 else 0
    _progress("analyzing", "Basic stats complete", 1, 10)

    # -----------------------------------------------------------------------
    # 5. RATINGS
    # -----------------------------------------------------------------------
    stats.update(compute_rating_stats(films_df))
    stats["rating_personality"] = compute_rating_personality(films_df)
    stats.update(compute_budget_revenue_analytics(films_enriched))
    _progress("analyzing", "Rating analysis complete", 2, 10)

    # -----------------------------------------------------------------------
    # 6. RUNTIME ANALYSIS
    # -----------------------------------------------------------------------
    if "runtime" in films_enriched.columns and films_enriched["runtime"].notna().any():
        runtimes = films_enriched[films_enriched["runtime"] > 0]["runtime"].dropna()
        if not runtimes.empty:
            total_runtime = int(runtimes.sum())
            stats["total_runtime"] = total_runtime
            stats["hours_watched"] = round(total_runtime / 60, 1)
            stats["days_watched"] = round(total_runtime / (60 * 24), 1)
            stats["average_runtime"] = round(runtimes.mean(), 1)
            stats["median_runtime"] = round(runtimes.median(), 1)

            longest_film_data = films_enriched.loc[runtimes.idxmax()]
            shortest_film_data = films_enriched.loc[runtimes.idxmin()]

            stats["longest_film"] = {
                "title": longest_film_data["title"],
                "runtime": int(longest_film_data["runtime"]),
            }
            stats["shortest_film"] = {
                "title": shortest_film_data["title"],
                "runtime": int(shortest_film_data["runtime"]),
            }
    _progress("analyzing", "Runtime analysis complete", 3, 10)

    # -----------------------------------------------------------------------
    # 7. DATE ANALYSIS
    # -----------------------------------------------------------------------
    # compute_date_analytics mutates diary_df/watched_df in place (adds
    # "parsed_date") — Section 13 below depends on that column existing.
    stats.update(compute_date_analytics(diary_df, watched_df))
    stats.update(compute_milestones(diary_df, films_enriched))

    # -----------------------------------------------------------------------
    # 8. KEYWORD ANALYTICS + COUNTRY ANALYTICS
    # -----------------------------------------------------------------------
    stats.update(compute_keyword_analytics(films_enriched))
    stats.update(compute_country_analytics(films_enriched))

    # -----------------------------------------------------------------------
    # 9. GENRE, DECADE, COUNTRY, LANGUAGE STATS (used by persona below)
    # -----------------------------------------------------------------------
    stats.update(compute_genre_stats(films_enriched))
    stats.update(compute_decade_stats(films_enriched))
    stats.update(compute_country_language_stats(films_enriched))

    # -----------------------------------------------------------------------
    # 10. CINEMATIC PERSONA + ARCHETYPE FOUNDATIONS
    # -----------------------------------------------------------------------
    top_genre = stats.get("top_genres", [{}])[0].get("name", "Film") if stats.get("top_genres") else "Film"
    top_decade = stats.get("favorite_decade", {}).get("name", "2020s") if stats.get("favorite_decade") else "2020s"
    top_country = stats.get("top_countries", [{}])[0].get("name", "USA") if stats.get("top_countries") else "USA"

    stats["cinematic_persona"] = compute_cinematic_persona(top_genre, top_decade, top_country)

    # -----------------------------------------------------------------------
    # 11. DIRECTOR + ACTOR PROFILES (async)
    # -----------------------------------------------------------------------
    director_counts = compute_director_counts(films_enriched)

    director_result = await compute_director_profiles(session, films_enriched, films_df, director_counts, logger)
    stats["top_directors"] = director_result["top_directors"]
    stats["total_directors"] = director_result["total_directors"]
    stats["most_watched_director"] = director_result["most_watched_director"]
    director_profile_map = director_result.get("_director_profile_map", {})
    director_films_map = director_result.get("_director_films_map", {})
    rating_by_film = director_result.get("_rating_by_film", {})
    _progress("analyzing", "Director analysis complete", 4, 10)

    # ---- Genre (after people to keep progress order) ----
    genre_counts = Counter(
        g for genres in films_enriched["genres"].dropna() for g in genres
    ) if "genres" in films_enriched.columns else Counter()
    _progress("analyzing", "Genre analysis complete", 5, 10)

    # Decade — already computed via compute_decade_stats
    _progress("analyzing", "Decade analysis complete", 6, 10)

    # Country — already computed via compute_country_language_stats
    _progress("analyzing", "Country analysis complete", 7, 10)

    # Language — already computed via compute_country_language_stats
    _progress("analyzing", "Language analysis complete", 8, 10)

    # ---- Director deep analysis (now most_watched_director is set) ----
    stats["director_deep_analysis"] = compute_director_deep_analysis(
        films_enriched, films_df, stats.get("most_watched_director")
    )

    # ---- Actor (my_star) ----
    actor_counts_first = compute_actor_counts(films_enriched)
    stats["my_star"] = compute_my_star(actor_counts_first)

    # ---- Popularity info ----
    pop_info = compute_popularity_info(films_enriched)
    if pop_info:
        stats["popularity_info"] = pop_info

    # ---- Cast counts for full actor list ----
    cast_counts = compute_all_cast_counts(films_enriched)

    # ---- Actor profiles ----
    actor_result = await compute_actor_profiles(session, films_enriched, films_df, cast_counts, logger)
    stats["top_actors"] = actor_result["top_actors"]
    actor_films_map = actor_result.get("_actor_films_map", {})
    actor_profile_map = actor_result.get("_actor_profile_map", {})
    _progress("analyzing", "Cast analysis complete", 9, 10)

    # ---- Signature duo ----
    signature_duo = compute_signature_duo(films_enriched)
    if signature_duo:
        from collections import Counter as _C  # ensure available in scope

    # -----------------------------------------------------------------------
    # 12. FUN STATISTICS
    # -----------------------------------------------------------------------
    fun_stats: Dict[str, Any] = {}

    if not films_enriched.empty:
        # Highest budget film
        highest_budget = compute_highest_budget_film(films_enriched)
        if highest_budget:
            fun_stats["highest_budget_film"] = highest_budget

        # Highest grossing film
        highest_grossing = compute_highest_grossing_film(films_enriched)
        if highest_grossing:
            fun_stats["highest_grossing_film"] = highest_grossing

        # Guilty pleasure + rating outlier
        fun_stats.update(compute_fun_rating_stats(films_enriched, films_df))

        # Favorite genre combo
        genre_combo = compute_favorite_genre_combo(films_enriched)
        if genre_combo:
            fun_stats["favorite_genre_combo"] = genre_combo

        # Film age analysis
        film_age = compute_film_age_analysis(films_enriched)
        if film_age:
            fun_stats["film_age_analysis"] = film_age

    # World tour
    if stats.get("top_countries"):
        fun_stats["world_tour"] = compute_world_tour(stats["top_countries"])

    stats["fun_statistics"] = fun_stats

    # -----------------------------------------------------------------------
    # 13. STORY-DRIVEN ANALYTICS
    # -----------------------------------------------------------------------
    story_analytics = compute_story_analytics(
        stats, films_enriched, films_df, diary_df if "parsed_date" in diary_df.columns else pd.DataFrame()
    )

    # Signature duo story (manual merge because it references the duo data)
    if signature_duo:
        story_analytics["signature_duo"] = signature_duo

    stats["story_analytics"] = story_analytics

    # -----------------------------------------------------------------------
    # 14. CINEMA SCALE
    # -----------------------------------------------------------------------
    stats["sinefil_meter"] = compute_cinema_scale(
        **compute_cinema_scale_inputs(films_enriched, genre_counts, director_counts)
    )

    if os.getenv("DEBUG_CINEMA_SCALE"):
        logger.info(
            "[Cinema Scale] score=%s, breakdown=%s",
            stats["sinefil_meter"]["score"], stats["sinefil_meter"]["breakdown"],
        )

    # -----------------------------------------------------------------------
    # 15. TEST LAB DATASETS
    # -----------------------------------------------------------------------
    analysis_df = pd.merge(
        films_enriched,
        films_df[["title", "year", "rating"]] if "rating" in films_df.columns else films_df[["title", "year"]],
        on=["title", "year"],
        how="left",
    )

    stats.update(build_film_datasets(analysis_df))

    # Directors with ratings
    stats["directors_with_ratings"] = compute_directors_with_ratings(director_counts, analysis_df)
    for row in stats["directors_with_ratings"]:
        row["films"] = director_films_map.get(row["name"], [])

    # Backfill profile_paths for rated directors
    await resolve_profile_paths(
        session, stats["directors_with_ratings"][:5], "director",
        director_films_map, director_profile_map, logger,
    )

    # Actors with ratings
    stats["actors_with_ratings"] = compute_actors_with_ratings(cast_counts, analysis_df, actor_profile_map)
    for row in stats["actors_with_ratings"]:
        row["films"] = actor_films_map.get(row["name"], [])

    # Backfill profile_paths for rated actors
    await resolve_profile_paths(
        session, stats["actors_with_ratings"][:5], "actor",
        actor_films_map, actor_profile_map, logger,
    )

    # Country ISO data
    stats.update(compute_country_iso_data(analysis_df))

    # -----------------------------------------------------------------------
    # 16. MOVIE CRUSH
    # -----------------------------------------------------------------------
    stats["movie_crush"] = compute_movie_crush(
        actor_result.get("top_actors", [])[:4] if actor_result.get("top_actors") else []
    )

    # -----------------------------------------------------------------------
    # 17. INSIGHTS
    # -----------------------------------------------------------------------
    stats["insights"] = compute_insights(stats)

    # -----------------------------------------------------------------------
    # 18. FINAL WRAP-UP
    # -----------------------------------------------------------------------
    stats["analysis_date"] = datetime.now().isoformat()
    stats["secret_obsession"] = compute_secret_obsession(stats)
    stats["runtime_persona"] = compute_runtime_persona(stats)
    stats["furthest_destination"] = compute_furthest_destination(stats)

    # -----------------------------------------------------------------------
    # 19. REVIEW TEXT ANALYSIS
    # -----------------------------------------------------------------------
    _progress("analyzing", "Analyzing review text...", 10, 11)
    stats["review_analysis"] = compute_review_metrics(reviews_df)

    _progress("analyzing", "Analysis complete!", 11, 11)

    t4 = time.perf_counter()
    _bench_logger.info("[bench] stats computed, %d ms", int((t4 - t3) * 1000))
    _bench_logger.info(
        "[bench] total pipeline: %d ms for %d films",
        int((t4 - t0) * 1000), len(films_enriched),
    )

    return stats
