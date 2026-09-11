"use client";

import { getSupabase, safeSupabaseCall } from "@/lib/supabaseClient";

/** Ensures object is JSON-serializable (no functions, undefined, etc.). */
function safeJsonSanitize(obj: unknown): Record<string, unknown> {
    try {
        const str = JSON.stringify(obj);
        if (!str) return {};
        const parsed = JSON.parse(str);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
        return {};
    }
}

function sliceTop<T>(arr: T[] | undefined, n: number): T[] {
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, Math.max(0, n));
}

function namedCount(value: unknown): { name: string; count: number } | null {
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (typeof item.name !== "string" || typeof item.count !== "number") return null;
    return { name: item.name, count: item.count };
}

function namedCountList(value: unknown, limit: number): { name: string; count: number }[] {
    if (!Array.isArray(value)) return [];
    return value
        .map(namedCount)
        .filter((item): item is { name: string; count: number } => item !== null)
        .slice(0, limit);
}

function finiteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Review counts plus title/year/length records — never bodies or likers. */
function buildReviewMetrics(stats: Record<string, unknown>): Record<string, unknown> | null {
    const source = stats.review_analysis;
    if (!source || typeof source !== "object" || Array.isArray(source)) return null;
    const review = source as Record<string, unknown>;
    const metrics: Record<string, unknown> = {};
    for (const key of [
        "total_reviews",
        "reviews_with_text",
        "review_rate",
        "total_words_written",
        "avg_review_length_words",
        "unique_words_used",
        "vocab_richness",
        "total_review_likes",
        "reviews_with_likes_data",
    ] as const) {
        const value = finiteNumber(review[key]);
        if (value !== null) metrics[key] = value;
    }
    const longest = review.longest_review;
    if (longest && typeof longest === "object" && !Array.isArray(longest)) {
        const row = longest as Record<string, unknown>;
        const length = finiteNumber(row.length);
        if (length !== null) {
            metrics.longest_review = {
                length,
                ...(row.unit === "words" || row.unit === "characters" ? { unit: row.unit } : {}),
            };
        }
    }
    const reviews = slimReviewList(review.reviews);
    if (reviews.length > 0) metrics.reviews = reviews;
    return Object.keys(metrics).length > 0 ? metrics : null;
}

function slimReviewList(value: unknown, limit = 80): Record<string, unknown>[] {
    if (!Array.isArray(value)) return [];
    const rows: Array<Record<string, unknown> & { _sort: number }> = [];
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        const row = item as Record<string, unknown>;
        if (typeof row.title !== "string" || !row.title.trim()) continue;
        const slim: Record<string, unknown> & { _sort: number } = {
            title: row.title.trim(),
            _sort: finiteNumber(row.word_count) ?? 0,
        };
        if (typeof row.year === "string" && row.year) slim.year = row.year;
        const wordCount = finiteNumber(row.word_count);
        if (wordCount !== null) slim.word_count = wordCount;
        const rating = finiteNumber(row.rating);
        if (rating !== null) slim.rating = rating;
        if (typeof row.poster_path === "string" && row.poster_path) slim.poster_path = row.poster_path;
        rows.push(slim);
    }
    rows.sort((a, b) => b._sort - a._sort);
    return rows.slice(0, limit).map(({ _sort: _ignored, ...rest }) => rest);
}

function pickObject(value: unknown, keys: string[]): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
        keys
            .filter((key) => source[key] !== undefined)
            .map((key) => [key, source[key]])
    );
}

