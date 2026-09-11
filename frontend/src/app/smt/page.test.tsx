import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}));

import SmtPage from './page';
import { loadSmtFixture } from '@/lib/smt-loader';

describe('/smt dev loader', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.restoreAllMocks();
  });

  it('seeds the real results storage contract from the fixture endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        username: 'semihmutsuz',
        summary: { details: { total_films: 692 } },
      }),
    }));
    const navigate = vi.fn();
    await loadSmtFixture(fetch, sessionStorage, navigate);

    expect(sessionStorage.getItem('letterboxdStats')).toBe('{"total_films":692}');
    expect(sessionStorage.getItem('username')).toBe('semihmutsuz');
    expect(sessionStorage.getItem('lb_username')).toBe('semihmutsuz');
    // Locale-aware redirect: /smt runs outside [locale], so the loader
    // resolves the stored/system locale and routes to /<locale>/story.
    expect(navigate).toHaveBeenCalledWith('/en/story?u=semihmutsuz');
    expect(fetch).toHaveBeenCalledWith('/demo/smt-fixture.json', { cache: 'no-store' });
  });

  it('can still seed the results dossier when asked', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        username: 'semihmutsuz',
        summary: { details: { total_films: 692 } },
      }),
    }));
    const navigate = vi.fn();
    await loadSmtFixture(fetch, sessionStorage, navigate, 'en', 'results');
    expect(navigate).toHaveBeenCalledWith('/en/results?u=semihmutsuz');
  });

  it('shows a readable error without redirecting when fixture loading fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Fixture missing' }),
    }));

    render(<SmtPage />);

    expect(await screen.findByText('Fixture missing')).toBeInTheDocument();
    expect(sessionStorage.getItem('letterboxdStats')).toBeNull();
  });
});
