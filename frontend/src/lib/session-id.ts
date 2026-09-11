export function ensureSessionId(): string {
  if (typeof window === 'undefined') return '';
  let id = sessionStorage.getItem('session_id');
  if (!id) {
    id = crypto?.randomUUID?.() || '00000000-0000-4000-8000-000000000000';
    sessionStorage.setItem('session_id', id);
  }
  return id;
}

export function getUsername(): string {
  return getUsernameWithSource().username;
}

export function getUsernameWithSource(): { username: string; source: 'username' | 'lb_username' | 'none' } {
  if (typeof window === 'undefined') return { username: '', source: 'none' };
  const username = sessionStorage.getItem('username');
  if (username) return { username, source: 'username' };

  const legacyUsername = sessionStorage.getItem('lb_username');
  if (legacyUsername) return { username: legacyUsername, source: 'lb_username' };

  return { username: '', source: 'none' };
}

export function setUsername(u: string) {
  if (typeof window !== 'undefined') {
    sessionStorage.setItem('username', u);
    // Keep lb_username for backward compatibility.
    sessionStorage.setItem('lb_username', u);
  }
}

export function setConsent(c: 'accept' | 'decline') {
  if (typeof window === 'undefined') return;

  localStorage.setItem('consent_decision', c);
  sessionStorage.setItem('consent_decision', c);
  window.dispatchEvent(new CustomEvent('analytics-consent-changed', { detail: c }));
}

/**
 * Analytics is on by default (no consent banner). Missing consent and a
 * previously stored "No thanks" (`decline`) both count as accept so an old
 * localStorage value cannot block PostHog forever.
 */
export function getConsent(): 'accept' | 'decline' | '' {
  return 'accept';
}