/** Keep only aggregate fields used by analysis listings and cross-user metrics. */
function buildPersistedDetails(stats: Record<string, unknown>): Record<string, unknown> {
    return safeJsonSanitize({
        total_films: stats.total_films ?? null,
        days_watched: stats.days_watched ?? null,
        average_rating: stats.average_rating ?? null,
        total_countries: stats.total_countries ?? null,
        average_runtime: stats.average_runtime ?? null,
        top_genres: namedCountList(stats.top_genres, 5),
        top_directors: namedCountList(stats.top_directors, 5),
        sinefil_meter: pickObject(stats.sinefil_meter, ["score", "type", "model_version"]),
        cinematic_persona: pickObject(stats.cinematic_persona, ["persona"]),
        runtime_persona: typeof stats.runtime_persona === "string" ? stats.runtime_persona : null,
        favorite_genre: namedCount(stats.favorite_genre),
        favorite_decade: namedCount(stats.favorite_decade),
        most_watched_director: namedCount(stats.most_watched_director),
        analysis_date: typeof stats.analysis_date === "string" ? stats.analysis_date : null,
        analysis_period: pickObject(stats.analysis_period, [
            "key",
            "start_date",
            "end_date",
        ]),
        data_timeline: pickObject(stats.data_timeline, [
            "earliest_date",
            "latest_date",
            "total_days",
            "period_description",
        ]),
        review_metrics: buildReviewMetrics(stats) ?? undefined,
    });
}

/** Build small preview for list views: totals + top5 genres/directors + personas + dates. */
function buildPreview(details: Record<string, unknown>, schemaVersion: string): Record<string, unknown> {
    return {
        schema_version: schemaVersion,
        totals: {
            total_films: details.total_films ?? null,
            days_watched: details.days_watched ?? null,
            average_rating: details.average_rating ?? null,
            total_countries: details.total_countries ?? null,
            average_runtime: details.average_runtime ?? null,
        },
        top_genres: sliceTop(details.top_genres as { name: string; count: number }[] | undefined, 5),
        top_directors: sliceTop(details.top_directors as { name: string; count: number }[] | undefined, 5),
        personas: {
            sinefil_meter: details.sinefil_meter ?? null,
            cinematic_persona: details.cinematic_persona ?? null,
            runtime_persona: details.runtime_persona ?? null,
            favorite_genre: details.favorite_genre ?? null,
            favorite_decade: details.favorite_decade ?? null,
            most_watched_director: details.most_watched_director ?? null,
        },
        dates: {
            analysis_date: details.analysis_date ?? null,
            analysis_period: details.analysis_period ?? null,
            data_timeline: details.data_timeline ?? null,
        },
    };
}

/** Build an aggregate-only summary payload; full film and review data stays in-session. */
export function buildSummaryForPersistence(stats: Record<string, unknown>): Record<string, unknown> {
    const details = buildPersistedDetails(stats);
    const schema_version = "results_v2_aggregate";
    const saved_at = new Date().toISOString();

    return {
        schema_version,
        saved_at,
        details,
        preview: buildPreview(details, schema_version),
    };
}

/** Extract full results for rendering; supports legacy flat summary. */
export function getDetailsFromSummary(summary: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    if (!summary || typeof summary !== "object") return null;
    if ("details" in summary && summary.details && typeof summary.details === "object") {
        return summary.details as Record<string, unknown>;
    }
    return summary as Record<string, unknown>;
}

/** Extract preview for list views; returns null if no preview. */
export function getPreviewFromSummary(summary: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
    if (!summary || typeof summary !== "object") return null;
    if ("preview" in summary && summary.preview && typeof summary.preview === "object") {
        return summary.preview as Record<string, unknown>;
    }
    return null;
}

export type AnalysisStartInput = {
    session_id: string;
    username: string;
    started_at?: string | null;
};

export type AnalysisFinishInput = {
    id: string;
    ok?: boolean | null;
    error_message?: string | null;
    error_code?: string | null;
    task_id?: string | null;
    summary?: Record<string, unknown> | null;
    finished_at?: string | null;
};

