import { beforeEach, describe, expect, it, vi } from 'vitest';

const posthogMock = vi.hoisted(() => ({
  __loaded: false,
  init: vi.fn(),
  capture: vi.fn(),
  captureException: vi.fn(),
  onFeatureFlags: vi.fn(),
  getFeatureFlag: vi.fn(),
}));

vi.mock('posthog-js', () => ({ default: posthogMock }));

describe('PostHog default-on analytics', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'test-key');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', 'https://posthog.example.test');
    sessionStorage.clear();
    posthogMock.__loaded = false;
  });

  it('initializes and captures without a stored consent decision', async () => {
    const { getConsent } = await import('./session-id');
    const { captureEvent, initPostHog } = await import('./posthog');

    expect(getConsent()).toBe('accept');
    initPostHog();
    expect(posthogMock.init).toHaveBeenCalledWith(
      'test-key',
      expect.objectContaining({
        session_recording: { maskAllInputs: true },
      }),
    );

    posthogMock.__loaded = true;
    captureEvent('new_event', { source: 'test' });

    expect(posthogMock.capture).toHaveBeenCalledWith('new_event', { source: 'test' });
  });

  it('strips direct identifiers before capture', async () => {
    posthogMock.__loaded = true;
    const { captureEvent } = await import('./posthog');

    captureEvent('analyze_started', {
      username: 'example-user',
      letterboxd_username: 'example-user',
      email: 'example@example.com',
      method: 'scrape',
    });

    expect(posthogMock.capture).toHaveBeenCalledWith('analyze_started', {
      method: 'scrape',
    });
  });

  it('deduplicates repeated analysis starts until a terminal event', async () => {
    posthogMock.__loaded = true;
    const { captureEvent } = await import('./posthog');

    captureEvent('analyze_started', { method: 'upload', fileCount: 2 });
    captureEvent('analyze_started', { method: 'upload', fileCount: 2, hasZip: true });

    expect(posthogMock.capture).toHaveBeenCalledTimes(1);
    expect(posthogMock.capture).toHaveBeenLastCalledWith('analyze_started', {
      method: 'upload',
      fileCount: 2,
    });

    captureEvent('analyze_failed', { method: 'upload', reason: 'test_failure' });
    captureEvent('analyze_started', { method: 'upload', fileCount: 2 });

    expect(posthogMock.capture).toHaveBeenCalledTimes(3);
    expect(posthogMock.capture).toHaveBeenLastCalledWith('analyze_started', {
      method: 'upload',
      fileCount: 2,
    });
  });

  it('queues only while PostHog is loading', async () => {
    const { captureEvent } = await import('./posthog');

    captureEvent('accepted_loading_event', { username: 'do-not-queue', method: 'upload' });

    expect(posthogMock.capture).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('ph_event_queue') || '[]')).toEqual([
      expect.objectContaining({
        event: 'accepted_loading_event',
        properties: { method: 'upload' },
      }),
    ]);
  });
});
