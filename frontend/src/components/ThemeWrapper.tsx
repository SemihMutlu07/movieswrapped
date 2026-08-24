'use client';

/**
 * ThemeWrapper — applies theme CSS variables, background, overlays,
 * and injects CSS override rules that restyle ALL existing components
 * (HeroStats, Genres, etc.) without modifying them individually.
 */

import React, { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTheme } from '@/lib/theme';

/** Generate CSS override rules for the given theme. */
function themeCss(themeId: string): string {
  if (themeId === 'current') return '';

  const isVhs = themeId === 'vhs';
  const isBw = themeId === 'classic-bw';
  const isApple = themeId === 'apple';

  // Shared overrides — Apple is light, the other two are dark.
  const sharedSurfaceBg = isApple ? '#FFFFFF' : isVhs ? '#2a1a10' : '#2a2a2a';
  const sharedBorder = isApple
    ? 'rgba(0,0,0,0.08)'
    : isVhs
    ? 'rgba(212,149,90,0.25)'
    : 'rgba(255,255,255,0.10)';
  const sharedText = isApple ? '#1D1D1F' : isVhs ? '#f0e6d8' : '#e8e0d8';
  const sharedMuted = isApple ? '#6E6E73' : isVhs ? '#d4955a' : '#8a8a8a';
  const sharedMuted2 = isApple ? '#86868B' : isVhs ? '#b07a40' : '#6a6a6a';
  const sharedRadius = isApple ? '16px' : isVhs ? '10px' : '4px';

  // Color-specific stat card overrides (QuickFacts, etc.)
  const colorReplacements = isVhs
    ? {
        emerald: { bg: 'rgba(212,149,90,0.12)', border: 'rgba(212,149,90,0.25)', text: '#d4955a', text2: '#d4955a' },
        purple: { bg: 'rgba(212,149,90,0.08)', border: 'rgba(212,149,90,0.18)', text: '#b07a40', text2: '#b07a40' },
        yellow: { bg: 'rgba(212,149,90,0.10)', border: 'rgba(212,149,90,0.20)', text: '#d4955a', text2: '#d4955a' },
        cyan: { bg: 'rgba(212,149,90,0.08)', border: 'rgba(212,149,90,0.18)', text: '#b07a40', text2: '#b07a40' },
        orange: { bg: 'rgba(212,149,90,0.12)', border: 'rgba(212,149,90,0.25)', text: '#d4955a', text2: '#d4955a' },
        fuchsia: { bg: 'rgba(212,149,90,0.08)', border: 'rgba(212,149,90,0.18)', text: '#b07a40', text2: '#b07a40' },
        pink: { bg: 'rgba(212,149,90,0.10)', border: 'rgba(212,149,90,0.20)', text: '#d4955a', text2: '#d4955a' },
        rose: { bg: 'rgba(212,149,90,0.10)', border: 'rgba(212,149,90,0.20)', text: '#d4955a', text2: '#d4955a' },
        blue: { bg: 'rgba(212,149,90,0.08)', border: 'rgba(212,149,90,0.18)', text: '#b07a40', text2: '#b07a40' },
      }
    : isBw
    ? {
        emerald: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#c0b8b0', text2: '#c0b8b0' },
        purple: { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', text: '#8a8a8a', text2: '#8a8a8a' },
        yellow: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#c0b8b0', text2: '#c0b8b0' },
        cyan: { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', text: '#8a8a8a', text2: '#8a8a8a' },
        orange: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#c0b8b0', text2: '#c0b8b0' },
        fuchsia: { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', text: '#8a8a8a', text2: '#8a8a8a' },
        pink: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#c0b8b0', text2: '#c0b8b0' },
        rose: { bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.08)', text: '#c0b8b0', text2: '#c0b8b0' },
        blue: { bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)', text: '#8a8a8a', text2: '#8a8a8a' },
      }
    : isApple
    ? {
        // Apple HIG: one accent + neutral grays. Every accent slot becomes
        // a subtle gray surface; the actual SF Blue is reserved for the
        // single primary CTA / score, not stat chips.
        emerald: { bg: 'rgba(52,199,89,0.10)',  border: 'rgba(52,199,89,0.18)',  text: '#1B8434', text2: '#1B8434' },
        purple:  { bg: '#F2F2F7',               border: 'rgba(0,0,0,0.08)',     text: '#1D1D1F', text2: '#6E6E73' },
        yellow:  { bg: 'rgba(255,159,10,0.10)', border: 'rgba(255,159,10,0.22)', text: '#A85D00', text2: '#A85D00' },
        cyan:    { bg: '#F2F2F7',               border: 'rgba(0,0,0,0.08)',     text: '#1D1D1F', text2: '#6E6E73' },
        orange:  { bg: 'rgba(255,149,0,0.10)',  border: 'rgba(255,149,0,0.22)', text: '#9A4A00', text2: '#9A4A00' },
        fuchsia: { bg: '#F2F2F7',               border: 'rgba(0,0,0,0.08)',     text: '#1D1D1F', text2: '#6E6E73' },
        pink:    { bg: '#F2F2F7',               border: 'rgba(0,0,0,0.08)',     text: '#1D1D1F', text2: '#6E6E73' },
        rose:    { bg: '#F2F2F7',               border: 'rgba(0,0,0,0.08)',     text: '#1D1D1F', text2: '#6E6E73' },
        blue:    { bg: 'rgba(0,102,204,0.08)',  border: 'rgba(0,102,204,0.20)', text: '#0044AA', text2: '#0066CC' },
      }
    : {};

  // Build color replacement CSS
  let colorCss = '';
  for (const [name, cols] of Object.entries(colorReplacements)) {
    colorCss += `
  [data-theme="${themeId}"] [class*="bg-${name}-500\\/10"],
  [data-theme="${themeId}"] [class*="bg-${name}-500\\/20"] { background: ${cols.bg} !important; }
  [data-theme="${themeId}"] [class*="border-${name}-500\\/20"],
  [data-theme="${themeId}"] [class*="border-${name}-500\\/30"] { border-color: ${cols.border} !important; }
  [data-theme="${themeId}"] .text-${name}-200 { color: ${cols.text2} !important; }
  [data-theme="${themeId}"] .text-${name}-400,
  [data-theme="${themeId}"] .text-${name}-500 { color: ${cols.text} !important; }
  [data-theme="${themeId}"] [class*="text-${name}-500"] { color: ${cols.text} !important; }`;
  }

  return `
/* ── Theme: ${themeId} ── */

/* Backgrounds */
[data-theme="${themeId}"] [class*="bg-slate-800"],
[data-theme="${themeId}"] [class*="bg-slate-900"] {
  background: ${sharedSurfaceBg} !important;
}
[data-theme="${themeId}"] [class*="bg-slate-700"] {
  background: ${isApple ? '#F2F2F7' : isVhs ? '#1a0a08' : '#3a3a3a'} !important;
}

/* Borders */
[data-theme="${themeId}"] [class*="border-slate-"],
[data-theme="${themeId}"] [class*="border-white/"],
[data-theme="${themeId}"] [class*="border-white\\/"] {
  border-color: ${sharedBorder} !important;
}

/* Text colors */
[data-theme="${themeId}"] [class*="text-slate-"] {
  color: ${sharedMuted} !important;
}
[data-theme="${themeId}"] [class*="text-gray-"] {
  color: ${sharedMuted2} !important;
}
[data-theme="${themeId}"] .text-white {
  color: ${sharedText} !important;
}

/* Border radius — override rounded-2xl / rounded-xl */
[data-theme="${themeId}"] [class*="rounded-2xl"],
[data-theme="${themeId}"] [class*="rounded-xl"] {
  border-radius: ${sharedRadius} !important;
}
[data-theme="${themeId}"] [class*="rounded-lg"] {
  border-radius: ${isVhs ? '8px' : '4px'} !important;
}

/* Gradient buttons */
[data-theme="${themeId}"] [class*="from-blue-600"],
[data-theme="${themeId}"] [class*="from-orange-400"],
[data-theme="${themeId}"] [class*="from-pink-500"] {
  background: ${
    isApple
      ? 'linear-gradient(135deg, #0066CC, #0044AA) !important'
      : isVhs
      ? 'linear-gradient(135deg, #2a1a10, #1a0a08) !important'
      : 'linear-gradient(135deg, #3a3a3a, #2a2a2a) !important'
  };
  border: 1px solid ${sharedBorder} !important;
  color: ${isApple ? '#FFFFFF' : sharedText} !important;
}

/* Purple/pink gradient backgrounds in hero */
[data-theme="${themeId}"] [class*="from-pink-500\\/20"],
[data-theme="${themeId}"] [class*="bg-gradient-to-r from-pink-500"] {
  background: ${sharedSurfaceBg} !important;
  border-color: ${sharedBorder} !important;
}

/* Cards / sections that use slate-800 base */
[data-theme="${themeId}"] [class*="bg-slate-800\\/"] {
  background: ${sharedSurfaceBg} !important;
}

/* Palette stat cards (QuickFacts colored boxes) */
${colorCss}

/* Filmstrip / bar chart backgrounds */
[data-theme="${themeId}"] [class*="bg-\\[\\#0a0a0a\\]"] {
  background: ${isApple ? '#F2F2F7' : isVhs ? '#1a0a08' : '#2a2a2a'} !important;
}

/* CinemaScale / Section accent borders */
[data-theme="${themeId}"] [class*="border-emerald-"],
[data-theme="${themeId}"] [class*="border-purple-"],
[data-theme="${themeId}"] [class*="border-orange-"],
[data-theme="${themeId}"] [class*="border-cyan-"],
[data-theme="${themeId}"] [class*="border-fuchsia-"],
[data-theme="${themeId}"] [class*="border-yellow-"],
[data-theme="${themeId}"] [class*="border-pink-"] {
  border-color: ${sharedBorder} !important;
}

/* Rating stars and other colorful inline elements */
[data-theme="${themeId}"] .text-amber-400,
[data-theme="${themeId}"] [class*="text-amber-"] {
  color: ${sharedMuted} !important;
}

/* Skeleton / loading pulse backgrounds */
[data-theme="${themeId}"] [class*="animate-pulse"] {
  background: ${
    isApple ? 'rgba(0,0,0,0.04)' : isVhs ? 'rgba(42,26,16,0.5)' : 'rgba(42,42,42,0.5)'
  } !important;
}

${isApple ? `
/* Apple-specific polish: lift surfaces with a single soft shadow,
   raise contrast on white-on-white edges, lighten heavy inline shadows. */
[data-theme="apple"] [class*="bg-slate-800"],
[data-theme="apple"] [class*="bg-slate-900"],
[data-theme="apple"] [class*="bg-slate-800\\/"] {
  box-shadow: 0 1px 2px rgba(0,0,0,0.04), 0 1px 1px rgba(0,0,0,0.03) !important;
}
/* Section component uses backdrop-blur which produces nothing on white — make it crisp */
[data-theme="apple"] section[class*="backdrop-blur"] {
  backdrop-filter: none !important;
}
/* Heavy black drop-shadow utilities (shadow-2xl) are too aggressive on light bg */
[data-theme="apple"] [class*="shadow-2xl"] {
  box-shadow: 0 4px 16px rgba(0,0,0,0.06), 0 2px 4px rgba(0,0,0,0.04) !important;
}
` : ''}
`;
}

export default function ThemeWrapper({ children }: { children: ReactNode }) {
  const { config } = useTheme();
  const theme = config.id;

  const style = useMemo(() => {
    const s: Record<string, string> = {};
    for (const [key, val] of Object.entries(config.cssVars)) {
      s[key] = val;
    }
    return s;
  }, [config.cssVars]);

  const cssOverrides = useMemo(() => themeCss(theme), [theme]);

  const isVhs = theme === 'vhs';
  const isBw = theme === 'classic-bw';

  return (
    <div
      data-theme={theme}
      className={`relative min-h-dvh transition-colors duration-500 ${
        theme === 'current' ? 'bg-[#1e252d] text-white' :
        theme === 'vhs' ? 'bg-[#1a1410] text-[#f0e6d8]' :
        theme === 'apple' ? 'bg-[#FBFAF7] text-[#1D1D1F]' :
        'bg-[#1a1a1a] text-[#e8e0d8]'
      }`}
      style={style}
    >
      {/* Injected CSS overrides for component restyling */}
      {cssOverrides && <style>{cssOverrides}</style>}

      {/* CRT scanlines for VHS */}
      {isVhs && (
        <div
          className="pointer-events-none fixed inset-0 z-[9999]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 5px)',
          }}
        />
      )}

      {/* Film grain for B&W — 16mm film grain */}
      {isBw && (
        <div
          className="pointer-events-none fixed inset-0 z-[9999]"
          style={{
            backgroundImage: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'noise\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.65\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23noise)\' opacity=\'0.045\'/%3E%3C/svg%3E")',
            backgroundSize: '200px 200px',
            opacity: 0.5,
            pointerEvents: 'none',
            mixBlendMode: 'screen',
          }}
        />
      )}

      {/* Current theme ambient glow */}
      {theme === 'current' && (
        <div className="fixed inset-0 -z-10">
          <div className="absolute top-0 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full filter blur-[120px]" />
          <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-orange-600/10 rounded-full filter blur-[120px]" />
        </div>
      )}

      {children}
    </div>
  );
}
