/**
 * Shared stats shape passed to every experimental metric component.
 * Intentionally a permissive superset so the registry doesn't need to import
 * from the page-level LetterboxdStats type.
 */

/** One film a director/actor appears in, for the "see their films" modal. */
export interface PersonFilm {
  title: string;
  year?: string;
  poster_path?: string;
  user_rating?: number | null;
}

export interface StatsData {
  total_films: number;
  average_rating: number | null;
  total_runtime?: number;
  hours_watched?: number;
  days_watched: number;
  average_runtime: number;
  median_runtime?: number;
  top_genres: { name: string; count: number }[];
  top_directors: { name: string; count: number; profile_path?: string; person_id?: number; films?: PersonFilm[] }[];
  top_actors: { name: string; count: number; profile_path?: string; person_id?: number; films?: PersonFilm[] }[];
  top_countries: { name: string; count: number }[];
  top_languages: { language: string; count: number }[];
  decades: { decade: string; count: number }[];
  rating_distribution: Record<string, number>;
  most_common_rating?: number;
  day_of_week_pattern?: { weekday: number; weekend: number };
  monthly_viewing_habits?: { month: string; count: number }[];
  favorite_decade?: { name: string; count: number };
  sinefil_meter?: {
    score: number;
    type: string;
    description?: string;
    breakdown?: {
      geography: number;
      temporal: number;
      languages: number;
      volume: number;
      genres: number;
      directors: number;
    };
    model_version?: string;
  };
  total_countries?: number;
  data_timeline?: {
    earliest_date?: string;
    latest_date?: string;
    total_days?: number;
    period_description?: string;
  };
  /** Optional window metadata from older runs; ZIP uploads are lifetime. */
  analysis_period?: {
    key?: string;
    start_date?: string | null;
    end_date?: string | null;
  };
  /** Same shape, computed over the last 12 months only. Present on scrape-profile results only. */
  last_12_months?: StatsData;
  cinematic_persona?: {
    persona: string;
    description: string;
  };
  /**
   * Signal breakdown behind cinematic_persona. Not yet emitted by the backend
   * (analysis.py only returns persona/description today) — declared here so
   * consumers can read it optionally once/if the backend adds it.
   */
  cinematic_persona_basis?: {
    genre?: string;
    decade?: string;
    country?: string;
    match_type?: string;
  };
  /** Rating-habit label from compute_rating_personality (analysis.py). */
  rating_personality?: string;
  /** Viewing-rhythm narrative from compute_story_analytics (analysis.py). */
  story_analytics?: {
    viewing_season?: string | { season?: string; percentage?: number; story?: string };
    most_active_day?: string | { date?: string; films?: number; story?: string };
  };
  favorite_genre?: {
    name: string;
    count: number;
  };
  /** Username when data came from scrape-profile path. */
  scraped_username?: string;
  /** Public Letterboxd avatar from the profile overview (scrape path only). */
  profile_avatar_url?: string;
  /** Total points earned in the poster-guessing game shown during scraping. */
  poster_game_score?: number;
  /** Rounds played (correct + given-up) in the poster-guessing game. */
  poster_game_rounds?: number;
  /** Data source for this Wrapped. "scrape" = full profile scrape, "csv" = upload. */
  source?: string;
  /** Number of films in the sample (scrape mode). */
  recent_films_count?: number;
  /** Exactness metadata; present on sample stats to label precision. */
  data_quality?: {
    mode?: string;
    exactness?: string;
    sample_size?: number;
    tmdb_id_coverage?: number;
    limitations?: string[];
  };
  most_watched_director?: {
    name: string;
    count: number;
  };
  longest_film?: {
    title: string;
    runtime: number;
  };

