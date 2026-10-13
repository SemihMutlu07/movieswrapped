'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ChevronDown } from 'lucide-react';

import { LandingContributors, LandingFeedback } from '@/components/landing/LandingExtras';
import { LandingUpload } from '@/components/landing/LandingUpload';
import UsernameScrapeSection from '@/components/landing/UsernameScrapeSection';
import type { LandingViewProps } from '@/components/landing/landingTypes';
import { SAMPLE_POSTERS, SAMPLE_SHARE_CARD } from '@/components/landing/sampleWrap';
import { ShareVariantRenderer } from '@/components/share/registry';
import type { ShareCardData } from '@/components/share/types';
import { normalizeShareCardData } from '@/components/share/viewModel';
import { useShareLabels } from '@/components/share/useShareLabels';
import {
  Brand,
  GenresLine,
  PersonPanel,
  Username,
} from '@/components/share/variants/shared/LayoutPrimitives';
import { FAQ_ITEMS } from '@/i18n/faq';
import { useI18n } from '@/i18n/I18nProvider';
import { needsZipFallback } from '@/lib/errors';

const DISPLAY = {
  fontFamily: 'var(--font-fraunces), "Iowan Old Style", Palatino, Georgia, serif',
} as const;

function titleLines(title: string) {
  const splitAt = title.indexOf(' ');
  if (splitAt === -1) return title;
  return (
    <>
      {title.slice(0, splitAt)}
      <br className="sm:hidden" />
      {' '}
      {title.slice(splitAt + 1)}
    </>
  );
}

function PosterCollage() {
  const { t } = useI18n();
  return (
    <section className="relative overflow-hidden">
      <ul className="grid min-h-[220px] max-h-[300px] grid-cols-6 gap-px overflow-hidden bg-[#14181c] sm:min-h-0 sm:max-h-[36vh] sm:grid-cols-8 lg:grid-cols-12">
        {SAMPLE_POSTERS.map((poster, index) => (
          <li key={poster.src} className="min-w-0">
            <img
              src={poster.src}
              alt=""
              width={80}
              height={120}
              loading={index < 12 ? 'eager' : 'lazy'}
              decoding="async"
              className="aspect-[2/3] h-full w-full bg-[#2c3440] object-cover"
            />
          </li>
        ))}
      </ul>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-44 bg-[linear-gradient(to_top,#14181c_0%,#14181c_55%,rgb(20_24_28/0)_100%)] sm:hidden"
      />
      <div className="pointer-events-none absolute inset-x-4 bottom-4 sm:inset-x-6 sm:bottom-6">
        <h1
          className="inline-block max-w-full bg-[#14181c] px-3 py-2.5 text-[clamp(2.15rem,10.4vw,3.35rem)] font-black italic leading-[0.95] tracking-[-0.03em] text-white shadow-[0_0_0_12px_#14181c] sm:max-w-[11ch] sm:px-3 sm:py-2 sm:text-[clamp(2.6rem,min(11vw,16svh),7.25rem)] sm:leading-[0.86] sm:tracking-[-0.04em] sm:shadow-none"
          style={DISPLAY}
        >
          {titleLines(t('landing.hero.title'))}
        </h1>
      </div>
    </section>
  );
}

const CARD_FACE = "'Avenir Next', Manrope, 'Segoe UI', system-ui, sans-serif";

function PhoneMetric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: ReactNode;
  valueClassName: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl bg-black/30 px-2 py-2.5">
      <p className="text-[10px] font-bold uppercase leading-tight tracking-normal text-neutral-400">{label}</p>
      <p className={`mt-1.5 font-black leading-none tabular-nums ${valueClassName}`}>{value}</p>
    </div>
  );
}

