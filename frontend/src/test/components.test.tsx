import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nProvider } from '@/i18n/I18nProvider';

vi.mock('@/lib/analytics', () => ({
  getPosterUrl: (path?: string | null) => path ? `https://image.tmdb.org/t/p/w780/${path.replace(/^\/+/, '')}` : null,
  getProfileUrl: (path?: string | null) => path ? `https://image.tmdb.org/t/p/w342/${path.replace(/^\/+/, '')}` : null,
  getTmdbImageUrl: (path: string) => path,
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
}));

// ---- OrientationToggle -------------------------------------------------------

import OrientationToggle from '@/components/share/OrientationToggle';

describe('OrientationToggle', () => {
  it('renders both orientation buttons', () => {
    render(<OrientationToggle orientation="horizontal" onChange={() => {}} />);
    expect(screen.getByText('Horizontal')).toBeInTheDocument();
    expect(screen.getByText('Vertical')).toBeInTheDocument();
  });

  it('calls onChange with "vertical" when Vertical is clicked', async () => {
    const onChange = vi.fn();
    render(<OrientationToggle orientation="horizontal" onChange={onChange} />);
    await userEvent.click(screen.getByText('Vertical'));
    expect(onChange).toHaveBeenCalledWith('vertical');
  });

  it('calls onChange with "horizontal" when Horizontal is clicked', async () => {
    const onChange = vi.fn();
    render(<OrientationToggle orientation="vertical" onChange={onChange} />);
    await userEvent.click(screen.getByText('Horizontal'));
    expect(onChange).toHaveBeenCalledWith('horizontal');
  });

  it('applies active style to the selected orientation', () => {
    const { rerender } = render(
      <OrientationToggle orientation="horizontal" onChange={() => {}} />,
    );
    const horizontalBtn = screen.getByText('Horizontal').closest('button')!;
    expect(horizontalBtn.className).toMatch(/bg-gradient-to-r/);

    rerender(<OrientationToggle orientation="vertical" onChange={() => {}} />);
    const verticalBtn = screen.getByText('Vertical').closest('button')!;
    expect(verticalBtn.className).toMatch(/bg-gradient-to-r/);
  });
});

// ---- UploadZone --------------------------------------------------------------

import UploadZone from '@/components/landing/UploadZone';

describe('UploadZone', () => {
  it('renders upload prompt text', () => {
    render(<I18nProvider locale="en"><UploadZone onFiles={() => {}} /></I18nProvider>);
    expect(screen.getByText(/Begin Your Cinema Reveal/i)).toBeInTheDocument();
    expect(screen.getByText(/Drag a ZIP, CSV files/i)).toBeInTheDocument();
  });

  it('has an accessible region label', () => {
    render(<I18nProvider locale="en"><UploadZone onFiles={() => {}} /></I18nProvider>);
    expect(screen.getByRole('region', { name: /upload your letterboxd data/i })).toBeInTheDocument();
  });

  it('calls onFiles with dropped files', async () => {
    const onFiles = vi.fn();
    render(<I18nProvider locale="en"><UploadZone onFiles={onFiles} /></I18nProvider>);
    const dropZone = screen.getByTestId('upload-drop-zone');

    const file = new File(['content'], 'export.zip', { type: 'application/zip' });
    const dataTransfer = { files: [file] as unknown as FileList };

    fireEvent.drop(dropZone, { dataTransfer });
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith(dataTransfer.files));
  });

  it('has a hidden file input that accepts zip and csv', () => {
    render(<I18nProvider locale="en"><UploadZone onFiles={() => {}} /></I18nProvider>);
    const input = document.getElementById('upload-zone-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.accept).toContain('.zip');
    expect(input.accept).toContain('.csv');
  });
});

// ---- RatingDeviation ---------------------------------------------------------

import RatingDeviation from '@/containers/results/sections/RatingDeviation';
import type { StatsData } from '@/containers/results/sections/types';
import HeroStats from '@/containers/results/HeroStats';

const ratingDeviationStats: StatsData = {
  total_films: 6,
  average_rating: 3.2,
  days_watched: 1,
  average_runtime: 100,
  top_genres: [],
  top_directors: [],
  top_actors: [],
  top_countries: [],
  top_languages: [],
  decades: [],
  rating_distribution: {},
  total_rated_films: 6,
  rated_films: [
    { title: 'A Very Long Film Title That Should Not Break The Mobile Card', year: 2024, your_rating: 5, average_rating: 3.2, poster_path: '/a.jpg' },
    { title: 'High Two', year: 2023, your_rating: 4.5, average_rating: 3.2, poster_path: '/b.jpg' },
    { title: 'High Three', year: 2022, your_rating: 4, average_rating: 3.2, poster_path: '/c.jpg' },
    { title: 'Low One', year: 2021, your_rating: 2, average_rating: 3.2, poster_path: '/d.jpg' },
    { title: 'Low Two', year: 2020, your_rating: 1.5, average_rating: 3.2, poster_path: '/e.jpg' },
    { title: 'Low Three', year: 2019, your_rating: 1, average_rating: 3.2, poster_path: '/f.jpg' },
  ],
};

describe('RatingDeviation', () => {
  it('uses a two-column grid and clipped captions for mobile outlier cards', () => {
    const { container } = render(<I18nProvider locale="en"><RatingDeviation stats={ratingDeviationStats} /></I18nProvider>);

    const grid = container.querySelector('.grid');
    expect(grid?.className).toContain('grid-cols-2');
    expect(grid?.className).not.toContain('grid-cols-1');

    const caption = screen.getByText(/5\.0 vs community 3\.2/i);
    expect(caption.className).toContain('whitespace-nowrap');
    expect(caption.className).toContain('text-ellipsis');
  });
});

describe('HeroStats', () => {
  it('renders watched runtime as real hours, not rounded days', () => {
    render(
      <HeroStats
        totalFilms={494}
        avgRating={3.8}
        hoursWatched={1228.4}
        topGenre="Drama"
        timePct="14%"
        favoriteDirector={{ name: 'Agnes Varda', count: 12 }}
        favoriteDecade={{ name: '2010s', count: 88 }}
      />,
    );

    expect(screen.getByText('1,228h')).toBeInTheDocument();
    expect(screen.getByText('Hours watched')).toBeInTheDocument();
  });
});
