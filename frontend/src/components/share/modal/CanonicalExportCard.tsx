'use client';

import React from 'react';

import type { ShareCardData, ShareVariant } from '@/components/share/types';
import { ShareVariantRenderer } from '@/components/share/registry';

import type { Orientation } from './types';

type CanonicalExportCardProps = {
  variantKey: ShareVariant;
  data: ShareCardData;
  orientation: Orientation;
};

/**
 * Unscaled canonical card for PNG capture. Must NOT live under CSS transform
 * (ScaledCard) — capturing a scaled preview is the root cause of ~144p blur.
 */
export const CanonicalExportCard = React.memo(function CanonicalExportCard({
  variantKey,
  data,
  orientation,
}: CanonicalExportCardProps) {
  return (
    <div
      data-canonical-export="true"
      aria-hidden="true"
      className="pointer-events-none fixed left-[-10000px] top-0 z-[-1] overflow-hidden"
    >
      <ShareVariantRenderer variant={variantKey} data={data} orientation={orientation} />
    </div>
  );
});