export async function startAnalysis(input: AnalysisStartInput & { id?: string }) {
    const supabase = getSupabase();
    const payload = {
        id: input.id ?? crypto?.randomUUID?.() ?? `run_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        session_id: input.session_id,
        anonymous_session_id: input.session_id,
        username: input.username,
        started_at: input.started_at ?? new Date().toISOString(),
    };
    
    
    const { error } = await supabase
        .from("analysis_runs")
        .insert(payload);
    
    if (error) {
        throw new Error(`Analysis start failed: ${error.message || error.code || 'Unknown error'}`);
    }
    
    return { id: payload.id };
}

/**
 * Extract queryable metrics from the summary payload for the extracted columns
 * (total_films, sinefil_meter, cinematic_persona, average_rating, total_countries).
 * Falls back to available values; missing fields become null.
 */
function extractMetrics(summaryPayload: Record<string, unknown> | null): {
    total_films: number | null;
    sinefil_meter: number | null;
    cinematic_persona: string | null;
    average_rating: number | null;
    total_countries: number | null;
} {
    // Reuse the shared details accessor (handles null + legacy-flat summaries).
    // Producers always emit sinefil_meter/cinematic_persona as objects, so a single
    // typed cast + optional chaining is enough — no bare-scalar fallbacks needed.
    const details = getDetailsFromSummary(summaryPayload) as {
        total_films?: number | null;
        sinefil_meter?: { score?: number | null } | null;
        cinematic_persona?: { persona?: string | null } | null;
        average_rating?: number | null;
        total_countries?: number | null;
    } | null;

    return {
        total_films: details?.total_films ?? null,
        sinefil_meter: details?.sinefil_meter?.score ?? null,
        cinematic_persona: details?.cinematic_persona?.persona ?? null,
        average_rating: details?.average_rating ?? null,
        total_countries: details?.total_countries ?? null,
    };
}

export async function finishAnalysis(input: AnalysisFinishInput) {
    const supabase = getSupabase();
    const summaryPayload = (() => {
        if (!input.summary) return null;
        if ("preview" in input.summary && "details" in input.summary) {
            return input.summary;
        }
        return buildSummaryForPersistence(input.summary);
    })();

    // Extract queryable metric columns from the summary (for cross-user SQL queries)
    const metrics = extractMetrics(summaryPayload);

    // analysis_version comes from the backend (stats.sinefil_meter.model_version),
    // which is the single source of truth — never hardcoded in the frontend.
    // Only set it when the summary actually carries it, so the DB default
    // ('cine_v2') is never clobbered by a null on older/error paths.
    const details = getDetailsFromSummary(summaryPayload) as {
        sinefil_meter?: { model_version?: string | null } | null;
    } | null;
    const analysisVersion = details?.sinefil_meter?.model_version ?? null;

    const updatePayload: Record<string, unknown> = {
        ok: input.ok ?? null,
        error_message: input.error_message ?? null,
        error_code: input.error_code ?? null,
        task_id: input.task_id ?? null,
        summary: summaryPayload,
        finished_at: input.finished_at ?? new Date().toISOString(),
        total_films: metrics.total_films,
        sinefil_meter: metrics.sinefil_meter,
        cinematic_persona: metrics.cinematic_persona,
        average_rating: metrics.average_rating,
        total_countries: metrics.total_countries,
    };
    if (analysisVersion) {
        updatePayload.analysis_version = analysisVersion;
    }

    const { error } = await supabase
        .from("analysis_runs")
        .update(updatePayload)
        .eq("id", input.id)
        .select('id');
    
    if (error) {
        throw error;
    }

}

/** Minimum number of scored runs before we trust a percentile enough to show it. */
const MIN_SAMPLE_SIZE = 10;

/**
 * Percentile of `score` among all persisted sinefil_meter values, i.e. the share of
 * users this score is more adventurous than. Returns null on error or if the sample
 * is too small to be meaningful (avoids "beats 100%" claims off a handful of rows).
 */
export async function getSinefilPercentile(score: number): Promise<number | null> {
    const supabase = getSupabase();

    type CountResponse = { data: unknown; error: unknown; count?: number | null };

    const [totalResult, belowResult] = await Promise.all([
        safeSupabaseCall(() =>
            supabase
                .from("analysis_runs")
                .select("*", { head: true, count: "exact" })
                .not("sinefil_meter", "is", null)
        ) as Promise<CountResponse>,
        safeSupabaseCall(() =>
            supabase
                .from("analysis_runs")
                .select("*", { head: true, count: "exact" })
                .not("sinefil_meter", "is", null)
                .lt("sinefil_meter", score)
        ) as Promise<CountResponse>,
    ]);

    if (totalResult.error || belowResult.error) return null;

    const total = totalResult.count ?? 0;
    const below = belowResult.count ?? 0;

    if (total < MIN_SAMPLE_SIZE) return null;

    return Math.round((below / total) * 100);
}
