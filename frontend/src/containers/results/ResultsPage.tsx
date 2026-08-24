"use client";

import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
} from "react";
import Link from "next/link";
import type { ShareCardData } from "@/components/share/types";
import {
  buildShareCardFromStats,
  normalizeShareCardData,
} from "@/components/share/viewModel";
import type { StatsData } from "@/containers/results/sections/types";

import { ThemeProvider } from "@/lib/theme";
import ThemeWrapper from "@/components/ThemeWrapper";
import type { FeedbackFabRef } from "@/components/FeedbackFab";
import { trackEvent } from "@/lib/analytics";
import {
  buildAnalysisRange,
  buildDecadeData,
  buildRatingData,
  getRuntimeHours,
} from "@/containers/results/results-model";
import dynamic from "next/dynamic";
import ResultsShell from "@/containers/results/ResultsShell";
import ResultsTopBar from "@/containers/results/ResultsTopBar";
import { useResultsSession } from "@/containers/results/useResultsSession";
import { useI18n } from "@/i18n/I18nProvider";
import { localizePath } from "@/i18n/routing";
import { markResultsNav } from "@/lib/results-nav";
import { trackToggleChanged } from "@/containers/results/sections/section-utils";

export { ResultsContent } from "@/containers/results/ResultsContent";

const ResultsContentLazy = dynamic(
  () =>
    import("@/containers/results/ResultsContent").then((mod) => {
      function MarkedResultsContent(
        props: React.ComponentProps<typeof mod.ResultsContent>,
      ) {
        useEffect(() => {
          markResultsNav("content-mounted");
          const id = window.requestAnimationFrame(() => {
            markResultsNav("interactive");
          });
          return () => window.cancelAnimationFrame(id);
        }, []);
        return <mod.ResultsContent {...props} />;
      }
      return { default: MarkedResultsContent };
    }),
  { ssr: false, loading: () => <ResultsShell /> },
);

// Note: StatsData is imported from @/containers/results/sections/types

export default function ResultsPage() {
  const { locale, t } = useI18n();
  const {
    stats,
    loading,
    isMobile,
    username,
    sessionId,
  } = useResultsSession();

  // stats window toggle (all-time vs last 12 months, computed once during the scrape)
  const [statsWindow, setStatsWindow] = useState<"lifetime" | "year">("lifetime");
  const activeStats =
    statsWindow === "year" && stats?.last_12_months ? stats.last_12_months : stats;
  const handleStatsWindowChange = (next: "lifetime" | "year") => {
    setStatsWindow(next);
    trackToggleChanged("stats_window", next);
  };

  // share
  const [showShareModal, setShowShareModal] = useState(false);
  const [orientation, setOrientation] = useState<"horizontal" | "vertical">(
    "vertical",
  );

  // feedback
  const feedbackRef = useRef<FeedbackFabRef>(null);
  const [hasTriggeredFeedback, setHasTriggeredFeedback] = useState(false);

  // Derived data - maintain hook order
  const decadeData = useMemo(() => buildDecadeData(activeStats), [activeStats]);
  const decadeMax = useMemo(
    () => Math.max(0, ...decadeData.map((d) => d.count)),
    [decadeData],
  );

  const ratingsArr = useMemo(() => buildRatingData(activeStats), [activeStats]);
  const ratingMax = useMemo(
    () => Math.max(0, ...ratingsArr.map((d) => d.count)),
    [ratingsArr],
  );

  const { actualRangeDays, dateRangeText } = useMemo(
    () => buildAnalysisRange(activeStats),
    [activeStats],
  );

  const runtimeHours = useMemo(() => getRuntimeHours(activeStats), [activeStats]);

  const timePct = useMemo(() => {
    const safeRangeDays = Math.max(1, actualRangeDays);

    // Calculate based on waking hours
    const wakingHoursPerDay = 16;
    const totalWakingHours = safeRangeDays * wakingHoursPerDay;

    let percentage = Math.round((runtimeHours / totalWakingHours) * 100);

    // Adjust for short periods
    if (safeRangeDays <= 30) {
      const totalAvailableHours = safeRangeDays * 24;
      percentage = Math.round((runtimeHours / totalAvailableHours) * 100);
    }

    return `${Math.min(percentage, 100)}%`;
  }, [runtimeHours, actualRangeDays]);

  const cineScore = useMemo(() => {
    const score = activeStats?.sinefil_meter?.score;
    return score == null ? undefined : Math.max(0, Math.min(100, score));
  }, [activeStats]);

  const shareCardData = useMemo<ShareCardData | null>(
    () =>
      showShareModal
        ? normalizeShareCardData(
            buildShareCardFromStats(activeStats, {
              username: username || undefined,
              unknownActor: t('results.people.unknownActor'),
              unknownDirector: t('results.people.unknownDirector'),
              timePercent: Number.parseInt(timePct, 10) || 0,
            }),
          )
        : null,
    [
      showShareModal,
      activeStats,
      username,
      timePct,
      t,
    ],
  );

  useEffect(() => {
    void import("@/containers/results/ResultsContent");
  }, []);

  useEffect(() => {
    // Analytics for results viewed
    if (stats) {
      trackEvent("results_viewed_unified", {
        total_films: stats.total_films,
        cine_score: cineScore,
      });
    }
  }, [stats, cineScore]);

  const chrome = (
    <ResultsTopBar
      hasYearWindow={Boolean(stats?.last_12_months)}
      statsWindow={statsWindow}
      onStatsWindowChange={handleStatsWindowChange}
    />
  );

  if (loading) {
    return (
      <ThemeProvider>
        <ThemeWrapper>
          {chrome}
          <ResultsShell />
        </ThemeWrapper>
      </ThemeProvider>
    );
  }
  if (
    !stats ||
    (typeof stats === "object" && Object.keys(stats).length === 0)
  ) {
    return (
      <ThemeProvider>
        <ThemeWrapper>
          {chrome}
          <div className="min-h-dvh bg-[#1e252d] flex items-center justify-center text-white">
            <div className="text-center px-4">
              <h2 className="text-2xl font-bold mb-4">{t('results.empty.noData')}</h2>
              <p className="text-gray-400">
                {username
                  ? t('results.empty.noUserData', { username })
                  : t('results.empty.uploadFirst')}
              </p>
              <Link
                href={localizePath('/', locale)}
                className="mt-6 inline-block px-6 py-3 bg-orange-500 hover:bg-orange-600 rounded-xl font-semibold transition-colors"
              >
                {t('results.empty.goBack')}
              </Link>
            </div>
          </div>
        </ThemeWrapper>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <ThemeWrapper>
        {chrome}
        <ResultsContentLazy
        stats={activeStats ?? stats}
        sessionId={sessionId}
        username={username}
        dateRangeText={dateRangeText}
        timePct={timePct}
        runtimeHours={runtimeHours}
        decadeData={decadeData}
        decadeMax={decadeMax}
        isMobile={isMobile}
        ratingsArr={ratingsArr}
        ratingMax={ratingMax}
        cineScore={cineScore}
        showShareModal={showShareModal}
        setShowShareModal={setShowShareModal}
        shareCardData={shareCardData}
        orientation={orientation}
        setOrientation={setOrientation}
        hasTriggeredFeedback={hasTriggeredFeedback}
        setHasTriggeredFeedback={setHasTriggeredFeedback}
        feedbackRef={feedbackRef}
        />
      </ThemeWrapper>
    </ThemeProvider>
  );
}
