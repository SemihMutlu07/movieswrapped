'use client';

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';

import {
  SHARE_POPOVER_Z_INDEX,
  computeSharePopoverPosition,
  isShareSheetViewport,
} from './sharePopoverLayout';

type SharePopoverProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  panelId?: string;
  label: string;
};

export function SharePopover({
  open,
  onOpenChange,
  anchorRef,
  children,
  panelId,
  label,
}: SharePopoverProps) {
  const generatedId = useId();
  const resolvedPanelId = panelId ?? generatedId;
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [sheet, setSheet] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }

    const updatePosition = () => {
      const compact = isShareSheetViewport(window.innerWidth);
      setSheet(compact);
      if (compact) {
        setCoords({ top: 0, left: 0 });
        return;
      }

      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;

      const anchorRect = anchor.getBoundingClientRect();
      const panelSize = {
        width: panel.offsetWidth || panel.scrollWidth || 256,
        height: panel.offsetHeight || panel.scrollHeight || 96,
      };

      const next = computeSharePopoverPosition(anchorRect, panelSize, {
        width: window.innerWidth,
        height: window.innerHeight,
      });
      setCoords({ top: next.top, left: next.left });
    };

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);

    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [anchorRef, children, open]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onOpenChange(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchorRef, onOpenChange, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      anchorRef.current?.focus();
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [anchorRef, onOpenChange, open]);

  useLayoutEffect(() => {
    if (!open || !panelRef.current) return;
    const focusable = panelRef.current.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    );
    focusable?.focus();
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      ref={panelRef}
      id={resolvedPanelId}
      role="dialog"
      aria-label={label}
      aria-modal="false"
      data-share-popover-panel="true"
      data-mw-overlay-layer="true"
      data-share-sheet={sheet ? 'bottom' : 'popover'}
      className={sheet
        ? 'fixed inset-x-3 z-[210] w-auto'
        : 'fixed'}
      style={sheet
        ? {
            top: 'auto',
            bottom: 'max(0.75rem, env(safe-area-inset-bottom, 0px))',
            left: 12,
            right: 12,
            zIndex: SHARE_POPOVER_Z_INDEX,
            visibility: coords ? 'visible' : 'hidden',
          }
        : {
            top: coords?.top ?? -10000,
            left: coords?.left ?? -10000,
            zIndex: SHARE_POPOVER_Z_INDEX,
            visibility: coords ? 'visible' : 'hidden',
          }}
    >
      {children}
    </div>,
    document.body,
  );
}
