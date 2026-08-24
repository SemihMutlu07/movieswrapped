/**
 * Coherent motion vocabulary for the Wrapped story experience.
 *
 * Audit 2026-08-22 tier system — every duration lives in exactly one band:
 *   micro (120–180ms) · data update (220–320ms) · scene (480–620ms) · ambient (16–24s).
 * Movement families per scene budget (1 primary + max 1 secondary + 1 ambient):
 * reveal, progress (scaleX/mask), media arrival (masked/batch).
 * Drop/bump/blur/pulse/drift are documented exceptions to the family rule,
 * but their durations still sit inside a tier.
 */

export const MOTION_TIER = {
  /** Taps, hover, per-frame progress smoothing. */
  micro: { min: 0.12, max: 0.18 },
  /** Counters, swaps, quick media arrivals. */
  dataUpdate: { min: 0.22, max: 0.32 },
  /** Slide entrances, crossfades, panel transitions. */
  scene: { min: 0.48, max: 0.62 },
  /** Continuous background drift loops. */
  ambient: { min: 16, max: 24 },
} as const;

export type MotionTierName = keyof typeof MOTION_TIER;

/** Tier a duration belongs to, or null when it violates every band. */
export function tierOf(durationSeconds: number): MotionTierName | null {
  for (const [name, { min, max }] of Object.entries(MOTION_TIER)) {
    if (durationSeconds >= min && durationSeconds <= max) return name as MotionTierName;
  }
  return null;
}

export const MOTION_DURATION = {
  // micro tier
  micro: 0.15,
  // data-update tier
  revealFast: 0.32,
  streamBurst: 0.3,
  emphasis: 0.28,
  panelExit: 0.3,
  // scene tier
  reveal: 0.52,
  transition: 0.6,
  fieldEnter: 0.56,
  panelEnter: 0.52,
  cardReveal: 0.6,
} as const;

/** Per-scene composition budget: one primary move, at most one secondary, one ambient loop. */
export const SCENE_MOTION_BUDGET = {
  primary: 1,
  secondaryMax: 1,
  ambientMax: 1,
} as const;

export const MOTION_STAGGER = {
  textLabel: 0,
  textHeadline: 0.11,
  // A1: supporting copy follows the headline within 180–200ms.
  textSub: 0.19,
  streamPoster: 0.042,
  curtainPoster: 0.034,
} as const;

export const MOTION_AMBIENT = {
  streamPan: 22,
  portraitDrift: 20,
  verticalStrip: 16,
  verticalCascade: 18,
  verticalMosaic: 17,
} as const;

export const MOTION_EASE = {
  editorial: [0.22, 1, 0.36, 1] as const,
  snap: [0.16, 1, 0.3, 1] as const,
  warm: [0.25, 0.46, 0.45, 0.94] as const,
  drift: [0.45, 0, 0.55, 1] as const,
  outSoft: [0.33, 1, 0.32, 1] as const,
} as const;

export function scaledDuration(base: number, motionScale = 1): number {
  return base * motionScale;
}

export function ambientLoopTransition(
  baseSeconds: number,
  motionScale = 1,
  active = true,
) {
  if (!active) return { duration: 0 };
  return {
    duration: scaledDuration(baseSeconds, motionScale),
    repeat: Infinity,
    repeatType: 'reverse' as const,
    ease: MOTION_EASE.drift,
  };
}

export function verticalDriftTransition(
  baseSeconds: number,
  index: number,
  motionScale = 1,
  active = true,
) {
  return ambientLoopTransition(baseSeconds + (index % 4) * 0.75, motionScale, active);
}
