import { describe, expect, it } from 'vitest';

import {
  SHARE_POPOVER_GAP,
  SHARE_POPOVER_VIEWPORT_PADDING,
  computeSharePopoverPosition,
} from './sharePopoverLayout';

describe('computeSharePopoverPosition', () => {
  const panel = { width: 256, height: 120 };
  const viewport = { width: 400, height: 700 };

  it('prefers bottom-end when there is room below the anchor', () => {
    const anchor = { top: 200, left: 300, right: 344, bottom: 244, width: 44, height: 44 };
    const position = computeSharePopoverPosition(anchor, panel, viewport);

    expect(position.placement).toBe('bottom-end');
    expect(position.top).toBe(anchor.bottom + SHARE_POPOVER_GAP);
    expect(position.left).toBe(anchor.right - panel.width);
  });

  it('clamps inside the viewport when the anchor is near the bottom-right edge', () => {
    const anchor = { top: 600, left: 348, right: 392, bottom: 644, width: 44, height: 44 };
    const position = computeSharePopoverPosition(anchor, panel, viewport);

    expect(position.top).toBeGreaterThanOrEqual(SHARE_POPOVER_VIEWPORT_PADDING);
    expect(position.left).toBeGreaterThanOrEqual(SHARE_POPOVER_VIEWPORT_PADDING);
    expect(position.top + panel.height).toBeLessThanOrEqual(viewport.height - SHARE_POPOVER_VIEWPORT_PADDING);
    expect(position.left + panel.width).toBeLessThanOrEqual(viewport.width - SHARE_POPOVER_VIEWPORT_PADDING);
  });
});
