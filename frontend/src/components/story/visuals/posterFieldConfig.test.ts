import { describe, expect, it } from 'vitest';

import {
  DEFAULT_POSTER_FIELD,
  resolvePosterFieldLayout,
  VISUAL_POSTER_DEFAULTS,
} from '@/components/story/visuals/posterFieldConfig';

describe('resolvePosterFieldLayout', () => {
  it('returns defaults when visual is omitted', () => {
    expect(resolvePosterFieldLayout()).toEqual(DEFAULT_POSTER_FIELD);
  });

  it('merges visual-specific defaults', () => {
    const layout = resolvePosterFieldLayout('cascade');
    expect(layout.rotation).toBe(VISUAL_POSTER_DEFAULTS.cascade?.rotation);
    expect(layout.contentX).toBe(VISUAL_POSTER_DEFAULTS.cascade?.contentX);
    expect(layout.left).toBe(DEFAULT_POSTER_FIELD.left);
  });

  it('covers person and recap visuals', () => {
    expect(resolvePosterFieldLayout('person').contentX).toBe(VISUAL_POSTER_DEFAULTS.person?.contentX);
    expect(resolvePosterFieldLayout('recap').rotation).toBe(VISUAL_POSTER_DEFAULTS.recap?.rotation);
  });

  it('applies slide overrides on top of visual defaults', () => {
    const layout = resolvePosterFieldLayout('hero', { contentX: '-12%', rotation: 4 });
    expect(layout.contentX).toBe('-12%');
    expect(layout.rotation).toBe(4);
    expect(layout.left).toBe(DEFAULT_POSTER_FIELD.left);
  });

  it('anchors field to the right of the text card gutter', () => {
    expect(resolvePosterFieldLayout().left).toContain('8vw');
    expect(resolvePosterFieldLayout().left).toContain('32rem');
  });
});
