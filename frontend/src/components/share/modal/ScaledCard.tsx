'use client';

import type { ReactNode } from 'react';

type ScaledCardProps = {
  target: { w: number; h: number };
  pageW: number;
  pageH: number;
  children: ReactNode;
};

export function ScaledCard({ target, pageW, pageH, children }: ScaledCardProps) {
  if (!pageW || !pageH) return null;
  const availW = Math.max(0, pageW - 16);
  const availH = Math.max(0, pageH - 16);
  const scale = Math.max(0.05, Math.min(availW / target.w, availH / target.h, 1));
  return (
    <div
      className="relative"
      style={{ width: target.w * scale, height: target.h * scale }}
    >
      <div
        style={{
          width: target.w,
          height: target.h,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'absolute',
          top: 0,
          left: 0,
        }}
        data-scaled-preview="true"
      >
        {children}
      </div>
    </div>
  );
}
