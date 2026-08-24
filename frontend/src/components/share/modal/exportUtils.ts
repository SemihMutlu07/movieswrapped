import { toBlob } from 'html-to-image';

import type { Orientation } from './types';

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function exportToBlob(el: HTMLElement, w: number, h: number, pixelRatio: number, bg: string) {
  if (document.fonts) await document.fonts.ready;
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  return await toBlob(el, {
    width: w,
    height: h,
    pixelRatio,
    backgroundColor: bg,
    cacheBust: true,
  });
}

export function resolveExportBackground(el: HTMLElement, fallback: string): string {
  const inlineBackground = el.style.backgroundColor.trim();
  if (inlineBackground) return inlineBackground;

  const computedBackground = getComputedStyle(el).backgroundColor;
  if (computedBackground && computedBackground !== 'transparent' && computedBackground !== 'rgba(0, 0, 0, 0)') {
    return computedBackground;
  }
  return fallback;
}

/**
 * Deterministic share export sizes.
 * DOM size matches card design; pixelRatio sharpens without unbounded DPR.
 * Horizontal: 1200×675 @2 → 2400×1350
 * Story: 675×1200 @2 → 1350×2400
 */
export const SHARE_EXPORT_CONFIG = {
  horizontal: { domWidth: 1200, domHeight: 675, outputWidth: 2400, outputHeight: 1350, pixelRatio: 2 },
  vertical: { domWidth: 675, domHeight: 1200, outputWidth: 1350, outputHeight: 2400, pixelRatio: 2 },
} as const;

export async function readPngDimensions(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (blob.size < 24) return null;
  const bytes = new Uint8Array(await blob.slice(0, 24).arrayBuffer());
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) return null;
  const view = new DataView(bytes.buffer);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

export async function exportExactPng(el: HTMLElement, orientation: Orientation, bg: string): Promise<Blob> {
  const config = SHARE_EXPORT_CONFIG[orientation];
  const exportBackground = resolveExportBackground(el, bg);
  let lastError: unknown;
  for (const retryDelay of [0, 250, 1000]) {
    if (retryDelay > 0) await delay(retryDelay);
    try {
      const blob = await exportToBlob(el, config.domWidth, config.domHeight, config.pixelRatio, exportBackground);
      if (blob) {
        const dimensions = await readPngDimensions(blob);
        if (dimensions?.width === config.outputWidth && dimensions.height === config.outputHeight) return blob;
      }
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(`Export did not produce ${config.outputWidth}×${config.outputHeight}`);
}
