'use client';

import { useCallback, useEffect, useState } from 'react';

import { useI18n } from '@/i18n/I18nProvider';
import { desktopHandoffUrl, type DesktopRequiredSurface } from '@/lib/desktopHandoff';
import { trackEvent } from '@/lib/analytics';

export type { DesktopRequiredSurface };

const primaryBtnClass =
  'inline-flex min-h-11 w-full items-center justify-center rounded-full bg-orange-400 px-5 font-mono text-[11px] font-black uppercase tracking-[0.14em] text-[#1a1a1a] transition-colors hover:bg-orange-300';
const secondaryBtnClass =
  'inline-flex min-h-11 w-full items-center justify-center rounded-full border border-white/8 px-5 font-mono text-[11px] font-black uppercase tracking-[0.14em] text-white/90 transition-colors hover:border-orange-400';

function fallbackCopy(url: string): boolean {
  const field = document.createElement('textarea');
  field.value = url;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.left = '-9999px';
  document.body.appendChild(field);
  field.select();
  const ok = document.execCommand('copy');
  document.body.removeChild(field);
  return ok;
}

function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && (error as { name: string }).name === 'AbortError';
}

export function DesktopRequiredNotice({ surface }: { surface: DesktopRequiredSurface }) {
  const { t, locale } = useI18n();
  const [copied, setCopied] = useState(false);
  const [canShare, setCanShare] = useState(false);

  useEffect(() => {
    setCanShare(typeof navigator.share === 'function');
  }, []);

  useEffect(() => {
    trackEvent('desktop_required_shown', { surface });
  }, [surface]);

  const resolveUrl = useCallback(
    () =>
      desktopHandoffUrl({
        surface,
        href: window.location.href,
        origin: window.location.origin,
        locale,
      }),
    [locale, surface],
  );

  const copyLink = useCallback(async () => {
    const url = resolveUrl();
    let ok = false;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        ok = true;
      }
    } catch {
      ok = false;
    }
    if (!ok) ok = fallbackCopy(url);
    if (!ok) return;
    setCopied(true);
    trackEvent('desktop_required_link_copied', { surface });
  }, [resolveUrl, surface]);

  const shareLink = useCallback(async () => {
    const url = resolveUrl();
    try {
      await navigator.share({ title: 'Movies Wrapped', url });
      trackEvent('desktop_required_shared', { surface });
    } catch (error) {
      if (isAbortError(error)) return;
      await copyLink();
    }
  }, [copyLink, resolveUrl, surface]);

  const titleKey = surface === 'landing' ? 'desktopRequired.landing.title' : 'desktopRequired.story.title';
  const bodyKey = surface === 'landing' ? 'desktopRequired.landing.body' : 'desktopRequired.story.body';
  const copyLabel = copied
    ? t('desktopRequired.copied')
    : t(surface === 'landing' ? 'desktopRequired.copy' : 'desktopRequired.copyHome');

  return (
    <aside
      role="note"
      data-testid={`desktop-required-${surface}`}
      data-desktop-required={surface}
      className="rounded-2xl border border-white/8 bg-[#1a1a1a] p-5 text-center sm:p-6"
    >
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-orange-400">
        {t('landing.desktopHint')}
      </p>
      <h2 className="mt-3 text-lg font-bold tracking-tight text-white">{t(titleKey)}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-white/65">{t(bodyKey)}</p>
      <div className="mx-auto mt-5 flex w-full max-w-xs flex-col gap-2">
        {canShare ? (
          <button type="button" onClick={() => void shareLink()} className={primaryBtnClass}>
            {t('desktopRequired.share')}
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void copyLink()}
          className={canShare ? secondaryBtnClass : primaryBtnClass}
        >
          {copyLabel}
        </button>
      </div>
    </aside>
  );
}
