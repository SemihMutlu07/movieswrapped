import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

const posthogMocks = vi.hoisted(() => ({
  captureEvent: vi.fn(),
  initPostHog: vi.fn(),
  flushQueue: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/results',
  useSearchParams: () => new URLSearchParams('source=test'),
}));

vi.mock('@/lib/posthog', () => posthogMocks);

import PageViewTracker from './PageViewTracker';

describe('PageViewTracker consent gate', () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('keeps analytics off when no explicit consent decision exists', () => {
    render(<PageViewTracker />);

    expect(localStorage.getItem('consent_decision')).toBeNull();
    expect(posthogMocks.initPostHog).not.toHaveBeenCalled();
    expect(posthogMocks.flushQueue).not.toHaveBeenCalled();
    expect(posthogMocks.captureEvent).not.toHaveBeenCalled();
  });

  it('initializes, flushes, and captures after explicit persisted acceptance', () => {
    localStorage.setItem('consent_decision', 'accept');

    render(<PageViewTracker />);

    expect(posthogMocks.initPostHog).toHaveBeenCalledOnce();
    expect(posthogMocks.flushQueue).toHaveBeenCalledOnce();
    expect(posthogMocks.captureEvent).toHaveBeenCalledWith('$pageview', {
      path: '/results',
      search: 'source=test',
    });
  });

  it('keeps analytics off after an explicit decline', () => {
    localStorage.setItem('consent_decision', 'decline');

    render(<PageViewTracker />);

    expect(posthogMocks.initPostHog).not.toHaveBeenCalled();
    expect(posthogMocks.flushQueue).not.toHaveBeenCalled();
    expect(posthogMocks.captureEvent).not.toHaveBeenCalled();
  });
});
