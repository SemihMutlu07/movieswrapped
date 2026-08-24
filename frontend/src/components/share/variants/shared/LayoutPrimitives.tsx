'use client';

import Image from 'next/image';
import React, { useState } from 'react';

import { getTmdbImageUrl } from '@/lib/analytics';
import type { SharePersonStat } from '../../types';

const classes = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

export function PortraitFrame({
  person,
  className = '',
  imageClassName = 'object-cover object-[center_15%]',
}: {
  person: SharePersonStat;
  className?: string;
  imageClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = person.headshotUrl ? getTmdbImageUrl(person.headshotUrl, 'w342') : null;
  const initials = person.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase() || '—';

  return (
    <div className={classes('relative aspect-[2/3] shrink-0 overflow-hidden border border-current/25 bg-current/5', className)}>
      {src && !failed ? (
        <Image
          src={src}
          alt={person.name}
          fill
          sizes="220px"
          className={imageClassName}
          crossOrigin="anonymous"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="absolute inset-0 grid place-items-center px-2 text-center text-[18px] font-black opacity-55">
          {initials}
        </div>
      )}
    </div>
  );
}

export function PersonPanel({
  person,
  label,
  countLabel,
  countText,
  unknownName,
  className = '',
  mediaClassName = 'w-[112px] rounded-2xl',
  labelClassName = 'text-[12px] font-bold uppercase tracking-[0.16em] opacity-65',
  nameClassName = 'text-[24px] font-bold leading-tight',
  countClassName = 'text-[14px] opacity-70',
}: {
  person: SharePersonStat;
  label: string;
  countLabel: string;
  countText?: string;
  unknownName?: string;
  className?: string;
  mediaClassName?: string;
  labelClassName?: string;
  nameClassName?: string;
  countClassName?: string;
}) {
  const displayName = person.name?.trim() ? person.name : (unknownName ?? person.name);

  return (
    <section className={classes('grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-5', className)}>
      <PortraitFrame person={person} className={mediaClassName} />
      <div className="min-w-0 [overflow-wrap:anywhere]">
        <p className={labelClassName}>{label}</p>
        <p className={classes('mt-1 line-clamp-2', nameClassName)}>{displayName}</p>
        <p className={classes('mt-1 tabular-nums', countClassName)}>
          {countText ?? `${person.count} ${countLabel}`}
        </p>
      </div>
    </section>
  );
}

export function Metric({
  label,
  value,
  detail,
  className = '',
  labelClassName = 'text-[12px] font-bold uppercase tracking-[0.14em] opacity-60',
  valueClassName = 'text-[32px] font-black leading-none tabular-nums',
  detailClassName = 'text-[13px] opacity-65',
}: {
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
  detailClassName?: string;
}) {
  return (
    <section className={classes('min-w-0 [overflow-wrap:anywhere]', className)}>
      <p className={labelClassName}>{label}</p>
      <p className={classes('mt-2', valueClassName)}>{value}</p>
      {detail ? <p className={classes('mt-1', detailClassName)}>{detail}</p> : null}
    </section>
  );
}

export function GenresLine({ genres, className = '' }: { genres: string[]; className?: string }) {
  return (
    <p className={classes('min-w-0 [overflow-wrap:anywhere]', className)}>
      {genres.length > 0 ? genres.join(' · ') : 'Genres unavailable'}
    </p>
  );
}

export function Username({ username, className = '' }: { username?: string; className?: string }) {
  if (!username) return null;
  return (
    <span
      className={classes('min-w-0 break-all [overflow-wrap:anywhere] line-clamp-2', className)}
      title={`@${username}`}
    >
      @{username}
    </span>
  );
}

export function Brand({ className = '' }: { className?: string }) {
  return <span className={classes('font-bold tracking-[0.08em]', className)}>movieswrapped.com</span>;
}
