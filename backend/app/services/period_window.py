"""ZIP last-12-months stats window from diary dates (no scrape)."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta
from typing import Any, Dict, Iterable, Optional, Set, Tuple

import pandas as pd

from app.analysis_utils import compute_cinema_scale, compute_cinema_scale_inputs
from app.services.film_datasets import build_film_datasets
from app.services.geography import (
    compute_country_analytics,
    compute_country_language_stats,
    compute_keyword_analytics,
)
from app.services.people import (
    compute_all_cast_counts,
    compute_director_counts,
    compute_director_deep_analysis,
    compute_genre_stats,
    compute_decade_stats,
    compute_movie_crush,
    compute_my_star,
    compute_popularity_info,
)
from app.services.persona import compute_cinematic_persona, compute_insights
from app.services.ratings import compute_rating_personality, compute_rating_stats
from app.services.review_analysis import attach_review_posters, compute_review_metrics
from app.services.viewing_habits import compute_date_analytics, compute_rewatch_champions

FilmKey = Tuple[str, Optional[int]]
LAST_12_DAYS = 365


def _year_int(value: Any) -> Optional[int]:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def film_key(title: Any, year: Any) -> FilmKey:
    return (str(title or "").strip().lower(), _year_int(year))


def last_12_month_keys(
    diary_df: pd.DataFrame,
    *,
    now: Optional[datetime] = None,
    days: int = LAST_12_DAYS,
) -> Set[FilmKey]:
    """Title/year keys watched in the last `days` according to diary dates."""
    if diary_df.empty or "Name" not in diary_df.columns:
        return set()

    dated = diary_df
    if "parsed_date" not in dated.columns:
        date_column = next(
            (
                col
                for col in ["Watched Date", "Date", "Watch Date", "Watched", "Date Watched", "WatchedDate"]
                if col in dated.columns
            ),
            None,
        )
        if not date_column:
            return set()
        dated = dated.copy()
        dated["parsed_date"] = pd.to_datetime(dated[date_column], errors="coerce")

    valid = dated.dropna(subset=["parsed_date"])
    if valid.empty:
        return set()

    cutoff = pd.Timestamp(now or datetime.now()) - pd.Timedelta(days=days)
    parsed = valid["parsed_date"]
    if getattr(parsed.dt, "tz", None) is not None:
        cutoff = cutoff.tz_localize(parsed.dt.tz) if cutoff.tzinfo is None else cutoff
    recent = valid[parsed >= cutoff]
    year_col = "Year" if "Year" in recent.columns else None
    return {
        film_key(row.get("Name"), row.get(year_col) if year_col else None)
        for _, row in recent.iterrows()
    }


def filter_frame_to_keys(
    df: pd.DataFrame,
    keys: Set[FilmKey],
    title_cols: Iterable[str],
    year_col: str,
) -> pd.DataFrame:
    if df.empty or not keys:
        return df.iloc[0:0].copy()
    present = [col for col in title_cols if col in df.columns]
    if not present:
        return df.iloc[0:0].copy()

    def matches(row: pd.Series) -> bool:
        year = row[year_col] if year_col in row.index else None
        return any(film_key(row.get(col), year) in keys for col in present)

    return df[df.apply(matches, axis=1)].copy()


def _profile_by_name(people: Any) -> Dict[str, Optional[str]]:
    if not isinstance(people, list):
        return {}
    return {
        str(person.get("name")): person.get("profile_path")
        for person in people
        if isinstance(person, dict) and person.get("name")
    }


def _people_rows(
    counts: Counter,
    year_enriched: pd.DataFrame,
    films_df: pd.DataFrame,
    profiles: Dict[str, Optional[str]],
    role: str,
    limit: int = 20,
) -> list[dict[str, Any]]:
    rating_by_film: Dict[Tuple[str, str], Any] = {}
    if not films_df.empty and "rating" in films_df.columns:
        for _, row in films_df.dropna(subset=["rating"]).iterrows():
            year_str = str(_year_int(row.get("year")) or "")
            rating_by_film[(str(row.get("title") or ""), year_str)] = float(row["rating"])

    films_by_name: Dict[str, list[dict[str, Any]]] = {}
    for _, row in year_enriched.iterrows():
        year_str = str(_year_int(row.get("year")) or "")
        info = {
            "title": str(row.get("title") or ""),
            "year": year_str,
            "poster_path": row.get("poster_path") if isinstance(row.get("poster_path"), str) else "",
            "user_rating": rating_by_film.get((str(row.get("title") or ""), year_str)),
        }
        if role == "director":
            name = row.get("director")
            if pd.notna(name):
                films_by_name.setdefault(str(name), []).append(info)
        else:
            cast_list = row.get("cast")
            if isinstance(cast_list, list):
                for actor in cast_list:
                    films_by_name.setdefault(str(actor), []).append(info)

    rows = []
    for name, count in counts.most_common(limit):
        rows.append({
            "name": name,
            "count": int(count),
            "profile_path": profiles.get(name),
            "films": films_by_name.get(name, []),
        })
    return rows


def build_last_12_months_stats(
    *,
    year_enriched: pd.DataFrame,
    year_films_df: pd.DataFrame,
    year_diary: pd.DataFrame,
    year_reviews: pd.DataFrame,
    year_watched: pd.DataFrame,
    lifetime: Dict[str, Any],
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Recompute results stats for diary-dated films in the last 12 months."""
    stats: Dict[str, Any] = {}
    stats["total_films"] = int(len(year_films_df))
    stats.update(compute_rewatch_champions(year_diary, year_enriched))
    stats.update(compute_rating_stats(year_films_df))
    stats["rating_personality"] = compute_rating_personality(year_films_df)
    stats.update(compute_date_analytics(year_diary, year_watched))

    if "runtime" in year_enriched.columns and year_enriched["runtime"].notna().any():
        runtimes = year_enriched[year_enriched["runtime"] > 0]["runtime"].dropna()
        if not runtimes.empty:
            total_runtime = int(runtimes.sum())
            stats["total_runtime"] = total_runtime
            stats["hours_watched"] = round(total_runtime / 60, 1)
            stats["days_watched"] = round(total_runtime / (60 * 24), 1)
            stats["average_runtime"] = round(runtimes.mean(), 1)
            longest = year_enriched.loc[runtimes.idxmax()]
            stats["longest_film"] = {"title": longest["title"], "runtime": int(longest["runtime"])}

    stats.update(compute_keyword_analytics(year_enriched))
    stats.update(compute_country_analytics(year_enriched))
    stats.update(compute_genre_stats(year_enriched))
    stats.update(compute_decade_stats(year_enriched))
    stats.update(compute_country_language_stats(year_enriched))

    top_genre = stats.get("top_genres", [{}])[0].get("name", "Film") if stats.get("top_genres") else "Film"
    top_decade = stats.get("favorite_decade", {}).get("name", "2020s") if stats.get("favorite_decade") else "2020s"
    top_country = stats.get("top_countries", [{}])[0].get("name", "USA") if stats.get("top_countries") else "USA"
    stats["cinematic_persona"] = compute_cinematic_persona(top_genre, top_decade, top_country)

    director_counts = compute_director_counts(year_enriched)
    director_profiles = _profile_by_name(lifetime.get("top_directors"))
    director_profiles.update(_profile_by_name(lifetime.get("directors_with_ratings")))
    stats["top_directors"] = _people_rows(
        director_counts, year_enriched, year_films_df, director_profiles, "director",
    )
    stats["total_directors"] = len(director_counts)
    stats["most_watched_director"] = stats["top_directors"][0] if stats["top_directors"] else None
    stats["director_deep_analysis"] = compute_director_deep_analysis(
        year_enriched, year_films_df, stats.get("most_watched_director"),
    )

    cast_counts = compute_all_cast_counts(year_enriched)
    actor_profiles = _profile_by_name(lifetime.get("top_actors"))
    actor_profiles.update(_profile_by_name(lifetime.get("actors_with_ratings")))
    stats["top_actors"] = _people_rows(
        cast_counts, year_enriched, year_films_df, actor_profiles, "actor",
    )
    stats["my_star"] = compute_my_star(cast_counts)
    stats["movie_crush"] = compute_movie_crush(stats["top_actors"][:4])
    pop_info = compute_popularity_info(year_enriched)
    if pop_info:
        stats["popularity_info"] = pop_info

    genre_counts = Counter(
        g for genres in year_enriched["genres"].dropna() for g in genres
    ) if "genres" in year_enriched.columns else Counter()
    stats["sinefil_meter"] = compute_cinema_scale(
        **compute_cinema_scale_inputs(year_enriched, genre_counts, director_counts)
    )

    ratings_src = (
        year_films_df[["title", "year", "rating"]]
        if "rating" in year_films_df.columns
        else year_films_df[["title", "year"]]
    ).rename(columns={"title": "letterboxd_title"})
    analysis_df = pd.merge(year_enriched, ratings_src, on=["letterboxd_title", "year"], how="left")
    stats.update(build_film_datasets(analysis_df))

    stats["review_analysis"] = compute_review_metrics(year_reviews)
    attach_review_posters(stats["review_analysis"], stats.get("all_films") or [])
    stats["insights"] = compute_insights(stats)

    end = now or datetime.now()
    start = end - timedelta(days=LAST_12_DAYS)
    stats["analysis_period"] = {
        "key": "year",
        "start_date": start.date().isoformat(),
        "end_date": end.date().isoformat(),
    }
    stats["analysis_date"] = end.isoformat()
    return stats


