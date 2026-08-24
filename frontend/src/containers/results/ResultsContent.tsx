"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import FeedbackFab, { type FeedbackFabRef } from "@/components/FeedbackFab";
import type { ShareCardData } from "@/components/share/types";
import { FilmHistory, RatingsBar } from "@/containers/results/FilmAndRatings";
import HeroStats from "@/containers/results/HeroStats";
import LanguagesLeaderboard from "@/containers/results/LanguagesLeaderboard";
import CinemaScale from "@/containers/results/CinemaScale";
import RewatchChampions from "@/containers/results/RewatchChampions";
import {
  selectAllFilms,
  selectDirectorFilms,
  selectGenreFilms,
  selectPersonFilms,
  selectRatedFilms,
  type ResultFilm,
} from "@/containers/results/film-selectors";
import type {
  DecadeDatum,
  RatingDatum,
} from "@/containers/results/results-model";
import CastGrid from "@/containers/results/sections/CastGrid";
import DirectorsGrid from "@/containers/results/sections/DirectorsGrid";
import PersonFilmsModal from "@/containers/results/sections/PersonFilmsModal";
import RatingDeviation from "@/containers/results/sections/RatingDeviation";
import ReviewAnalysisSection from "@/containers/results/sections/ReviewAnalysisSection";
import type {
  PersonFilm,
  StatsData,
} from "@/containers/results/sections/types";
import { ScrollspyIndicator } from "@/containers/results/ScrollspyIndicator";
import { useLazyMount } from "@/hooks/useIntersectionObserver";
import { trackEvent } from "@/lib/analytics";
import { useTheme } from "@/lib/theme";
import { useI18n } from "@/i18n/I18nProvider";
import { localizePath } from "@/i18n/routing";

const ShareModal = dynamic(() => import("@/components/ShareModal"), {
  ssr: false,
  loading: () => null,
});

/* ===================== RESULTS CONTENT (theme-aware) ===================== */

interface ResultsContentProps {
  stats: StatsData;
  sessionId: string;
  username: string | null;
  dateRangeText: string;
  timePct: string;
  runtimeHours: number;
  decadeData: DecadeDatum[];
  decadeMax: number;
  isMobile: boolean;
  ratingsArr: RatingDatum[];
  ratingMax: number;
  cineScore: number | undefined;
  showShareModal: boolean;
  setShowShareModal: React.Dispatch<React.SetStateAction<boolean>>;
  shareCardData: ShareCardData | null;
  orientation: "horizontal" | "vertical";
  setOrientation: React.Dispatch<
    React.SetStateAction<"horizontal" | "vertical">
  >;
  hasTriggeredFeedback: boolean;
  setHasTriggeredFeedback: React.Dispatch<React.SetStateAction<boolean>>;
  feedbackRef: React.RefObject<FeedbackFabRef | null>;
}

