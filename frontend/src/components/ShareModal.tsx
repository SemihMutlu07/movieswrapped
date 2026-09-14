'use client';

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';

import type { ShareCardData } from '@/components/share/types';
import { shareVariantsForOrientation } from '@/components/share/registry';
import { useShareLabels } from '@/components/share/useShareLabels';
import { normalizeShareCardData } from '@/components/share/viewModel';

import { SHARE_EXPORT_CONFIG } from '@/components/share/modal/exportUtils';
import { CanonicalExportCard } from '@/components/share/modal/CanonicalExportCard';
import { CardPreview } from '@/components/share/modal/CardPreview';
import { ShareModalHeader } from '@/components/share/modal/ShareModalHeader';
import { ShareModalSidebar } from '@/components/share/modal/ShareModalSidebar';
import { useShareExport } from '@/components/share/modal/useShareExport';
import type { ShareModalProps } from '@/components/share/modal/types';
import IsolatedModal from '@/components/IsolatedModal';

export {
  exportExactPng,
  readPngDimensions,
  resolveExportBackground,
  SHARE_EXPORT_CONFIG,
} from '@/components/share/modal/exportUtils';
export { shareSafeUrl } from '@/components/share/modal/shareActions';

export default function ShareModal({
  open,
  onClose,
  orientation,
  setOrientation: _setOrientation,
  cardProps,
  onDownloadSuccess,
}: ShareModalProps) {
  void _setOrientation;
  const { variantLabel: resolveVariantLabel } = useShareLabels();
  const availableVariants = useMemo(
    () => shareVariantsForOrientation(orientation, resolveVariantLabel),
    [orientation, resolveVariantLabel],
  );
  const previewRef = useRef<HTMLDivElement | null>(null);
  const [previewNode, setPreviewNode] = useState<HTMLDivElement | null>(null);
  const bindPreview = useCallback((el: HTMLDivElement | null) => {
    previewRef.current = el;
    setPreviewNode(el);
  }, []);
  const [activeIdx, setActiveIdx] = useState(0);
  const [pageW, setPageW] = useState(0);
  const [pageH, setPageH] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [actorIdx, setActorIdx] = useState(0);
  const [directorIdx, setDirectorIdx] = useState(0);
  const [showUsername, setShowUsername] = useState(true);
  const [exportError, setExportError] = useState<string | null>(null);

  const clampedIdx = Math.max(0, Math.min(availableVariants.length - 1, activeIdx));
  const activeVariant = availableVariants[clampedIdx];
  const variantKey = activeVariant.key;
  const variantLabel = activeVariant.label;

  useEffect(() => {
    if (!open) return;
    setActorIdx(0);
    setDirectorIdx(0);
    setActiveIdx(0);
    setShowUsername(true);
    setExportError(null);
  }, [open]);

  useEffect(() => {
    setActiveIdx(0);
  }, [orientation]);

  useEffect(() => {
    setActorIdx(0);
    setDirectorIdx(0);
  }, [cardProps]);

  const effectiveCardProps = useMemo<ShareCardData>(() => normalizeShareCardData({
    ...cardProps,
    onScreenCrush: cardProps.topActors?.[actorIdx] ?? cardProps.onScreenCrush,
    favoriteDirector: cardProps.topDirectors?.[directorIdx] ?? cardProps.favoriteDirector,
    username: showUsername ? cardProps.username : undefined,
  }), [cardProps, actorIdx, directorIdx, showUsername]);

  const target = useMemo(() => {
    const config = SHARE_EXPORT_CONFIG[orientation];
    return { w: config.domWidth, h: config.domHeight };
  }, [orientation]);

  useEffect(() => {
    if (!open || !previewNode) return;
    const measure = () => {
      const rect = previewNode.getBoundingClientRect();
      setPageW(rect.width);
      setPageH(rect.height || previewNode.parentElement?.clientHeight || window.innerHeight * 0.5);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(previewNode);
    return () => ro.disconnect();
  }, [open, previewNode]);

  const { handleSavePNG } = useShareExport({
    orientation,
    variantKey,
    isSaving,
    setIsSaving,
    setExportError,
    onDownloadSuccess,
  });

  const selectVariant = useCallback((idx: number) => {
    setActiveIdx(Math.max(0, Math.min(availableVariants.length - 1, idx)));
  }, [availableVariants.length]);

  useEffect(() => {
    if (!open || isSaving) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        selectVariant(clampedIdx + 1);
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        selectVariant(clampedIdx - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isSaving, clampedIdx, selectVariant]);

  const hasActors = (cardProps.topActors?.length ?? 0) >= 2;
  const hasDirectors = (cardProps.topDirectors?.length ?? 0) >= 2;
  const showPeople = hasActors || hasDirectors;

  return (
    <IsolatedModal
      open={open}
      onClose={() => {
        if (!isSaving) onClose();
      }}
      labelledBy="share-modal-title"
      panelClassName="relative h-full max-h-full w-full bg-[#1a1a1a] md:h-[calc(100dvh-2rem)] md:max-h-[960px] md:w-[calc(100vw-2rem)] md:max-w-[1320px] md:rounded-3xl"
      extras={
        <CanonicalExportCard
          variantKey={variantKey}
          data={effectiveCardProps}
          orientation={orientation}
        />
      }
    >
      <ShareModalHeader
        variantLabel={variantLabel}
        activeIdx={clampedIdx}
        variantCount={availableVariants.length}
        isSaving={isSaving}
        onClose={onClose}
      />

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <CardPreview
            previewRef={bindPreview}
            variantKey={variantKey}
            variantLabel={variantLabel}
            variantCount={availableVariants.length}
            activeIdx={clampedIdx}
            pageW={pageW}
            pageH={pageH}
            target={target}
            data={effectiveCardProps}
            orientation={orientation}
            isSaving={isSaving}
            onPrev={() => selectVariant(clampedIdx - 1)}
            onNext={() => selectVariant(clampedIdx + 1)}
          />

          <ShareModalSidebar
            cardProps={cardProps}
            isSaving={isSaving}
            showPeople={showPeople}
            hasActors={hasActors}
            hasDirectors={hasDirectors}
            actorIdx={actorIdx}
            directorIdx={directorIdx}
            setActorIdx={setActorIdx}
            setDirectorIdx={setDirectorIdx}
            showUsername={showUsername}
            setShowUsername={setShowUsername}
            exportError={exportError}
            onSave={handleSavePNG}
            variants={availableVariants}
            activeIdx={clampedIdx}
            onSelectVariant={selectVariant}
          />
        </div>
    </IsolatedModal>
  );
}
