'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type FloatingPanelProps = {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  /** Preferred placement; flipped on collision. */
  prefer?: 'above' | 'below';
};

type Pos = { top: number; left: number; placement: 'above' | 'below' };

function computePosition(
  anchor: DOMRect,
  panel: { width: number; height: number },
  prefer: 'above' | 'below',
): Pos {
  const gap = 8;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const pad = 12;

  let placement: 'above' | 'below' = prefer;
  let top = prefer === 'above'
    ? anchor.top - panel.height - gap
    : anchor.bottom + gap;

  if (prefer === 'above' && top < pad) {
    placement = 'below';
    top = anchor.bottom + gap;
  } else if (prefer === 'below' && top + panel.height > vh - pad) {
    placement = 'above';
    top = anchor.top - panel.height - gap;
  }

  top = Math.max(pad, Math.min(top, vh - panel.height - pad));

  // Align to anchor's right edge, flip left if overflowing.
  let left = anchor.right - panel.width;
  if (left < pad) left = pad;
  if (left + panel.width > vw - pad) left = Math.max(pad, vw - panel.width - pad);

  return { top, left, placement };
}

/**
 * Portal-based floating panel with collision-aware placement.
 * Avoids overflow:hidden ancestors clipping absolute drawers.
 */
export function FloatingPanel({
  open,
  anchorRef,
  onClose,
  children,
  prefer = 'above',
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<Pos | null>(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!anchor || !panel) return;
    const rect = panel.getBoundingClientRect();
    setPos(computePosition(anchor, { width: rect.width || 280, height: rect.height || 120 }, prefer));
  }, [anchorRef, prefer]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    reposition();
  }, [open, reposition, children]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    const onReposition = () => reposition();
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('touchstart', onPointer);
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('touchstart', onPointer);
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
    };
  }, [open, onClose, anchorRef, reposition]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      data-placement={pos?.placement ?? prefer}
      className="fixed z-[200] w-[min(18rem,calc(100vw-1.5rem))] rounded-2xl border border-white/10 bg-[#1a1a1a]/95 px-4 py-3 text-xs shadow-2xl backdrop-blur"
      style={{
        top: pos?.top ?? -9999,
        left: pos?.left ?? -9999,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
