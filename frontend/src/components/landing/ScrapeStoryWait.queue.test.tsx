import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/i18n/I18nProvider';
import ErrorBanner from '@/components/ErrorBanner';
import ScrapeStoryWait from '@/components/landing/ScrapeStoryWait';
import { normalizeError } from '@/lib/errors';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

describe('live scan queue and offline UX', () => {
  it('shows queue position and ETA', () => {
    render(
      <I18nProvider locale="en">
        <ScrapeStoryWait username="alice" queued queuePosition={3} etaSeconds={45} />
      </I18nProvider>,
    );
    const meta = screen.getByTestId('wait-queue-meta');
    expect(meta).toHaveTextContent(/position 3/i);
    expect(meta).toHaveTextContent(/45s/i);
  });

  it('offers bookmarklet and ZIP when live scan is offline', () => {
    const error = normalizeError(Object.assign(new Error('Live scan is offline right now.'), { code: 'desktop_worker_offline' }));
    render(
      <I18nProvider locale="en">
        <ErrorBanner error={error} onDismiss={() => {}} onUpload={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByRole('link', { name: /bookmarklet/i })).toHaveAttribute('href', '/en/import');
    expect(screen.getByRole('button', { name: /upload export zip/i })).toBeInTheDocument();
  });
});
