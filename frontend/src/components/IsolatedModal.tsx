'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

type IsolatedModalProps = {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
  label?: string;
  panelClassName?: string;
  /** Rendered inside the overlay but outside the transformed panel (export nodes, etc.). */
  extras?: ReactNode;
};

function isOverlayLayer(element: Element): boolean {
  return (
    element.hasAttribute('data-mw-overlay-layer') ||
    Boolean(element.querySelector('[data-mw-overlay-layer]'))
  );
}

function setBackgroundInert(active: boolean, keep: Element | null) {
  for (const child of Array.from(document.body.children)) {
    if (keep && (child === keep || child.contains(keep))) continue;
    if (isOverlayLayer(child)) continue;
    if (active) {
      child.setAttribute('inert', '');
      child.setAttribute('aria-hidden', 'true');
    } else {
      child.removeAttribute('inert');
      child.removeAttribute('aria-hidden');
    }
  }
}

/**
 * Viewport-bounded modal that is not a layer of the page.
 *
 * Invariants while open:
 * - rendered in a document.body portal (above page chrome, immune to ancestor stacking)
 * - background cannot scroll or receive pointer events (`inert` + full-viewport backdrop)
 * - only `[data-mw-modal-scroll]` regions scroll
 * - panel stays inside the dynamic viewport + safe areas
 * - close restores the previous page scroll position (via useBodyScrollLock)
 */
export default function IsolatedModal({
  open,
  onClose,
  children,
  labelledBy,
  label,
  panelClassName = '',
  extras,
}: IsolatedModalProps) {
  const [mounted, setMounted] = useState(false);
  const reduce = useReducedMotion();
  useBodyScrollLock(open);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const keep = document.querySelector('[data-testid="isolated-modal"]');
    setBackgroundInert(true, keep);
    return () => setBackgroundInert(false, keep);
  }, [open]);

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="mw-isolated-modal" data-testid="isolated-modal">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.16 }}
            className="mw-isolated-modal__backdrop"
            onClick={onClose}
          />
          {extras}
          <div className="mw-isolated-modal__frame">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-labelledby={labelledBy}
              aria-label={label}
              initial={reduce ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: reduce ? 0 : 8 }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { type: 'tween', duration: 0.18, ease: [0.22, 1, 0.36, 1] }
              }
              className={`mw-isolated-modal__panel ${panelClassName}`.trim()}
              data-mw-modal-scroll
            >
              {children}
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