export function ResultsContent({
  stats,
  sessionId,
  username,
  dateRangeText,
  timePct,
  runtimeHours,
  decadeData,
  decadeMax,
  isMobile,
  ratingsArr,
  ratingMax,
  cineScore,
  showShareModal,
  setShowShareModal,
  shareCardData,
  orientation,
  setOrientation,
  hasTriggeredFeedback,
  setHasTriggeredFeedback,
  feedbackRef,
}: ResultsContentProps) {
  const { locale, t } = useI18n();
  const { theme, config } = useTheme();

  const [modalOpen, setModalOpen] = useState(false);
  const [modalTitle, setModalTitle] = useState("");
  const [modalFilms, setModalFilms] = useState<PersonFilm[]>([]);
  const [modalGenre, setModalGenre] = useState<string | undefined>(undefined);

  const handleFilmsClick = () => {
    if (!stats?.all_films) return;
    setModalGenre(undefined);
    setModalTitle("All Watched Films");
    setModalFilms(selectAllFilms(stats.all_films));
    setModalOpen(true);
  };

  const handlePersonClick = (name: string, isDirector: boolean) => {
    if (!stats?.all_films) return;
    setModalGenre(undefined);
    setModalTitle(isDirector ? `Films by ${name}` : `Films starring ${name}`);
    const filteredFilms = selectPersonFilms(stats.all_films, name, isDirector);
    setModalFilms(filteredFilms);
    setModalOpen(true);
  };

  const handleAvgRatingClick = () => {
    if (!stats?.all_films) return;
    setModalGenre(undefined);
    setModalTitle("Your Rated Films");
    setModalFilms(selectRatedFilms(stats.all_films));
    setModalOpen(true);
  };

  const handleGenreClick = () => {
    const genre = stats?.top_genres?.[0]?.name;
    if (!genre || !stats?.all_films) return;
    setModalGenre(genre);
    setModalTitle(`${genre} Films`);
    setModalFilms(selectGenreFilms(stats.all_films, genre));
    setModalOpen(true);
  };

  const handleDirectorClick = () => {
    const director =
      stats?.top_directors?.[0]?.name || stats?.most_watched_director?.name;
    if (!director || !stats?.all_films) return;
    setModalGenre(undefined);
    setModalTitle(`Films by ${director}`);
    setModalFilms(selectDirectorFilms(stats.all_films, director));
    setModalOpen(true);
  };

  const handleDecadeClick = () => {
    const decade = stats?.favorite_decade?.name;
    if (!decade || !stats?.all_films) return;
    const startYear = parseInt(decade);
    if (isNaN(startYear)) return;
    const endYear = startYear + 9;
    setModalGenre(undefined);
    setModalTitle(`Films from the ${decade}`);
    setModalFilms(
      stats.all_films
        .filter((f) => {
          const year = parseInt(String(f.year));
          return !isNaN(year) && year >= startYear && year <= endYear;
        })
        .map((f) => ({
          title: f.title,
          year: f.year ? String(f.year) : undefined,
          poster_path: f.poster_path,
          user_rating: f.rating ?? null,
        }))
        .sort((a: PersonFilm, b: PersonFilm) => {
          const ratingDiff = (b.user_rating ?? -1) - (a.user_rating ?? -1);
          if (ratingDiff !== 0) return ratingDiff;
          const yearDiff = Number(b.year ?? 0) - Number(a.year ?? 0);
          return yearDiff || a.title.localeCompare(b.title);
        }),
    );
    setModalOpen(true);
  };

  const slides = [
    {
      id: "hero",
      render: () => (
        <div className="space-y-3 md:space-y-6">
          <header className="text-center px-6 md:px-0 py-4 md:py-10">
            <h1
              className="text-[clamp(32px,6vw,72px)] font-black mb-4 leading-[0.95] tracking-tighter"
              style={{
                fontFamily: "var(--theme-font-display)",
                color:
                  theme === "current"
                    ? "#fff"
                    : theme === "vhs"
                      ? "#f0e6d8"
                      : theme === "apple"
                        ? "#1D1D1F"
                        : "#e8e0d8",
              }}
            >
              Your{" "}
              <span
                className="bg-clip-text text-transparent"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${config.cssVars["--theme-accent"]}, ${config.cssVars["--theme-accent-2"]}${theme === "current" ? ", #d946ef" : ""})`,
                }}
              >
                Letterboxd
              </span>{" "}
              Wrapped
            </h1>
            <p
              className="text-xl mb-2"
              style={{
                color:
                  theme === "current"
                    ? "#d1d5db"
                    : theme === "vhs"
                      ? "#d4955a"
                      : theme === "apple"
                        ? "#6E6E73"
                        : "#8a8a8a",
              }}
            >
              A comprehensive analysis of your cinematic journey.
            </p>
            <p
              className="text-center text-lg"
              style={{
                color:
                  theme === "current"
                    ? "#9ca3af"
                    : theme === "vhs"
                      ? "#d4955a"
                      : theme === "apple"
                        ? "#86868B"
                        : "#6a6a6a",
              }}
            >
              {dateRangeText}
            </p>
          </header>

          <SectionContainer theme={theme}>
            <HeroStats
              username={username ?? undefined}
              avatarUrl={stats.profile_avatar_url}
              totalFilms={stats.total_films}
              avgRating={stats.average_rating}
              hoursWatched={runtimeHours}
              topGenre={stats.top_genres?.[0]?.name || "Unknown"}
              timePct={timePct}
              favoriteDirector={
                stats.top_directors?.[0] || { name: "Unknown", count: 0 }
              }
              favoriteDecade={
                stats.favorite_decade || { name: "Unknown", count: 0 }
              }
              onClickFilms={handleFilmsClick}
              onClickAvgRating={handleAvgRatingClick}
              onClickGenre={handleGenreClick}
              onClickDirector={handleDirectorClick}
              onClickDecade={handleDecadeClick}
            />
          </SectionContainer>
        </div>
      ),
    },
    {
      id: "people",
      render: () => (
        <div className="space-y-3 md:space-y-6">
          <div className="grid grid-cols-1 gap-6">
            <DirectorsGrid
              stats={stats}
              onDirectorClick={(name) => handlePersonClick(name, true)}
            />
            <CastGrid
              stats={stats}
              onActorClick={(name) => handlePersonClick(name, false)}
            />
          </div>

          <div className="flex items-center justify-between gap-4 px-5 py-4 rounded-2xl border border-white/[0.06] bg-white/[0.03]">
            <div>
              <p className="text-sm font-semibold text-white">
                Ready to share your year?
              </p>
              <p className="text-xs text-slate-500 mt-0.5">
                Turn your stats into a shareable card.
              </p>
            </div>
            <button
              onClick={() => {
                setShowShareModal(true);
                trackEvent("share_modal_opened");
              }}
              className="shrink-0 px-4 py-2 text-sm font-semibold rounded-xl transition-all hover:scale-105"
              style={{
                background: `linear-gradient(135deg, ${config.cssVars["--theme-accent"]}, ${config.cssVars["--theme-accent-2"]})`,
                color:
                  theme === "current" || theme === "vhs" ? "#fff" : "#181614",
              }}
            >
              Share your Wrapped →
            </button>
          </div>
        </div>
      ),
    },
    ...(stats.sinefil_meter?.score != null
      ? [
          {
            id: "cinema-scale",
            render: () => (
              <SectionContainer theme={theme}>
                <LazyCinemaScale
                  type={stats.sinefil_meter?.type || "Independent Cinephile"}
                  description={stats.sinefil_meter?.description}
                  score={stats.sinefil_meter?.score as number}
                  breakdown={stats.sinefil_meter?.breakdown}
                  topCountries={(stats.top_countries || []).map(
                    (c: { name: string }) => c.name,
                  )}
                  topLanguages={(stats.top_languages || []).map(
                    (l) => (l as typeof l & { name: string }).name,
                  )}
                  topGenres={(stats.top_genres || []).map(
                    (g: { name: string }) => g.name,
                  )}
                  topDirectors={(stats.top_directors || []).map(
                    (d: { name: string }) => d.name,
                  )}
                  favoriteDecade={stats.favorite_decade?.name}
                />
              </SectionContainer>
            ),
          },
        ]
      : []),
    {
      id: "rating-deviation",
      render: () => <RatingDeviation stats={stats} />,
    },
    {
      id: "reviews",
      render: () =>
        stats.review_analysis ? (
          <ReviewAnalysisSection stats={stats} />
        ) : (
          <div className="rounded-xl bg-white/5 p-8 text-center text-slate-400">
            <p className="text-sm">{t('results.noReviews')}</p>
          </div>
        ),
    },
    {
      id: "film-history",
      render: () => (
        <LazyFilmHistory
          data={decadeData}
          max={decadeMax}
          isMobile={isMobile}
          allFilms={stats.all_films ?? []}
          userAvg={stats.average_rating}
        />
      ),
    },
    {
      id: "ratings-bar",
      render: () => (
        <LazyRatingsBar
          data={ratingsArr}
          max={ratingMax}
          isMobile={isMobile}
          mostCommonRating={stats.most_common_rating}
          allFilms={stats.all_films ?? []}
          userAvg={stats.average_rating}
        />
      ),
    },
    ...(stats.rewatch_champions && stats.rewatch_champions.length > 0
      ? [
          {
            id: "rewatch-champions",
            render: () => (
              <RewatchChampions films={stats.rewatch_champions ?? []} />
            ),
          },
        ]
      : []),
    {
      id: "languages",
      render: () => (
        <LazyLanguages
          data={stats.top_languages ?? []}
          allFilms={stats.all_films ?? []}
        />
      ),
    },
    {
      id: "share-footer",
      render: () => (
        <div className="space-y-3 md:space-y-6">
          <div className="flex flex-col items-center my-8 gap-3">
            <button
              onClick={() => {
                setShowShareModal(true);
                trackEvent("share_modal_opened");
              }}
              className="flex items-center gap-2 px-8 py-4 font-semibold text-lg transition-all duration-200 shadow-lg hover:shadow-xl transform hover:scale-105 rounded-xl"
              style={{
                background: `linear-gradient(135deg, ${config.cssVars["--theme-accent"]}, ${config.cssVars["--theme-accent-2"]})`,
                color:
                  theme === "current" || theme === "vhs" ? "#fff" : "#181614",
              }}
            >
              <div
                className="w-6 h-6 rounded"
                style={{
                  background: theme === "current" ? "#fff" : "var(--theme-bg)",
                }}
              />
              Share Your Wrapped
            </button>
            <Link
              href={localizePath('/story', locale)}
              className="text-sm underline underline-offset-2 transition-colors hover:text-slate-200"
              style={{
                color:
                  theme === "current"
                    ? "#64748b"
                    : theme === "vhs"
                      ? "#d4955a"
                      : "#6a6a6a",
              }}
            >
              View as Story
            </Link>
          </div>

          <div className="mt-12 pt-8 border-t border-white/[0.06] text-center space-y-3">
            <p className="text-xs text-slate-400">
              Thanks to our beta testers: Mete, Mehlika Ceylin Aydoğan, Salih
              Emre Padır, Mert Efe Şentürk, Deniz and Ayberk for the
              invaluable feedback.
            </p>
            <p className="text-xs text-slate-400">
              Questions or feedback?{" "}
              <a
                href="mailto:semihmutlu220@gmail.com"
                className="underline underline-offset-2 hover:text-slate-200 transition-colors"
              >
                Get in touch
              </a>
            </p>
          </div>
        </div>
      ),
    },
  ];

  const sectionIds = slides
    .map((s) => s.id)
    .filter((id) => id !== "share-footer");

  return (
    <>
      <ScrollspyIndicator sectionIds={sectionIds} />
      <main className="relative z-10 px-3 md:px-8 py-4 md:py-6 max-w-7xl mx-auto space-y-3 md:space-y-6">
        {slides.map((s) => (
          <section
            key={s.id}
            id={s.id}
            className={`scroll-mt-24 ${s.id === "hero" ? "" : "[content-visibility:auto] [contain-intrinsic-size:auto_640px]"}`}
          >
            {s.id === "hero" ? s.render() : <DeferredSection>{s.render()}</DeferredSection>}
          </section>
        ))}
      </main>

      {shareCardData && (
      <ShareModal
        open={showShareModal}
        onClose={() => setShowShareModal(false)}
        orientation={orientation}
        setOrientation={setOrientation}
        cardProps={shareCardData}
        onDownloadSuccess={() => {
          if (!hasTriggeredFeedback) {
            setHasTriggeredFeedback(true);
            feedbackRef.current?.open();
          }
        }}
      />
      )}

      <FeedbackFab ref={feedbackRef} sessionId={sessionId} />

      <PersonFilmsModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        name={modalTitle}
        films={modalFilms}
        profileImageUrl={
          modalTitle === "All Watched Films"
            ? stats.profile_avatar_url
            : undefined
        }
        profilePath={undefined}
        genre={modalGenre}
      />
    </>
  );
}

/** Defer below-fold Results sections until they approach the viewport. */
function DeferredSection({ children }: { children: React.ReactNode }) {
  const { ref, shouldMount } = useLazyMount(0);
  return (
    <div ref={ref}>
      {shouldMount ? children : <div className="h-48 rounded-2xl bg-slate-800/30" />}
    </div>
  );
}

/** Small helper: theme-aware section wrapper */
function SectionContainer({
  theme,
  children,
}: {
  theme: string;
  children: React.ReactNode;
}) {
  if (theme === "current") return <>{children}</>;
  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        border:
          theme === "vhs"
            ? "1px solid rgba(212,149,90,0.2)"
            : "1px solid rgba(255,255,255,0.06)",
      }}
    >
      {children}
    </div>
  );
}

// ===================== LAZY LOADING COMPONENTS =====================

function LazyLanguages({
  data,
  allFilms,
}: {
  data: StatsData["top_languages"];
  allFilms: ResultFilm[];
}) {
  const { ref, shouldMount } = useLazyMount(100);
  return (
    <div ref={ref}>
      {shouldMount ? (
        <LanguagesLeaderboard data={data.slice(0, 7)} allFilms={allFilms} />
      ) : (
        <div className="h-64 bg-slate-800/30 rounded-2xl animate-pulse" />
      )}
    </div>
  );
}

function LazyFilmHistory({
  data,
  max,
  isMobile,
  allFilms,
  userAvg,
}: {
  data: DecadeDatum[];
  max: number;
  isMobile: boolean;
  allFilms: ResultFilm[];
  userAvg?: number | null;
}) {
  const { ref, shouldMount } = useLazyMount(150);
  return (
    <div ref={ref}>
      {shouldMount ? (
        <FilmHistory
          data={data}
          max={max}
          isMobile={isMobile}
          allFilms={allFilms}
          userAvg={userAvg}
        />
      ) : (
        <div className="h-48 bg-slate-800/30 rounded-2xl animate-pulse" />
      )}
    </div>
  );
}

function LazyRatingsBar({
  data,
  max,
  isMobile,
  mostCommonRating,
  allFilms,
  userAvg,
}: {
  data: RatingDatum[];
  max: number;
  isMobile: boolean;
  mostCommonRating?: number;
  allFilms: ResultFilm[];
  userAvg?: number | null;
}) {
  const { ref, shouldMount } = useLazyMount(200);
  return (
    <div ref={ref}>
      {shouldMount ? (
        <RatingsBar
          data={data}
          max={max}
          isMobile={isMobile}
          mostCommonRating={mostCommonRating}
          allFilms={allFilms}
          userAvg={userAvg}
        />
      ) : (
        <div className="h-32 bg-slate-800/30 rounded-2xl animate-pulse" />
      )}
    </div>
  );
}

function LazyCinemaScale({
  type,
  description,
  score,
  breakdown,
  topCountries,
  topLanguages,
  topGenres,
  topDirectors,
  favoriteDecade,
}: {
  type: string;
  description?: string;
  score: number;
  breakdown?: {
    geography: number;
    temporal: number;
    languages: number;
    volume: number;
    genres: number;
    directors: number;
  };
  topCountries?: string[];
  topLanguages?: string[];
  topGenres?: string[];
  topDirectors?: string[];
  favoriteDecade?: string;
}) {
  const { ref, shouldMount } = useLazyMount(300);
  return (
    <div ref={ref}>
      {shouldMount ? (
        <CinemaScale
          type={type}
          description={description}
          score={score}
          breakdown={breakdown}
          topCountries={topCountries}
          topLanguages={topLanguages}
          topGenres={topGenres}
          topDirectors={topDirectors}
          favoriteDecade={favoriteDecade}
        />
      ) : (
        <div className="h-32 bg-slate-800/30 rounded-2xl animate-pulse" />
      )}
    </div>
  );
}