def attach_last_12_months(
    stats: Dict[str, Any],
    *,
    films_enriched: pd.DataFrame,
    films_df: pd.DataFrame,
    diary_df: pd.DataFrame,
    reviews_df: pd.DataFrame,
    watched_df: pd.DataFrame,
    now: Optional[datetime] = None,
) -> None:
    """Attach a last-12-months stats blob when the ZIP diary has dated watches."""
    keys = last_12_month_keys(diary_df, now=now)
    if not keys:
        return
    year_enriched = filter_frame_to_keys(
        films_enriched, keys, ("letterboxd_title", "title"), "year",
    )
    if not year_enriched.empty and "letterboxd_title" not in year_enriched.columns:
        year_enriched["letterboxd_title"] = year_enriched["title"]
    year_films_df = filter_frame_to_keys(films_df, keys, ("title",), "year")
    if year_enriched.empty or year_films_df.empty:
        return
    year_diary = filter_frame_to_keys(diary_df, keys, ("Name",), "Year")
    year_reviews = filter_frame_to_keys(reviews_df, keys, ("Name",), "Year") if not reviews_df.empty else reviews_df
    year_watched = filter_frame_to_keys(watched_df, keys, ("Name",), "Year") if not watched_df.empty else watched_df
    stats["last_12_months"] = build_last_12_months_stats(
        year_enriched=year_enriched,
        year_films_df=year_films_df,
        year_diary=year_diary,
        year_reviews=year_reviews,
        year_watched=year_watched,
        lifetime=stats,
        now=now,
    )
