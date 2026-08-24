import { describe, expect, it } from 'vitest';

import { isStoryPath } from './storyChrome';

describe('isStoryPath', () => {
  it('matches locale and legacy story routes', () => {
    expect(isStoryPath('/story')).toBe(true);
    expect(isStoryPath('/en/story')).toBe(true);
    expect(isStoryPath('/tr/story/')).toBe(true);
    expect(isStoryPath('/en/story?u=sam')).toBe(true);
  });

  it('does not match neighboring routes', () => {
    expect(isStoryPath('/en/results')).toBe(false);
    expect(isStoryPath('/storyboard')).toBe(false);
    expect(isStoryPath('/en')).toBe(false);
  });
});
