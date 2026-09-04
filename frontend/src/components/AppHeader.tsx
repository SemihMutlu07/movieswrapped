'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Film, Sparkles } from 'lucide-react';
import { getUsername } from '@/lib/session-id';
import { resultPath } from '@/lib/routes';

export default function AppHeader() {
  const pathname = usePathname();
  const username = typeof window !== 'undefined' ? getUsername() : null;
  const resultsHref = username ? resultPath(username) : '/results';

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-[#14181c]/85 backdrop-blur-md transition-all">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
        <Link href="/" className="group flex items-center gap-2 transition-opacity hover:opacity-90">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 shadow-md shadow-orange-500/20">
            <Film className="h-4 w-4 text-white" />
          </div>
          <span className="text-base font-bold tracking-tight text-white">
            Movies <span className="font-extrabold text-orange-400">Wrapped</span>
          </span>
        </Link>

        <nav aria-label="Main navigation" className="flex items-center gap-1 sm:gap-2">
          <Link
            href={resultsHref}
            aria-current={pathname?.startsWith('/results') ? 'page' : undefined}
            className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all sm:text-sm ${
              pathname?.startsWith('/results')
                ? 'border border-orange-500/30 bg-orange-500/15 text-orange-400'
                : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            <Sparkles className={`h-3.5 w-3.5 ${pathname?.startsWith('/results') ? 'text-orange-400' : 'text-slate-400'}`} />
            <span>Wrapped</span>
          </Link>
        </nav>
      </div>
    </header>
  );
}
