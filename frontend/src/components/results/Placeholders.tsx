'use client';

/**
 * Shared fallback graphics for missing film posters and person photos.
 * Replaces the divergent per-site fallbacks (initials, raw title text, empty
 * boxes) with consistent icon placeholders. Each placeholder fills its parent
 * (w-full/h-full), so drop it into any sized/aspect-ratio container.
 */

import React, { useEffect, useState } from 'react';
import { Film, UserRound } from 'lucide-react';

/** Icon fill for a missing film poster. */
export function PosterPlaceholder({ className = '' }: { className?: string }) {
  return (
    <div
      className={`w-full h-full grid place-items-center bg-gradient-to-br from-zinc-800 to-zinc-900 ${className}`}
      aria-hidden
    >
      <Film className="w-1/3 aspect-square text-white/20" strokeWidth={1.5} />
    </div>
  );
}

/** Icon fill for a missing director/actor photo. */
export function PersonAvatarPlaceholder({ className = '' }: { className?: string }) {
  return (
    <div
      className={`w-full h-full grid place-items-center bg-gradient-to-br from-slate-700 to-slate-900 ${className}`}
      aria-hidden
    >
      <UserRound className="w-1/2 aspect-square text-white/25" strokeWidth={1.5} />
    </div>
  );
}

/**
 * Poster <img> that swaps to a PosterPlaceholder on missing src OR load error.
 * Encapsulates the onError handling that the modal poster grids previously lacked.
 */
export function PosterImage({
  src,
  alt,
  className = '',
}: {
  src: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (!src || failed) return <PosterPlaceholder />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      className={`w-full h-full object-cover ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
