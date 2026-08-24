import React from 'react';
import ShareCard from '@/components/ShareCard';
import AppleHIGShareCard from './variants/AppleHIGShareCard';
import EditorialShareCard from './variants/EditorialShareCard';
import Variant3ShareCard from './variants/Variant3ShareCard';
import DoubleFeatureShareCard from './variants/DoubleFeatureShareCard';
import ContactSheetShareCard from './variants/ContactSheetShareCard';
import AdmitOneShareCard from './variants/AdmitOneShareCard';
import type { MessageKey } from '@/i18n/catalogs';
import type {
  ShareCardData,
  ShareCardInput,
  ShareOrientation,
  ShareVariant,
} from './types';
import { normalizeShareCardData } from './viewModel';

export type ShareVariantDefinition = {
  key: ShareVariant;
  labelKey: MessageKey;
  orientation: ShareOrientation;
};

export const SHARE_VARIANTS: ReadonlyArray<ShareVariantDefinition> = [
  { key: 'default', labelKey: 'share.variant.default', orientation: 'horizontal' },
  { key: 'apple-hig', labelKey: 'share.variant.appleHig', orientation: 'horizontal' },
  { key: 'editorial', labelKey: 'share.variant.editorial', orientation: 'horizontal' },
  { key: 'variant-3', labelKey: 'share.variant.variant3', orientation: 'horizontal' },
  { key: 'double-feature', labelKey: 'share.variant.doubleFeature', orientation: 'vertical' },
  { key: 'contact-sheet', labelKey: 'share.variant.contactSheet', orientation: 'vertical' },
  { key: 'admit-one', labelKey: 'share.variant.admitOne', orientation: 'vertical' },
];

export type ResolvedShareVariant = {
  key: ShareVariant;
  label: string;
  orientation: ShareOrientation;
};

export function shareVariantsForOrientation(
  orientation: ShareOrientation,
  resolveLabel: (key: ShareVariant) => string,
): ReadonlyArray<ResolvedShareVariant> {
  return SHARE_VARIANTS
    .filter((variant) => variant.orientation === orientation)
    .map((variant) => ({
      key: variant.key,
      label: resolveLabel(variant.key),
      orientation: variant.orientation,
    }));
}

type VariantComponent = React.ComponentType<{ data: ShareCardData }>;

const VARIANT_COMPONENTS: Record<ShareVariant, VariantComponent> = {
  default: ShareCard,
  'apple-hig': AppleHIGShareCard,
  editorial: EditorialShareCard,
  'variant-3': Variant3ShareCard,
  'double-feature': DoubleFeatureShareCard,
  'contact-sheet': ContactSheetShareCard,
  'admit-one': AdmitOneShareCard,
};

type RendererProps = {
  variant: ShareVariant;
  data: ShareCardInput;
  orientation: ShareOrientation;
};

export function ShareVariantRenderer({ variant, data, orientation }: RendererProps) {
  const definition = SHARE_VARIANTS.find((candidate) => candidate.key === variant);
  if (!definition || definition.orientation !== orientation) {
    throw new Error(`Share variant "${variant}" does not support ${orientation} output.`);
  }
  const Component = VARIANT_COMPONENTS[variant];
  return <Component data={normalizeShareCardData(data)} />;
}