function PhoneSampleCard({ data }: { data: ShareCardData }) {
  const labels = useShareLabels();
  const metricValue = 'text-base min-[380px]:text-xl';
  const metricLabel = 'text-[10px] font-bold uppercase leading-tight tracking-normal text-neutral-400';

  return (
    <div
      className="relative overflow-hidden bg-[#0d0d0d] p-4 text-white sm:hidden"
      style={{ fontFamily: CARD_FACE }}
    >
      <div className="absolute inset-x-0 top-0 h-1 bg-[#ff8000]" />
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-neutral-400">
            {data.year} · {labels.yearInFilm}
          </p>
          <p className="mt-1 text-xl font-black leading-tight">{labels.yourWrapped}</p>
        </div>
        <Username username={data.username} className="max-w-[42%] shrink-0 text-right text-xs text-neutral-400" />
      </header>

      <p className="mt-4 whitespace-nowrap text-[11px] font-bold uppercase tracking-[0.14em] text-orange-400">{labels.youWatched}</p>
      <div className="mt-1 flex flex-wrap items-end gap-x-2 gap-y-1">
        <strong className="text-[4.25rem] font-black leading-[0.8] tabular-nums text-white">
          {data.watchedFilms}
        </strong>
        <span className="max-w-full pb-1 text-base font-bold leading-tight text-neutral-300">{labels.filmsSoFar}</span>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2">
        <PhoneMetric label={labels.writtenReviews} value={data.writtenReviews} valueClassName={`${metricValue} text-orange-300`} />
        <PhoneMetric label={labels.daysWatching} value={data.spentDays} valueClassName={`${metricValue} text-emerald-300`} />
        <PhoneMetric label={labels.scale} value={`${Math.round(data.cinemaScale)}/100`} valueClassName={`${metricValue} text-orange-300`} />
      </div>

      <div className="mt-4 grid grid-cols-2 items-end gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase leading-tight tracking-normal text-neutral-400">{labels.peakDecade}</p>
          <p className="mt-1 text-lg font-black leading-none">{data.peakDecade}</p>
          <p className="mt-1 text-xs text-neutral-400">{labels.filmsCount(data.peakDecadeCount)}</p>
        </div>
        <div className="min-w-0 text-right">
          <p className={metricLabel}>{labels.topGenres}</p>
          <GenresLine genres={data.genres} className="mt-1 text-xs font-semibold leading-snug text-neutral-300" />
        </div>
      </div>

      <div className="mt-4 grid gap-2">
        <PersonPanel
          person={data.onScreenCrush}
          label={labels.onScreenCrush}
          countLabel={labels.moviesTogether}
          unknownName={labels.unknown}
          className="rounded-2xl border border-orange-400/20 bg-orange-400/[0.08] p-3"
          mediaClassName="w-14 rounded-xl border border-white/10 bg-zinc-900"
          labelClassName={metricLabel}
          nameClassName="text-base font-black leading-tight text-white"
          countClassName="text-xs text-neutral-300"
        />
        <PersonPanel
          person={data.favoriteDirector}
          label={labels.favoriteDirector}
          countLabel={labels.moviesDirected}
          unknownName={labels.directorUnavailable}
          className="rounded-2xl border border-white/10 bg-white/[0.04] p-3"
          mediaClassName="w-14 rounded-xl border border-white/10 bg-zinc-900"
          labelClassName={metricLabel}
          nameClassName="text-base font-black leading-tight text-white"
          countClassName="text-xs text-neutral-300"
        />
      </div>
      <Brand className="mt-4 block text-[11px] text-neutral-500" />
    </div>
  );
}

function ScaledSampleCard() {
  const frameRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const update = () => setWidth(el.getBoundingClientRect().width);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scale = width > 0 ? width / 1200 : 1;

  return (
    <div ref={frameRef} className="hidden w-full sm:block">
      <div className="relative overflow-hidden" style={{ height: 675 * scale }}>
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width: 1200, height: 675, transform: `scale(${scale})` }}
        >
          <ShareVariantRenderer
            variant="default"
            orientation="horizontal"
            data={SAMPLE_SHARE_CARD}
          />
        </div>
      </div>
    </div>
  );
}

function SampleShareCard() {
  const { t } = useI18n();
  const data = normalizeShareCardData(SAMPLE_SHARE_CARD);

  return (
    <section aria-label={t('landing.preview.kicker')} className="w-full min-w-0">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#678] sm:tracking-[0.22em]">
        <span>{t('landing.preview.kicker')}</span>
        <span className="font-medium normal-case tracking-normal text-[#9ab]">
          {t('landing.preview.credit')}
        </span>
      </p>
      <div data-testid="landing-sample-share-card" className="mt-4 min-w-0">
        <PhoneSampleCard data={data} />
        <ScaledSampleCard />
      </div>
    </section>
  );
}

export default function WrappedLanding({ view }: { view: LandingViewProps }) {
  const { t } = useI18n();
  const zipRequired = Boolean(
    view.translatedError && needsZipFallback(view.translatedError.reason),
  );
  const [showZip, setShowZip] = useState(false);
  const zipOpen = showZip || zipRequired;

  return (
    <div className="min-h-screen overflow-x-clip bg-[#14181c] text-white" data-landing-variant="wrapped">
      <PosterCollage />

      <div className="mx-auto min-w-0 max-w-xl px-4 pb-16 pt-5 sm:px-6 sm:pb-24 sm:pt-4">
        <p className="max-w-[34rem] text-pretty text-[15px] leading-relaxed text-white sm:text-lg sm:leading-snug">
          {t('landing.hero.promise')}
        </p>

        <div className="mt-5">
          {view.showUsernameScrape ? <UsernameScrapeSection view={view} /> : null}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="button"
              className="text-sm text-[#9ab] underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e054]/50"
              onClick={() => setShowZip(true)}
            >
              {t('landing.upload.zipInstead')}
            </button>
            <Link
              href="/import"
              className="text-sm text-[#9ab] underline-offset-4 hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00e054]/50"
            >
              {t('landing.username.bookmarklet')}
            </Link>
          </div>
        </div>

        <div className="mt-4 space-y-4">
          <LandingFeedback view={view} />
          <div className={zipOpen ? undefined : 'hidden'}>
            <LandingUpload view={view} tone="wrapped" compact hintClassName="sr-only" />
          </div>
        </div>

        <div className="mt-8 sm:mt-6">
          <SampleShareCard />
        </div>

        <section aria-label={t('landing.faq.label')} className="mt-14 sm:mt-20">
          <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-[#678]">{t('landing.faq.label')}</h2>
          <div className="mt-4 divide-y divide-[#303840] border-y border-[#303840]">
            {FAQ_ITEMS.map(({ q, a }) => (
              <details key={q} className="group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left text-sm font-medium text-white [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 text-pretty">{t(q)}</span>
                  <ChevronDown className="h-4 w-4 shrink-0 text-[#678] transition-transform group-open:rotate-180" />
                </summary>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#9ab]">{t(a)}</p>
              </details>
            ))}
          </div>
        </section>

        <LandingContributors className="mt-12 max-w-2xl space-y-1.5 text-[#678] sm:mt-16" />
      </div>
    </div>
  );
}