  // ── Extended fields emitted by backend for experimental sections ────────────
  /** Per-director avg rating; only directors with rated_count >= 3 included. */
  directors_with_ratings?: {
    name: string;
    count: number;
    avg_rating: number;
    rated_count: number;
    profile_path?: string;
    films?: PersonFilm[];
  }[];
  /** Per-actor avg rating; only actors with rated_count >= 3 included. */
  actors_with_ratings?: {
    name: string;
    count: number;
    avg_rating: number;
    rated_count: number;
    profile_path?: string;
    films?: PersonFilm[];
  }[];
  /** Per-country avg rating; only countries with rated_count >= 5 included. */
  countries_with_ratings?: {
    name: string;
    count: number;
    avg_rating: number;
    rated_count: number;
  }[];
  /** Individual rated film records for rating-deviation section. */
  rated_films?: {
    title: string;
    year?: number;
    rating?: number;
    your_rating?: number;
    /** TMDB community rating, normalized to the 0–5 scale. null when no votes. */
    community_rating?: number | null;
    average_rating?: number | null;
    poster_path?: string;
    popularity?: number;
  }[];
  /** Up to 4 films pinned as favorites on the user's Letterboxd profile page. */
  favorite_films?: {
    title: string;
    year?: number;
    poster_path?: string;
  }[];
  /** Total number of rated films in the upload. */
  total_rated_films?: number;
  /** The film whose user rating diverges most from TMDB community average. */
  rating_outlier_film?: {
    title: string;
    year?: number | string;
    poster_path?: string;
    user_rating: number;
    avg_rating: number;
    delta: number;
  };
  /** Films actually logged inside the diary window (excludes pre-Letterboxd backfill). */
  diary_film_count?: number;
  /** Top films by rewatch count from diary. Each entry watched 2+ times. */
  rewatch_champions?: {
    title: string;
    year?: number | null;
    poster_path?: string;
    watch_count: number;
  }[];
  /** Nth chronologically-watched film for N in (100, 300, 500, 750). Only reached thresholds present. */
  milestones?: {
    ordinal: number;
    title: string;
    year?: number | null;
    poster_path?: string;
    watched_date: string;
  }[];
  /**
   * ISO-2 keyed country data emitted from production_countries TMDB field.
   * More reliable than top_countries (which uses name strings only).
   * avg_rating / rated_count present only when ratings data available + minSample >= 5.
   */
  countries_iso_data?: {
    iso2: string;
    name: string;
    count: number;
    avg_rating?: number;
    rated_count?: number;
  }[];
  /** Full film list for frontend-side re-aggregation (e.g. country→films lookup). */
  all_films?: {
    title: string;
    year?: number;
    director?: string;
    genres?: string[];
    countries?: string[];
    language?: string;
    runtime?: number;
    poster_path?: string;
    decade?: string;
    rating?: number;
    cast?: string[];
    average_rating?: number | null;
    popularity?: number;
  }[];

  /** Review text metrics from compute_review_metrics (review_analysis.py). */
  review_analysis?: {
    total_reviews: number;
    reviews_with_text: number;
    review_rate: number;
    total_words_written: number;
    avg_review_length_words: number;
    unique_words_used: number;
    vocab_richness: number;
    word_frequency: { word: string; count: number }[];
    bigram_frequency: { bigram: string; count: number }[];
    avg_length_by_rating: Record<string, number>;
    language_mix: Record<string, { count: number; percentage: number }>;
    /** Top liked reviews; present only on scrape-profile path with HTML like data. */
    top_liked_reviews?: {
      title: string;
      year: string;
      slug?: string;
      like_count: number;
      rating?: number | null;
      review_date?: string;
      text_preview?: string;
      poster_path?: string;
      char_length?: number;
      word_count?: number;
      likers?: ReviewLiker[];
      likers_complete?: boolean;
    }[];
    /** Canonical longest review; new payloads measure readable words, legacy saves may use characters. */
    longest_review?: {
      title: string;
      year: string;
      length: number;
      unit?: 'words' | 'characters';
    } | null;
    /** Sum of like_count across all reviews with HTML like data. */
    total_review_likes?: number | null;
    /** Number of reviews whose like_count was successfully parsed. */
    reviews_with_likes_data?: number | null;
    /** Full list of reviews extracted from csv/scrape. */
    reviews?: {
      title: string;
      year?: string;
      text?: string;
      likes?: number;
      rating?: number | null;
      poster_path?: string;
      review_path?: string;
      char_length?: number;
      word_count?: number;
      likers?: ReviewLiker[];
      likers_complete?: boolean;
    }[];
  };
}

/** A public Letterboxd user who liked a review (scrape path only). */
export interface ReviewLiker {
  username: string;
  display_name: string;
  avatar_url?: string | null;
}
