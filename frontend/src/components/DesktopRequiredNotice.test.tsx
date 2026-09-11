import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const analyticsMocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
}));

vi.mock('@/lib/analytics', () => analyticsMocks);

import { DesktopRequiredNotice } from './DesktopRequiredNotice';
import { I18nProvider } from '@/i18n/I18nProvider';

describe('DesktopRequiredNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      writable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      writable: true,
      value: undefined,
    });
  });

  it('explains the desktop wrap without saying computer, then copies the page link', async () => {
    const user = userEvent.setup();
    render(
      <I18nProvider locale="en">
        <DesktopRequiredNotice surface="landing" />
      </I18nProvider>,
    );

    const notice = screen.getByTestId('desktop-required-landing');
    expect(notice).toHaveTextContent(/desktop/i);
    expect(notice.textContent).not.toMatch(/computer/i);
    expect(screen.queryByRole('button', { name: /share link/i })).not.toBeInTheDocument();
    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith('desktop_required_shown', { surface: 'landing' });

    await user.click(screen.getByRole('button', { name: /copy this page/i }));
    expect(await screen.findByRole('button', { name: /link copied/i })).toBeInTheDocument();
    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith('desktop_required_link_copied', { surface: 'landing' });
  });

  it('shares natively when available and keeps copy as fallback', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, 'share', {
      configurable: true,
      writable: true,
      value: share,
    });
    const user = userEvent.setup();
    render(
      <I18nProvider locale="en">
        <DesktopRequiredNotice surface="story" />
      </I18nProvider>,
    );

    expect(screen.getByTestId('desktop-required-story')).toHaveTextContent(/home link/i);
    await user.click(screen.getByRole('button', { name: /share link/i }));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Movies Wrapped',
        url: expect.stringMatching(/\/en$/),
      }),
    );
    expect(analyticsMocks.trackEvent).toHaveBeenCalledWith('desktop_required_shared', { surface: 'story' });
    expect(screen.getByRole('button', { name: /copy the home link/i })).toBeInTheDocument();
  });
});
