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

describe('PageViewTracker default-on analytics', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('initializes, flushes, and captures on mount', () => {
    render(<PageViewTracker />);

    expect(posthogMocks.initPostHog).toHaveBeenCalledOnce();
    expect(posthogMocks.flushQueue).toHaveBeenCalledOnce();
    expect(posthogMocks.captureEvent).toHaveBeenCalledWith('$pageview', {
      path: '/results',
      search: 'source=test',
    });
  });
});
