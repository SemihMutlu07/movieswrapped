'use client';

import { useState } from 'react';
import { useI18n } from '@/i18n/I18nProvider';

import type { StoryMedia } from '../types';

export function StoryImage({ item, className = '', priority = false }: { item: StoryMedia; className?: string; priority?: boolean }) {
  const { locale } = useI18n();
  const [failed, setFailed] = useState(false);
  const alt = locale === 'tr'
    ? item.alt.replace(/ poster$/, ' posteri').replace(/ portrait$/, ' portresi')
    : item.alt;
  if (failed) {
    return <div className={`h-full w-full bg-white/8 ${className}`} aria-hidden />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.url}
      alt={alt}
      className={`h-full w-full object-cover ${className}`}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      onError={() => setFailed(true)}
      style={{ objectPosition: item.objectPosition ?? (item.type === 'profile' ? '50% 28%' : 'center center') }}
    />
  );
}
