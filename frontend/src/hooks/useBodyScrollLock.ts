'use client';

import { useEffect } from 'react';

/**
 * Nested-safe body scroll lock for isolated modals.
 *
 * `overflow: hidden` alone does not stop scrolling on iOS Safari. Locking
 * `html`/`body` with `position: fixed` and restoring `window.scrollY` is the
 * invariant: background page cannot scroll, and close returns to the same
 * scroll position without a layout jump.
 */
let lockCount = 0;
let savedScrollY = 0;

function lockBody() {
  const { body, documentElement } = document;
  savedScrollY = window.scrollY;
  documentElement.setAttribute('data-mw-scroll-locked', 'true');
  body.setAttribute('data-mw-scroll-locked', 'true');
  body.style.top = `-${savedScrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
}

function unlockBody() {
  const { body, documentElement } = document;
  documentElement.removeAttribute('data-mw-scroll-locked');
  body.removeAttribute('data-mw-scroll-locked');
  body.style.top = '';
  body.style.left = '';
  body.style.right = '';
  body.style.width = '';
  window.scrollTo(0, savedScrollY);
}

function onTouchMove(event: TouchEvent) {
  const target = event.target;
  if (!(target instanceof Element)) {
    event.preventDefault();
    return;
  }
  if (target.closest('[data-mw-modal-scroll], [data-mw-overlay-layer]')) return;
  event.preventDefault();
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    if (lockCount === 0) {
      lockBody();
      document.addEventListener('touchmove', onTouchMove, { passive: false });
    }
    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);
      if (lockCount === 0) {
        document.removeEventListener('touchmove', onTouchMove);
        unlockBody();
      }
    };
  }, [locked]);
}

/** Test-only: reset module lock state between cases. */
export function __resetBodyScrollLockForTests() {
  lockCount = 0;
  savedScrollY = 0;
  if (typeof document === 'undefined') return;
  document.documentElement.removeAttribute('data-mw-scroll-locked');
  document.body.removeAttribute('data-mw-scroll-locked');
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
}
