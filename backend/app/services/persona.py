"""
Persona and story analytics for Letterboxd Wrapped.

Extracted from the analysis.py god function. Computes cinematic persona,
story-driven analytics, cinema archetype, insights, and final wrap-up stats.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

import pandas as pd


# ---------------------------------------------------------------------------
# Cinematic persona — genre/decade/country → personality label
# ---------------------------------------------------------------------------
_PERSONA_MAP: Dict[tuple, tuple] = {
    ("Action", "2020s", "USA"): ("Blockbuster Addict", "You live for explosions, CGI, and popcorn entertainment."),
    ("Drama", "1970s", "USA"): ("Classic Hollywood Connoisseur", "You appreciate the golden age when movies had substance."),
    ("Horror", "1980s", "USA"): ("Retro Horror Fiend", "You know true terror peaked in the 80s."),
    ("Comedy", "2000s", "USA"): ("Millennial Comedy Scholar", "You quote movies more than you quote real people."),
    ("Sci-Fi", "1980s", "USA"): ("Cyberpunk Prophet", "You saw the future coming before everyone else."),
    ("Crime", "1990s", "USA"): ("Tarantino Disciple", "You believe violence can be art when done right."),
    ("Romance", "1950s", "USA"): ("Old Hollywood Romantic", "You think love stories peaked before color TV."),
    ("Thriller", "2010s", "USA"): ("Modern Suspense Seeker", "You need your movies to keep you guessing."),
    ("Animation", "2000s", "Japan"): ("Anime Connoisseur", "You know Miyazaki is basically cinema Jesus."),
    ("Documentary", "2010s", "USA"): ("Reality Obsessive", "Fiction is for people who can't handle the truth."),
}


def compute_cinematic_persona(
    top_genre: str,
    favorite_decade: str,
    top_country: str,
) -> Dict[str, str]:
    """Map top genre/decade/country to a cinematic persona label and description.

    All three arguments should be human-readable names (or fallbacks like
    'Genre-Defying', 'Timeless', 'International').
    """
    genre = top_genre if top_genre not in ("Unknown", "") else "Genre-Defying"
    decade = favorite_decade if favorite_decade not in ("Unknown", "") else "Timeless"
    country = top_country if top_country not in ("Unknown", "") else "International"

    persona_key = (genre, decade, country)
    if persona_key in _PERSONA_MAP:
        persona, description = _PERSONA_MAP[persona_key]
    else:
        # Fallback by genre
        if "Horror" in genre:
            persona, description = "Horror Devotee", "You watch scary movies like other people watch comfort food shows."
        elif "Comedy" in genre:
            persona, description = "Laugh Track Survivor", "You've seen every joke coming since 1995, but you still show up."
        elif "Drama" in genre:
            persona, description = "Emotional Masochist", "You pay money to feel feelings. That's commitment."
        elif "Action" in genre:
            persona, description = "Adrenaline Junkie", "Physics are optional, explosions are mandatory."
        elif "Sci-Fi" in genre:
            persona, description = "Future Pessimist", "You watch dystopian futures and think 'sounds about right.'"
        else:
            persona = f"{genre} Enthusiast"
            description = f"You've made {genre} your personality, and honestly? Respect."

    return {"persona": persona, "description": description}


# ---------------------------------------------------------------------------
# Story-driven analytics
# ---------------------------------------------------------------------------

def compute_story_analytics(
    stats: Dict[str, Any],
    films_enriched: pd.DataFrame,
    films_df: pd.DataFrame,
    diary_df: pd.DataFrame,
) -> Dict[str, Any]:
    """Compute story-driven analytics: time spent, activity, season, passport, archetype."""
    result: Dict[str, Any] = {}

    # Time spent story
    if stats.get("days_watched", 0) > 0:
        days = stats["days_watched"]
        if days >= 30:
            time_story = (
                f"You spent {days:.0f} days watching movies this year. "
                f"That's basically {days/30:.1f} months of your life. No regrets?"
            )
        elif days >= 7:
            weeks = days / 7
            time_story = (
                f"You clocked {days:.1f} days of screen time. "
                f"That's {weeks:.1f} weeks of pure cinema dedication."
            )
        else:
            time_story = (
                f"You spent {days:.1f} days watching movies. Quality over quantity, we respect that."
            )
        result["time_spent_story"] = time_story

    # Most active day
    if not diary_df.empty and "parsed_date" in diary_df.columns:
        daily_counts = diary_df.groupby(diary_df["parsed_date"].dt.date).size()
        if not daily_counts.empty:
            most_active_date = daily_counts.idxmax()
            max_films = int(daily_counts.max())
            months_en = [
                "", "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December",
            ]
            date_str = f"{months_en[most_active_date.month]} {most_active_date.day}"
            if max_films >= 4:
                activity_story = (
                    f"Remember {date_str}? You watched {max_films} movies in one day. "
                    "That's either dedication or avoidance behavior."
                )
            elif max_films == 3:
                activity_story = (
                    f"On {date_str}, you managed {max_films} films. Solid marathon vibes."
                )
            else:
                activity_story = (
                    f"Your most active day was {date_str} with {max_films} films. "
                    "Respectable commitment."
                )
            result["most_active_day"] = {
                "date": pd.Timestamp(most_active_date).strftime("%Y-%m-%d"),
                "films": max_films,
                "story": activity_story,
            }

    # Rating personality (story version)
    if "rating" in films_df.columns:
        ratings = films_df["rating"].dropna()
        if not ratings.empty:
            avg_rating = float(ratings.mean())
            rating_std = float(ratings.std()) if len(ratings) > 1 else 0
            if avg_rating >= 4.2:
                rating_personality = "Easy to Please"
                rating_description = "You hand out 4-5 stars like candy. Either you have great taste or low standards."
            elif avg_rating <= 3.2:
                rating_personality = "Tough Critic"
                rating_description = "Your ratings hover around 3 stars. You're basically the Gordon Ramsay of cinema."
            elif rating_std > 1.2:
                rating_personality = "Mood Swinger"
                rating_description = "Your ratings are all over the place. A film either destroys you or bores you to death."
            else:
                rating_personality = "Balanced Judge"
                rating_description = "Your ratings are perfectly balanced. You give every film exactly what it deserves."
            result["rating_personality"] = {
                "type": rating_personality,
                "description": rating_description,
                "average": round(avg_rating, 1),
            }

    # Viewing season
    if stats.get("monthly_viewing_habits"):
        seasons = {
            "Winter": ["December", "January", "February"],
            "Spring": ["March", "April", "May"],
            "Summer": ["June", "July", "August"],
            "Fall": ["September", "October", "November"],
        }
        # Map "YYYY-MM" → month name
        from calendar import month_name
        season_counts: Dict[str, int] = {}
        for season, months in seasons.items():
            season_counts[season] = sum(
                m["count"]
                for m in stats["monthly_viewing_habits"]
                if any(
                    month_name[int(m["month"].split("-")[1])] == month
                    for month in months
                )
            )

        if sum(season_counts.values()) > 0:
            top_season = max(season_counts, key=season_counts.get)
            total_seasons = sum(season_counts.values())
            season_percentage = round((season_counts[top_season] / total_seasons) * 100)
            season_stories = {
                "Winter": (
                    f"Winter is your movie season. You watched {season_percentage}% "
                    "of your films during the cold months. Peak cozy behavior."
                ),
                "Summer": (
                    f"Summer is when you really commit to cinema. {season_percentage}% "
                    "of your films happened in the sunny months. Air conditioning is underrated."
                ),
                "Spring": (
                    f"Spring awakens your cinematic spirit. {season_percentage}% "
                    "of your films bloomed with the flowers. Very poetic of you."
                ),
                "Fall": (
                    f"Fall is your movie season. {season_percentage}% "
                    "of your films dropped with the leaves. Maximum atmospheric vibes."
                ),
            }
            result["viewing_season"] = {
                "season": top_season,
                "percentage": season_percentage,
                "story": season_stories.get(
                    top_season, f"{top_season} is your movie season!"
                ),
            }

    # Cinematic passport
    if stats.get("top_countries") and stats.get("total_countries", 0) > 0:
        total_countries = stats["total_countries"]
        if total_countries >= 15:
            passport_story = (
                f"You've collected {total_countries} countries in your cinematic "
                "passport this year. Basically a cultural anthropologist."
            )
        elif total_countries >= 8:
            passport_story = (
                f"You added {total_countries} new countries to your cinematic journey "
                "this year. Solid exploration game."
            )
        else:
            passport_story = (
                f"You discovered {total_countries} different countries through cinema "
                "this year. Quality over quantity."
            )

        total_directors = stats.get("total_directors", 0)
        if total_directors >= 50:
            director_story = (
                f"You explored {total_directors} directors this year. "
                "You're basically a walking IMDb."
            )
        elif total_directors >= 20:
            director_story = (
                f"You discovered {total_directors} new directors, expanding your "
                "cinematic horizons like a proper film scholar."
            )
        else:
            director_story = (
                f"You explored {total_directors} different directors this year. "
                "Building that auteur knowledge base."
            )

        result["cinematic_passport"] = {
            "countries": total_countries,
            "directors": total_directors,
            "country_story": passport_story,
            "director_story": director_story,
        }

    # Cinema archetype (average popularity + film age)
    avg_popularity_val = 0.0
    if not films_enriched.empty and "popularity" in films_enriched.columns:
        pop_scores = films_enriched["popularity"].dropna()
        if not pop_scores.empty:
            avg_popularity_val = float(pop_scores.mean())

    avg_film_age_val = 20.0
    if stats.get("fun_statistics", {}).get("film_age_analysis"):
        avg_film_age_val = stats["fun_statistics"]["film_age_analysis"]["average_age"]

    is_mainstream = avg_popularity_val > 30
    is_modern = avg_film_age_val < 15

    if is_mainstream and is_modern:
        archetype = "Pop Culture Professor"
        archetype_description = (
            "You follow current and popular films religiously. "
            "You're basically the pulse of contemporary cinema."
        )
    elif not is_mainstream and not is_modern:
        archetype = "Archive Treasure Hunter"
        archetype_description = (
            "You dig up old and obscure films like a true cinephile. "
            "You're the keeper of forgotten classics."
        )
    elif not is_mainstream and is_modern:
        archetype = "Indie Oracle"
        archetype_description = (
            "You discover new independent and festival films before everyone else. "
            "You're a cinema prophet."
        )
    else:
        archetype = "Time Traveler"
        archetype_description = (
            "You watch films from every era with perfect balance. "
            "You're the master of cinema history."
        )

    result["cinema_archetype"] = {
        "type": archetype,
        "description": archetype_description,
        "popularity_score": round(avg_popularity_val, 1),
        "film_age": round(avg_film_age_val, 1),
    }

    return result


# ---------------------------------------------------------------------------
# Insights
# ---------------------------------------------------------------------------

def compute_insights(stats: Dict[str, Any]) -> List[Dict[str, str]]:
    """Generate a list of insight cards from computed stats."""
    insights: List[Dict[str, str]] = []

    if stats.get("days_watched", 0) > 0:
        insights.append({
            "title": "Time Invested",
            "description": f"You've spent {stats['days_watched']} days of your life watching movies!",
        })

    if stats.get("most_watched_director"):
        d = stats["most_watched_director"]
        insights.append({
            "title": "Director Obsession",
            "description": f"You're a big fan of {d['name']} - you've watched {d['count']} of their films!",
        })

    if stats.get("favorite_decade"):
        d = stats["favorite_decade"]
        insights.append({
            "title": "Time Traveler",
            "description": f"You love {d['name']} cinema with {d['count']} films from that era!",
        })

    avg_rating = stats.get("average_rating", 0)
    if avg_rating and avg_rating > 4:
        insights.append({
            "title": "Easy to Please",
            "description": f"You're generous with ratings - averaging {avg_rating}\u2605!",
        })
    elif avg_rating and avg_rating < 3:
        insights.append({
            "title": "Tough Critic",
            "description": f"You're a tough critic with an average rating of {avg_rating}\u2605",
        })

    if stats.get("total_countries", 0) > 10:
        insights.append({
            "title": "Global Cinema Explorer",
            "description": f"You've watched films from {stats['total_countries']} different countries!",
        })

    return insights


# ---------------------------------------------------------------------------
# Wrap-up stats
# ---------------------------------------------------------------------------

def compute_secret_obsession(stats: Dict[str, Any]) -> Optional[str]:
    """Return the first keyword that isn't also a genre name."""
    if "keywords_analytics" not in stats:
        return None
    genre_names = {g["name"].lower() for g in stats.get("top_genres", [])}
    for kw in stats["keywords_analytics"].get("top_keywords", []):
        if kw["keyword"].lower() not in genre_names:
            return kw["keyword"]
    return None


