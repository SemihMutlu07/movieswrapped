export const SHARE_POPOVER_GAP = 8;
export const SHARE_POPOVER_VIEWPORT_PADDING = 12;
export const SHARE_POPOVER_Z_INDEX = 210;

export type SharePopoverPlacement = 'bottom-end' | 'bottom-start' | 'top-end' | 'top-start';

type RectLike = Pick<DOMRect, 'top' | 'left' | 'right' | 'bottom' | 'width' | 'height'>;
type Size = { width: number; height: number };
type Viewport = { width: number; height: number };

function positionFor(
  placement: SharePopoverPlacement,
  anchor: RectLike,
  panel: Size,
  gap: number,
) {
  switch (placement) {
    case 'bottom-end':
      return { top: anchor.bottom + gap, left: anchor.right - panel.width };
    case 'bottom-start':
      return { top: anchor.bottom + gap, left: anchor.left };
    case 'top-end':
      return { top: anchor.top - panel.height - gap, left: anchor.right - panel.width };
    case 'top-start':
      return { top: anchor.top - panel.height - gap, left: anchor.left };
  }
}

function fitsViewport(
  top: number,
  left: number,
  panel: Size,
  viewport: Viewport,
  padding: number,
) {
  return (
    top >= padding
    && left >= padding
    && top + panel.height <= viewport.height - padding
    && left + panel.width <= viewport.width - padding
  );
}

function clampToViewport(
  top: number,
  left: number,
  panel: Size,
  viewport: Viewport,
  padding: number,
) {
  return {
    top: Math.min(Math.max(padding, top), Math.max(padding, viewport.height - padding - panel.height)),
    left: Math.min(Math.max(padding, left), Math.max(padding, viewport.width - padding - panel.width)),
  };
}

/** Pick the first placement that fits; otherwise clamp a bottom-end fallback inside the viewport. */
export function computeSharePopoverPosition(
  anchor: RectLike,
  panel: Size,
  viewport: Viewport,
  gap = SHARE_POPOVER_GAP,
  padding = SHARE_POPOVER_VIEWPORT_PADDING,
): { top: number; left: number; placement: SharePopoverPlacement } {
  const candidates: SharePopoverPlacement[] = ['bottom-end', 'top-end', 'bottom-start', 'top-start'];

  for (const placement of candidates) {
    const candidate = positionFor(placement, anchor, panel, gap);
    if (fitsViewport(candidate.top, candidate.left, panel, viewport, padding)) {
      return { ...candidate, placement };
    }
  }

  const fallback = positionFor('bottom-end', anchor, panel, gap);
  return {
    ...clampToViewport(fallback.top, fallback.left, panel, viewport, padding),
    placement: 'bottom-end',
  };
}
