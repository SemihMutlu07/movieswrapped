import type { StatsData } from '@/containers/results/sections/types';
import { buildShareCardFromStats } from '@/components/share/viewModel';
import type { ShareCardInput, ShareOrientation, ShareVariant } from '@/components/share/types';

/**
 * Story finale adapter — same Stats → ShareCard mapping as Results.
 * Kept as a named export so story tests and StoryFinaleCard stay stable.
 */
export function buildStoryShareCard(stats: StatsData): ShareCardInput {
  return buildShareCardFromStats(stats);
}

/** Fixed DOM footprint of each orientation's share card, for finale scaling. */
export const FINALE_CARD_DOM: Record<ShareOrientation, { w: number; h: number }> = {
  horizontal: { w: 1200, h: 675 },
  vertical: { w: 675, h: 1200 },
};

/** Default variant per orientation shown in the finale. */
export const FINALE_VARIANT: Record<ShareOrientation, ShareVariant> = {
  horizontal: 'default',
  vertical: 'double-feature',
};

/** Story is desktop-only; the finale card is always the landscape share card. */
export function pickFinaleOrientation(_containerWidth?: number): ShareOrientation {
  return 'horizontal';
}
