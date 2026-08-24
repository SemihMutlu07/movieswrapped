import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PersonFilmsModal from './PersonFilmsModal';
import LangModal from './LangModal';
import type { PersonFilm } from './types';

vi.mock('@/lib/analytics', () => ({
  getTmdbImageUrl: (path: string | null | undefined, size?: string) =>
    path ? `http://localhost:8000/t/p/${size || 'w342'}${path}` : null,
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
}));

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

function buildFilms(n: number): PersonFilm[] {
  return Array.from({ length: n }, (_, i) => ({
    title: `Film ${i + 1}`,
    year: String(2020 + (i % 5)),
    poster_path: `/poster${i + 1}.jpg`,
    user_rating: 3.5,
  }));
}

describe('PersonFilmsModal', () => {
  it('caps initial poster cards and expands on click', async () => {
    render(
      <PersonFilmsModal
        open
        onClose={() => {}}
        name="Director One"
        films={buildFilms(20)}
      />
    );
    const posters = await screen.findAllByAltText(/poster/i);
    expect(posters.length).toBe(9);
    await userEvent.click(screen.getByRole('button', { name: /Show more films/i }));
    expect(screen.getAllByAltText(/poster/i).length).toBe(18);
  });
});

describe('LangModal', () => {
  it('caps initial poster cards and expands on click', async () => {
    render(
      <LangModal
        open
        onClose={() => {}}
        language="fr"
        languageLabel="French"
        count={20}
        films={buildFilms(20).map((f) => ({ title: f.title, year: Number(f.year) || undefined, poster_path: f.poster_path, your_rating: f.user_rating ?? null }))}
      />
    );
    const posters = await screen.findAllByAltText(/poster/i);
    expect(posters.length).toBe(12);
    await userEvent.click(screen.getByRole('button', { name: /Show more films/i }));
    expect(screen.getAllByAltText(/poster/i).length).toBe(20);
  });
});
