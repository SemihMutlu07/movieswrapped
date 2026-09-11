import { describe, expect, it } from 'vitest';
import { normalizeError } from './errors';

describe('normalizeError network failures', () => {
  it('maps Failed to fetch to backend_unreachable', () => {
    expect(normalizeError(new TypeError('Failed to fetch')).reason).toBe('backend_unreachable');
  });

  it('maps wrapped handleApiError network messages to backend_unreachable', () => {
    const err = Object.assign(
      new Error('Network error: Unable to connect to file analysis. Failed to fetch.'),
      { code: 'backend_unreachable' },
    );
    expect(normalizeError(err).reason).toBe('backend_unreachable');
  });
});

describe('normalizeError desktop worker offline', () => {
  it('maps desktop_worker_offline from error code', () => {
    const err = Object.assign(new Error('temporary failure'), { code: 'desktop_worker_offline' });
    const normalized = normalizeError(err);

    expect(normalized.reason).toBe('desktop_worker_offline');
    expect(normalized.title).toBe('Desktop scraper offline');
  });

  it('maps desktop_worker_offline from backend message', () => {
    const normalized = normalizeError('The desktop scraper is offline right now.');

    expect(normalized.reason).toBe('desktop_worker_offline');
  });

  it('maps queue_full from error code and ZIP-first copy', () => {
    const err = Object.assign(new Error('The analysis queue is full. Please try again later.'), { code: 'queue_full' });
    const normalized = normalizeError(err);

    expect(normalized.reason).toBe('queue_full');
    expect(normalized.action).toMatch(/ZIP/i);
  });
});