def compute_runtime_persona(stats: Dict[str, Any]) -> str:
    """Classify viewing style by average runtime."""
    if "average_runtime" in stats:
        if stats["average_runtime"] > 130:
            return "The Marathoner"
        elif stats["average_runtime"] < 100:
            return "The Sprinter"
    return "The Balanced Viewer"


def compute_furthest_destination(stats: Dict[str, Any]) -> Optional[str]:
    """Return the first non-USA/UK country from top_countries."""
    for country in stats.get("top_countries", []):
        if country["name"] not in ("USA", "UK"):
            return country["name"]
    return None


# ---------------------------------------------------------------------------
# Film age analysis
# ---------------------------------------------------------------------------

def compute_film_age_analysis(films_enriched: pd.DataFrame) -> Optional[Dict[str, Any]]:
    """Compute average film age and classify viewing as new/classic."""
    if films_enriched.empty or "release_date" not in films_enriched.columns:
        return None

    current_year = datetime.now().year
    film_ages: List[int] = []
    for release_date in films_enriched["release_date"].dropna():
        if release_date:
            try:
                film_ages.append(current_year - int(str(release_date)[:4]))
            except (ValueError, TypeError):
                continue

    if not film_ages:
        return None

    avg_age = round(sum(film_ages) / len(film_ages), 1)
    recent_films = len([age for age in film_ages if age <= 5])
    recent_percentage = round((recent_films / len(film_ages)) * 100, 1)

    return {
        "average_age": avg_age,
        "recent_percentage": recent_percentage,
        "type": (
            "innovation hunter" if recent_percentage > 60
            else "classic lover" if avg_age > 20
            else "balanced"
        ),
    }