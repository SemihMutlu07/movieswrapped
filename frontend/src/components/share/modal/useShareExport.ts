'use client';

import { useCallback } from 'react';

import { trackEvent } from '@/lib/analytics';
import { useI18n } from '@/i18n/I18nProvider';

import { exportExactPng } from './exportUtils';
import { downloadFallback, saveWithFilePicker, shareSafeUrl, shareToSystem } from './shareActions';
import type { Orientation } from './types';

type UseShareExportOptions = {
  orientation: Orientation;
  variantKey: string;
  isSaving: boolean;
  setIsSaving: (value: boolean) => void;
  setExportError: (value: string | null) => void;
  onDownloadSuccess?: () => void;
};

export function useShareExport({
  orientation,
  variantKey,
  isSaving,
  setIsSaving,
  setExportError,
  onDownloadSuccess,
}: UseShareExportOptions) {
  const { t } = useI18n();

  const findExportRoot = (): HTMLElement | null =>
    document.querySelector<HTMLElement>('[data-canonical-export="true"] [data-export-root="true"]')
    ?? document.querySelector<HTMLElement>('[data-active="true"] [data-export-root="true"]');

  const handleSavePNG = useCallback(async () => {
    if (isSaving) return;
    const exportRoot = findExportRoot();
    if (!exportRoot) {
      setExportError(t('share.prepareError'));
      trackEvent('share_export_failed', { variant: variantKey, orientation, reason: 'missing_export_root' });
      return;
    }
    // Prefer the canonical offscreen card; never export the CSS-scaled modal preview.
    if (exportRoot.closest('[data-scaled-preview="true"]')) {
      setExportError(t('share.prepareError'));
      trackEvent('share_export_failed', { variant: variantKey, orientation, reason: 'scaled_preview_root' });
      return;
    }
    setIsSaving(true);
    setExportError(null);
    trackEvent('share_export_started', { variant: variantKey, orientation });
    const originalSrcs: string[] = [];
    try {
      const images = Array.from(exportRoot.querySelectorAll('img'));
      images.forEach((img, i) => {
        originalSrcs[i] = img.src;
        const safeUrl = shareSafeUrl(img.src);
        img.crossOrigin = 'anonymous';
        img.src = safeUrl;
      });
      await Promise.all([
        ...images.map((img) => img.decode().catch(() => undefined)),
        document.fonts?.ready.catch(() => undefined) ?? Promise.resolve(),
      ]);
      const bg = '#0B1220';
      const blob = await exportExactPng(exportRoot, orientation, bg);
      let method: 'system_share' | 'file_picker' | 'download' = 'download';
      const shareResult = await shareToSystem(blob);
      if (shareResult === 'cancelled') {
        trackEvent('share_export_cancelled', { variant: variantKey, orientation, method: 'system_share' });
        return;
      }
      if (shareResult === 'shared') {
        method = 'system_share';
      } else {
        const pickerResult = await saveWithFilePicker(blob);
        if (pickerResult === 'cancelled') {
          trackEvent('share_export_cancelled', { variant: variantKey, orientation, method: 'file_picker' });
          return;
        }
        if (pickerResult === 'saved') method = 'file_picker';
        else downloadFallback(blob);
      }
      trackEvent('share_export_succeeded', { variant: variantKey, orientation, method });
      onDownloadSuccess?.();
    } catch (err) {
      console.error('Export failed:', err);
      setExportError(t('share.exportError'));
      trackEvent('share_export_failed', {
        variant: variantKey,
        orientation,
        reason: err instanceof Error ? err.name : 'unknown',
      });
    } finally {
      const imgs = exportRoot.querySelectorAll('img');
      imgs.forEach((img, i) => { if (originalSrcs[i]) img.src = originalSrcs[i]; });
      setIsSaving(false);
    }
  }, [isSaving, orientation, variantKey, onDownloadSuccess, setExportError, setIsSaving, t]);

  return { handleSavePNG };
}
