import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PersonCard } from './DirectorsGrid';

vi.mock('@/lib/analytics', () => ({
  getProfileUrl: (path: string) => `https://image.tmdb.org/t/p/w342/${path.replace(/^\/+/, '')}`,
  getDirectTmdbImageUrl: (path: string, size = 'w342') => `https://image.tmdb.org/t/p/${size}/${path.replace(/^\/+/, '')}`,
  trackEvent: vi.fn(),
  trackConsentedEvent: vi.fn(),
}));

describe('PersonCard', () => {
  it('keeps film counts visible and retries when the profile path changes', () => {
    const { rerender } = render(
      <PersonCard name="Director" profilePath="/broken.jpg" primaryStat="7 films" />,
    );
    expect(screen.getByText('7 films')).not.toHaveClass('opacity-0');

    const broken = screen.getByAltText('Director');
    fireEvent.error(broken);
    fireEvent.error(broken);

    rerender(<PersonCard name="Director" profilePath="/working.jpg" primaryStat="7 films" />);

    expect(screen.getByAltText('Director')).toHaveAttribute(
      'src',
      'https://image.tmdb.org/t/p/w342/working.jpg',
    );
  });
});
