'use client';

import type { ReactNode } from 'react';

const wrap = 'min-w-0 max-w-full break-words';

export function Label({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`${wrap} font-mono text-[clamp(0.62rem,2.5vw,0.75rem)] uppercase tracking-[0.16em] text-amber-300 md:tracking-[0.22em] ${className}`}>
      {children}
    </p>
  );
}

export function Big({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`mt-2 ${wrap} hyphens-auto text-[clamp(1.45rem,min(6.6vw,11cqi),4.5rem)] font-black leading-[1.08] text-stone-50 md:mt-4 ${className}`}>
      {children}
    </p>
  );
}

export function Sub({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`mt-2 ${wrap} text-[clamp(0.86rem,3.5vw,1rem)] leading-relaxed text-stone-400 md:mt-3 ${className}`}>
      {children}
    </p>
  );
}

export function FinaleHeadline({ children }: { children: ReactNode }) {
  return (
    <p className={`${wrap} text-[clamp(1.02rem,4.4vw,2rem)] font-black leading-snug text-stone-50`}>
      {children}
    </p>
  );
}

export function Hint({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <p className={`${wrap} font-mono text-[clamp(0.62rem,2.4vw,0.7rem)] uppercase tracking-[0.18em] ${className}`}>
      {children}
    </p>
  );
}
