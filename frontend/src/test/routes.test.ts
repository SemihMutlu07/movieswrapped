import { describe, expect, it } from 'vitest';

import { cleanRouteUsername, isValidRouteUsername, resultPath, storyPath } from '@/lib/routes';

describe('route helpers', () => {
  it('normalizes and validates usernames', () => {
    expect(cleanRouteUsername('@SemihMutsuz')).toBe('semihmutsuz');
    expect(isValidRouteUsername('semihmutsuz')).toBe(true);
    expect(isValidRouteUsername('semih-mutsuz')).toBe(false);
  });

  it('builds canonical result routes', () => {
    expect(resultPath('semihmutsuz')).toBe('/results?u=semihmutsuz');
    expect(resultPath('semihmutsuz', 'tr')).toBe('/tr/results?u=semihmutsuz');
    expect(resultPath('bad-name')).toBe('/results');
  });

  it('builds canonical story routes', () => {
    expect(storyPath('semihmutsuz')).toBe('/story?u=semihmutsuz');
    expect(storyPath('semihmutsuz', 'en')).toBe('/en/story?u=semihmutsuz');
    expect(storyPath('bad-name')).toBe('/story');
  });
});
