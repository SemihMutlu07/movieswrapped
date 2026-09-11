import type { Locale } from '@/i18n/locales';
import { localizePath } from '@/i18n/routing';

export type DesktopRequiredSurface = 'landing' | 'story' | 'results';

/**
 * Phone → desktop handoff. Story/results URLs are useless on another device
 * (stats live in sessionStorage), so those surfaces copy the locale home page.
 */
export function desktopHandoffUrl(input: {
  surface: DesktopRequiredSurface;
  href: string;
  origin: string;
  locale: Locale;
}): string {
  if (input.surface === 'landing') return input.href;
  return `${input.origin}${localizePath('/', input.locale)}`;
}
