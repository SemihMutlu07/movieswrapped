'use client';

import { useEffect, useState } from 'react';

import { COMPACT_LAYOUT_MAX_PX } from '@/containers/results/section-layout';

const QUERY = `(max-width: ${COMPACT_LAYOUT_MAX_PX}px)`;

function readCompact(): boolean {
  if (typeof window === 'undefined') return true;
  return window.matchMedia(QUERY).matches;
}

/**
 * True when the viewport is in the 2-column Results composition
 * (below Tailwind `sm` / 640px).
 *
 * Compact-first on the server: the shared static HTML always encodes the
 * 4-item contract. After mount, matchMedia may expand desktop counts.
 * That makes a fifth card on a phone impossible, including before effects run.
 */
export function useCompactLayout(): boolean {
  const [compact, setCompact] = useState(readCompact);

  useEffect(() => {
    const media = window.matchMedia(QUERY);
    const sync = () => setCompact(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return compact;
}
