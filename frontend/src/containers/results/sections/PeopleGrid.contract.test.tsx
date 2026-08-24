import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import DirectorsGrid from './DirectorsGrid';
import CastGrid from './CastGrid';
import type { StatsData } from './types';

vi.mock('@/lib/analytics', () => ({
  getProfileUrl: (path: string) => `https://image.tmdb.org/t/p/w342/${path.replace(/^\/+/, '')}`,
  getDirectTmdbImageUrl: (path: string, size = 'w342') => `https://image.tmdb.org/t/p/${size}/${path.replace(/^\/+/, '')}`,
  getTmdbImageUrl: () => null,
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
}));

function people(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    name: `Person ${i + 1}`,
    count: 10 - i,
    films: [{ title: `Film ${i + 1}`, year: '2020' }],
  }));
}

function stubCompact(compact: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: compact,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

describe('Directors and Cast item contracts', () => {
  it('renders exactly 4 directors on compact layouts', () => {
    stubCompact(true);
    render(<DirectorsGrid stats={{ top_directors: people(7) } as StatsData} />);
    expect(screen.getByText('Person 4')).toBeInTheDocument();
    expect(screen.queryByText('Person 5')).toBeNull();
  });

  it('renders 5 directors on expanded layouts', () => {
    stubCompact(false);
    render(<DirectorsGrid stats={{ top_directors: people(7) } as StatsData} />);
    expect(screen.getByText('Person 5')).toBeInTheDocument();
    expect(screen.queryByText('Person 6')).toBeNull();
  });

  it('renders exactly 4 cast members on compact layouts', () => {
    stubCompact(true);
    render(<CastGrid stats={{ top_actors: people(7) } as StatsData} />);
    expect(screen.getByText('Person 4')).toBeInTheDocument();
    expect(screen.queryByText('Person 5')).toBeNull();
  });
});
