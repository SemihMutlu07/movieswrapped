import type { Locale } from '@/i18n/locales';
import { localizePath } from '@/i18n/routing';

const USERNAME_RE = /^[a-z0-9_]+$/;

function withLocale(path: string, locale?: Locale): string {
  return locale ? localizePath(path, locale) : path;
}

export function cleanRouteUsername(value: string | null | undefined): string {
  try {
    return decodeURIComponent(value || '').trim().replace(/^@/, '').toLowerCase();
  } catch {
    return '';
  }
}

export function isValidRouteUsername(value: string | null | undefined): value is string {
  return !!value && USERNAME_RE.test(value);
}

export function resultPath(username: string | null | undefined, locale?: Locale): string {
  const clean = cleanRouteUsername(username);
  return withLocale(isValidRouteUsername(clean) ? `/results?u=${encodeURIComponent(clean)}` : '/results', locale);
}

export function storyPath(username: string | null | undefined, locale?: Locale): string {
  const clean = cleanRouteUsername(username);
  return withLocale(isValidRouteUsername(clean) ? `/story?u=${encodeURIComponent(clean)}` : '/story', locale);
}

export function readResultUsernameFromLocation(): string {
  if (typeof window === 'undefined') return '';
  const match = window.location.pathname.match(/^\/(?:en\/|tr\/)?results\/([^/?#]+)/);
  const pathUsername = cleanRouteUsername(match?.[1]);
  if (isValidRouteUsername(pathUsername)) return pathUsername;

  const params = new URLSearchParams(window.location.search);
  const queryUsername = cleanRouteUsername(params.get('u') || params.get('username'));
  return isValidRouteUsername(queryUsername) ? queryUsername : '';
}
