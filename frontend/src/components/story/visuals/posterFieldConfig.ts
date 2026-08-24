import type { SlideVisual } from '../types';

/**
 * Responsive poster-field placement on desktop story slides.
 * `left` + `right` define the outer frame; inner layouts use `contentX` / `rotation`.
 */
export type PosterFieldConfig = {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
  width?: string;
  maxWidth?: string;
  rotation?: number;
  contentX?: string;
  /** Multiplier for float animation duration (1 = default, >1 slower). */
  motionScale?: number;
  /** Scales poster density (column gap / visible count). 1 = default. */
  density?: number;
};

export const DEFAULT_POSTER_FIELD: PosterFieldConfig = {
  // Sit just right of the text card (~32rem) instead of a wide % gutter that grows dead space.
  left: 'max(calc(8vw + 32rem + 1.5vw), 36vw)',
  right: 'clamp(-10vw, -6vw, -3vw)',
  top: '9vh',
  bottom: '9vh',
  rotation: 0,
  contentX: '0%',
  motionScale: 1,
  density: 1,
};

/** Per-visual defaults — rotation and inner bias without duplicating field anchors. */
export const VISUAL_POSTER_DEFAULTS: Partial<Record<SlideVisual, Partial<PosterFieldConfig>>> = {
  mosaic: { rotation: -4, contentX: '-3%' },
  cascade: { rotation: 7, contentX: '-5%', density: 1 },
  director: { rotation: 2, contentX: '-4%' },
  person: { rotation: 1, contentX: '-2%' },
  actor: { rotation: 2, contentX: '-6%' },
  review: { rotation: 3, contentX: '-8%' },
  finale: { rotation: -2, contentX: '-5%', motionScale: 1.15 },
  hero: { rotation: 2, contentX: '-6%' },
  strip: { rotation: 5, contentX: '-4%' },
  'poster-wall': { rotation: 2, contentX: '-4%' },
  portrait: { rotation: 0, contentX: '-5%' },
  recap: { rotation: 1, contentX: '-4%' },
};

export function resolvePosterFieldLayout(
  visual?: SlideVisual,
  override?: Partial<PosterFieldConfig>,
): PosterFieldConfig {
  const visualDefaults = visual ? VISUAL_POSTER_DEFAULTS[visual] : undefined;
  return {
    ...DEFAULT_POSTER_FIELD,
    ...visualDefaults,
    ...override,
  };
}
