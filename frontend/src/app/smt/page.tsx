'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { loadSmtFixture, type SmtDestination } from '@/lib/smt-loader';

function SmtBoot() {
  const params = useSearchParams();
  const destination: SmtDestination = params.get('to') === 'results' ? 'results' : 'story';
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const seed = async () => {
      try {
        await loadSmtFixture(fetch, localStorage, (url) => window.location.replace(url), undefined, destination);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not load the local fixture.');
      }
    };
    void seed();
  }, [destination]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#0f0d0b] p-8 text-stone-300">
      <div className="max-w-lg text-center font-mono text-xs uppercase tracking-[0.18em]">
        {error ? (
          <p className="normal-case tracking-normal text-red-300">{error}</p>
        ) : (
          <p>
            {destination === 'results'
              ? 'Loading Semih’s fixture into the results page…'
              : 'Loading Semih’s fixture into the story…'}
          </p>
        )}
      </div>
    </main>
  );
}

export default function SmtPage() {
  return (
    <Suspense fallback={<main className="grid min-h-screen place-items-center bg-[#0f0d0b] text-stone-500">Loading…</main>}>
      <SmtBoot />
    </Suspense>
  );
}
