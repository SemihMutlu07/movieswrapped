"use client";

import { useCallback, useEffect, useState } from "react";
import { useRafThrottle } from "@/hooks/useRafThrottle";
import { trackConsentedEvent, trackEvent } from "@/lib/analytics";
import { markResultsNav } from "@/lib/results-nav";
import { readResultUsernameFromLocation, resultPath } from "@/lib/routes";
import { getUsername } from "@/lib/session-id";
import { STATS_STORAGE_KEY } from "@/lib/stats-storage";
import type { StatsData } from "@/containers/results/sections/types";

function getOrCreateSessionId() {
  if (typeof window === "undefined") {
    return "00000000-0000-4000-8000-000000000000";
  }

  let id = sessionStorage.getItem("session_id");
  if (!id) {
    id = crypto?.randomUUID?.() ?? `session_${Date.now()}`;
    sessionStorage.setItem("session_id", id);
  }
  return id;
}

function readStoredStatsBlob(): string | null {
  try {
    return sessionStorage.getItem(STATS_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useResultsSession() {
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);
  const [username, setUsername] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return readResultUsernameFromLocation() || getUsername() || null;
  });
  const [sessionId, setSessionId] = useState("");

  const handleResize = useCallback(() => {
    setIsMobile(window.innerWidth < 480);
  }, []);
  const throttledResize = useRafThrottle(handleResize, []);

  useEffect(() => {
    throttledResize();
    window.addEventListener("resize", throttledResize);
    return () => window.removeEventListener("resize", throttledResize);
  }, [throttledResize]);

  useEffect(() => {
    markResultsNav("route-start");
    const routedUsername = readResultUsernameFromLocation();
    const saved = readStoredStatsBlob();

    // Yield so ResultsShell can paint before JSON.parse of a large blob.
    const id = window.setTimeout(() => {
      let nextUsername = routedUsername;
      if (saved) {
        try {
          const parsedStats = JSON.parse(saved) as StatsData;
          const storedUsername = getUsername();
          const statsUsername = String(
            parsedStats.scraped_username || storedUsername || "",
          ).toLowerCase();
          const routeMatchesStats =
            !routedUsername ||
            (!!statsUsername && routedUsername === statsUsername);

          if (routeMatchesStats) {
            setStats(parsedStats);
            nextUsername = routedUsername || statsUsername;
            if (!routedUsername && nextUsername) {
              window.history.replaceState(null, "", resultPath(nextUsername));
            }
            queueMicrotask(() => {
              trackEvent("results_viewed", {
                total_films: parsedStats.total_films,
                average_rating: parsedStats.average_rating,
              });
              trackConsentedEvent("results_viewed_detailed", {
                total_countries: parsedStats.total_countries,
                average_runtime: parsedStats.average_runtime,
              });
            });
          }
        } catch (error) {
          console.error("[results] failed to parse stored stats:", error);
        }
      }

      setLoading(false);
      markResultsNav("data-ready");
      const storedUsername = nextUsername || getUsername();
      if (storedUsername) {
        setUsername(storedUsername);
      }
      setSessionId(getOrCreateSessionId());
    }, 0);

    return () => window.clearTimeout(id);
  }, []);

  return {
    stats,
    loading,
    isMobile,
    username,
    sessionId,
  };
}
