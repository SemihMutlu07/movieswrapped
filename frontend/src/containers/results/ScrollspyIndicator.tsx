"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { useRafThrottle } from "@/hooks/useRafThrottle";
import { useI18n } from "@/i18n/I18nProvider";
import {
  pickActiveSectionId,
  SCROLLSPY_SLOT_PX,
  SCROLLSPY_THUMB_PX,
  scrollProgressIndex,
  scrollspyLabelKey,
  thumbOffsetPx,
} from "./scrollspy";

function measureSections(ids: string[]) {
  return ids
    .map((id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      return { id, top: el.getBoundingClientRect().top };
    })
    .filter((row): row is { id: string; top: number } => row !== null);
}

export function ScrollspyIndicator({ sectionIds }: { sectionIds: string[] }) {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const idsKey = sectionIds.join(",");
  const [activeId, setActiveId] = useState(sectionIds[0] ?? "");
  const hasJumped = useRef(false);
  const thumbY = useSpring(0, {
    stiffness: reduceMotion ? 1000 : 240,
    damping: reduceMotion ? 80 : 32,
    mass: reduceMotion ? 0.2 : 0.7,
    restDelta: 0.04,
  });

  const syncActive = useCallback(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    const spyY = Math.min(140, window.innerHeight * 0.28);
    const measured = measureSections(ids);
    const next = pickActiveSectionId(measured, spyY);
    if (next) setActiveId(next);
    const target = thumbOffsetPx(scrollProgressIndex(measured, spyY));
    if (!hasJumped.current) {
      thumbY.jump(target);
      hasJumped.current = true;
      return;
    }
    if (reduceMotion) thumbY.jump(target);
    else thumbY.set(target);
  }, [idsKey, reduceMotion, thumbY]);

  const onScroll = useRafThrottle(syncActive, [syncActive]);

  useEffect(() => {
    syncActive();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [onScroll, syncActive]);

  useEffect(() => {
    const ids = idsKey ? idsKey.split(",") : [];
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash || !ids.includes(hash)) return;
    document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [idsKey]);

  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    el?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    const url = new URL(window.location.href);
    url.hash = id;
    window.history.replaceState(null, "", url);
  };

  if (sectionIds.length < 2) return null;

  return (
    <nav
      aria-label={t("results.spy.nav")}
      className="pointer-events-none fixed left-[max(0.35rem,env(safe-area-inset-left))] top-1/2 z-30 -translate-y-1/2"
    >
      <div className="relative">
        <motion.span
          aria-hidden
          className="pointer-events-none absolute left-[10px] top-0 z-10 w-1 rounded-full bg-orange-400 will-change-transform"
          style={{ y: thumbY, height: SCROLLSPY_THUMB_PX }}
        />
        {sectionIds.map((id) => {
          const active = id === activeId;
          const label = t(scrollspyLabelKey(id));
          return (
            <div key={id} className="group relative flex items-center" style={{ height: SCROLLSPY_SLOT_PX }}>
              <button
                type="button"
                aria-label={label}
                aria-current={active ? "true" : undefined}
                onClick={() => jumpTo(id)}
                className="pointer-events-auto flex h-full w-6 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400/70"
              >
                <span
                  className={`block h-2 w-1 rounded-full ${
                    active ? "bg-white/15" : "bg-white/30 group-hover:bg-white/55"
                  }`}
                />
                <span
                  className={`pointer-events-none absolute left-7 whitespace-nowrap rounded-md border border-white/10 bg-[#1a1a1a]/95 px-2 py-0.5 text-xs font-medium tracking-wide text-white/80 opacity-0 shadow-lg backdrop-blur-sm transition-opacity duration-150 motion-reduce:transition-none group-hover:opacity-100 group-focus-within:opacity-100 ${
                    active ? "text-orange-200" : ""
                  }`}
                >
                  {label}
                </span>
              </button>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
