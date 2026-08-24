import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ScrapeStoryWait from './ScrapeStoryWait';
import { I18nProvider } from '@/i18n/I18nProvider';

/**
 * The global setup stubs IntersectionObserver with a mock that never fires.
 * These helpers replace it so tests can simulate the card entering the
 * viewport (auto-play off, audit decision 6).
 */
function stubViewportEntry() {
  const real = globalThis.IntersectionObserver;
  const observers: { callback: IntersectionObserverCallback }[] = [];
  class TriggerObserver {
    callback: IntersectionObserverCallback;
    constructor(cb: IntersectionObserverCallback) {
      this.callback = cb;
      observers.push(this);
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.IntersectionObserver = TriggerObserver as unknown as typeof IntersectionObserver;
  return {
    enter() {
      act(() => {
        for (const observer of observers) {
          observer.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            observer as unknown as IntersectionObserver,
          );
        }
      });
    },
    restore() {
      globalThis.IntersectionObserver = real;
    },
  };
}

describe('ScrapeStoryWait', () => {
  it('does not render film titles or posters before a done-stage sample', () => {
    render(
      <I18nProvider locale="en">
        <ScrapeStoryWait username="semihmutsuz" events={[{ stage: 'scrape_started' }]} />
      </I18nProvider>,
    );

    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'intro');
    expect(screen.queryByText('Heat')).not.toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('renders confirmed posters only after grid_done sample', () => {
    vi.useFakeTimers();
    render(
      <I18nProvider locale="en">
        <ScrapeStoryWait
          username="semihmutsuz"
          events={[
            {
              stage: 'grid_done',
              metrics: {
                films: 2,
                sample: [
                  { title: 'Heat', poster_url: 'https://a.ltrbxd.com/heat.jpg' },
                  { title: 'Kader' },
                ],
              },
            },
          ]}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'scraping');
    // The first poster batch waits out its entrance beat before appearing.
    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByAltText('')).toHaveAttribute('src', 'https://a.ltrbxd.com/heat.jpg');
    expect(screen.queryByText('Kader')).not.toBeInTheDocument();
  });
});

describe('ScrapeStoryWait state machine (L1)', () => {
  it('walks INTRO → SCRAPING → REVIEWS → ANALYZING → READY on worker evidence', () => {
    const events = (stage: string, metrics?: Record<string, unknown>) => [{ stage, metrics }];
    const { rerender } = render(
      <I18nProvider locale="en">
        <ScrapeStoryWait username="semihmutsuz" events={events('scrape_started')} />
      </I18nProvider>,
    );
    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'intro');

    rerender(
      <I18nProvider locale="en">
        <ScrapeStoryWait
          username="semihmutsuz"
          events={events('grid_done', { films: 12, sample: [{ title: 'Heat' }] })}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'scraping');

    rerender(
      <I18nProvider locale="en">
        <ScrapeStoryWait
          username="semihmutsuz"
          events={[...events('grid_done'), { stage: 'reviews_done', metrics: { reviews: 40 } }]}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'reviews');

    rerender(
      <I18nProvider locale="en">
        <ScrapeStoryWait
          username="semihmutsuz"
          events={[...events('grid_done'), { stage: 'reviews_done' }, { stage: 'analysis_started' }]}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'analyzing');

    rerender(
      <I18nProvider locale="en">
        <ScrapeStoryWait
          username="semihmutsuz"
          events={[...events('grid_done'), { stage: 'analysis_done' }]}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'ready');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '4');
    expect(screen.getByTestId('wait-progress-analyzing')).toHaveAttribute('data-state', 'done');
  });

  it('settles READY into STORY after a dwell and fires onStoryReady once', () => {
    vi.useFakeTimers();
    const onStoryReady = vi.fn();
    render(
      <I18nProvider locale="en">
        <ScrapeStoryWait
          username="semihmutsuz"
          onStoryReady={onStoryReady}
          events={[{ stage: 'completed' }]}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'ready');
    expect(onStoryReady).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1400);
    });
    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'story');
    expect(onStoryReady).toHaveBeenCalledTimes(1);
  });

  it('stops the elapsed timer once the machine reaches READY', () => {
    vi.useFakeTimers();
    const viewport = stubViewportEntry();
    try {
      render(
        <I18nProvider locale="en">
          <ScrapeStoryWait username="semihmutsuz" events={[{ stage: 'analysis_done' }]} />
        </I18nProvider>,
      );
      viewport.enter();

      act(() => {
        vi.advanceTimersByTime(1000); // past STORY_DWELL? no — still READY (1400ms dwell)
      });
      // Elapsed never ticks past READY — the wait is over.
      expect(screen.queryByText('1s')).not.toBeInTheDocument();
      expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'ready');
    } finally {
      viewport.restore();
      vi.useRealTimers();
    }
  });

  it('drops a pending slide swap when the target changes again mid-exit (replay hygiene)', () => {
    vi.useFakeTimers();
    const viewport = stubViewportEntry();
    try {
      const base = [{ stage: 'grid_done', metrics: { films: 1, sample: [{ title: 'Heat' }] } }];
      const { rerender } = render(
        <I18nProvider locale="en">
          <ScrapeStoryWait username="semihmutsuz" events={base} />
        </I18nProvider>,
      );
      viewport.enter();
      rerender(
        <I18nProvider locale="en">
          <ScrapeStoryWait
            username="semihmutsuz"
            events={[...base, { stage: 'reviews_done', metrics: { reviews: 5 } }]}
          />
        </I18nProvider>,
      );
      // Mid-exit: old slide still mounted, new one must wait.
      expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'scraping');

      // Target flips again before EXIT_MS elapses — no stale timer may land us on reviews.
      rerender(
        <I18nProvider locale="en">
          <ScrapeStoryWait
            username="semihmutsuz"
            events={[...base, { stage: 'reviews_done' }, { stage: 'analysis_done' }]}
          />
        </I18nProvider>,
      );
      act(() => {
        vi.advanceTimersByTime(240);
      });
      // Third event set ends with analysis_done — the re-targeted swap lands on READY.
      expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'ready');
      expect(screen.queryByText('Reviews are in')).not.toBeInTheDocument();
    } finally {
      viewport.restore();
    }
  });
});

describe('ScrapeStoryWait progress (L4)', () => {
  it('renders one segment per real backend stage, not per beat tick', () => {
    render(
      <I18nProvider locale="en">
        <ScrapeStoryWait
          username="semihmutsuz"
          events={[
            {
              stage: 'grid_done',
              metrics: {
                films: 2,
                sample: [{ title: 'Heat', poster_url: 'https://a.ltrbxd.com/heat.jpg' }],
              },
            },
          ]}
        />
      </I18nProvider>,
    );

    expect(screen.getByTestId('wait-progress-intro')).toHaveAttribute('data-state', 'done');
    expect(screen.getByTestId('wait-progress-scraping')).toHaveAttribute('data-state', 'active');
    expect(screen.getByTestId('wait-progress-reviews')).toHaveAttribute('data-state', 'pending');
    expect(screen.getByTestId('wait-progress-analyzing')).toHaveAttribute('data-state', 'pending');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1');
  });

  it('never gives the active segment a full-width linear fill', () => {
    render(
      <I18nProvider locale="en">
        <ScrapeStoryWait username="semihmutsuz" events={[{ stage: 'scrape_started' }]} />
      </I18nProvider>,
    );

    for (const stage of ['intro', 'scraping', 'reviews', 'analyzing']) {
      const segment = screen.getByTestId(`wait-progress-${stage}`);
      for (const child of Array.from(segment.children)) {
        expect(child.className).not.toContain('w-full');
      }
    }
    expect(screen.getByTestId('wait-progress-intro')).toHaveAttribute('data-state', 'active');
  });

  it('runs the progress shimmer only in the pulse-dominant phase', () => {
    vi.useFakeTimers();
    const viewport = stubViewportEntry();
    try {
      const { rerender } = render(
        <I18nProvider locale="en">
          <ScrapeStoryWait
            username="semihmutsuz"
            events={[{ stage: 'grid_done', metrics: { films: 2, sample: [{ title: 'Heat' }] } }]}
          />
        </I18nProvider>,
      );
      viewport.enter();
      // SCRAPING is posterDrop-dominant: no shimmer on the active segment.
      expect(screen.getByTestId('wait-progress-fill-scraping').className).not.toContain('mw-wait-seg-active');

      rerender(
        <I18nProvider locale="en">
          <ScrapeStoryWait
            username="semihmutsuz"
            events={[
              { stage: 'grid_done', metrics: { films: 2, sample: [{ title: 'Heat' }] } },
              { stage: 'analysis_started' },
            ]}
          />
        </I18nProvider>,
      );
      act(() => {
        vi.advanceTimersByTime(250); // let the exit crossfade finish
      });
      // ANALYZING is pulse-dominant: shimmer allowed here.
      expect(screen.getByTestId('wait-progress-fill-analyzing').className).toContain('mw-wait-seg-active');
    } finally {
      viewport.restore();
      vi.useRealTimers();
    }
  });
});

describe('ScrapeStoryWait motion gating (L4)', () => {
  const realIntersectionObserver = globalThis.IntersectionObserver;
  const realMatchMedia = window.matchMedia;

  afterEach(() => {
    vi.useRealTimers();
    globalThis.IntersectionObserver = realIntersectionObserver;
    window.matchMedia = realMatchMedia;
  });

  it('starts the JS counter only after the card first enters the viewport', () => {
    vi.useFakeTimers();
    const observers: { callback: IntersectionObserverCallback }[] = [];
    class StubObserver {
      callback: IntersectionObserverCallback;
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.IntersectionObserver = StubObserver as unknown as typeof IntersectionObserver;

    render(<I18nProvider locale="en"><ScrapeStoryWait username="semihmutsuz" /></I18nProvider>);
    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-started', 'false');

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.getByText('0s')).toBeInTheDocument();

    act(() => {
      for (const observer of observers) {
        observer.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          observer as unknown as IntersectionObserver,
        );
      }
    });
    expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-started', 'true');

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('2s')).toBeInTheDocument();
  });

  it('freezes the JS counter under prefers-reduced-motion', () => {
    vi.useFakeTimers();
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    })) as typeof window.matchMedia;

    render(<I18nProvider locale="en"><ScrapeStoryWait username="semihmutsuz" /></I18nProvider>);

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByText('0s')).toBeInTheDocument();
    // No shimmer class on the active segment either.
    const activeFill = screen.getByTestId('wait-progress-intro').firstElementChild;
    expect(activeFill?.className).not.toContain('mw-wait-seg-active');
  });
});

describe('ScrapeStoryWait poster stream (L3)', () => {
  const eightPosters = Array.from({ length: 8 }, (_, i) => ({
    title: `Film ${i + 1}`,
    poster_url: `https://a.ltrbxd.com/film-${i + 1}.jpg`,
  }));

  // alt="" posters are presentational: they expose no "img" ARIA role, so the
  // stream is counted from the DOM, not from role queries.
  function gridImgs() {
    return document.querySelectorAll('[data-testid="wait-poster-grid"] img');
  }

  function renderWithPosters(films = 1200) {
    return render(
      <I18nProvider locale="en">
        <ScrapeStoryWait
          username="semihmutsuz"
          events={[{ stage: 'grid_done', metrics: { films, sample: eightPosters } }]}
        />
      </I18nProvider>,
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reserves fixed 2:3 slots upfront so revealing never shifts layout', () => {
    const viewport = stubViewportEntry();
    try {
      renderWithPosters();
      viewport.enter();

      const grid = screen.getByTestId('wait-poster-grid');
      const slots = Array.from(grid.children);
      expect(slots).toHaveLength(8); // all MAX_POSTERS slots exist before any poster arrives
      for (const slot of slots) {
        expect(slot.className).toContain('aspect-[2/3]');
      }
      // No image has loaded yet — the first batch waits out its entrance beat.
      expect(gridImgs()).toHaveLength(0);
    } finally {
      viewport.restore();
    }
  });

  it('reveals posters in 2–4 batches, never as a single-poster drip', () => {
    const viewport = stubViewportEntry();
    try {
      renderWithPosters();
      viewport.enter();

      act(() => {
        vi.advanceTimersByTime(250);
      });
      expect(gridImgs()).toHaveLength(4); // first batch of 4 lands whole

      act(() => {
        vi.advanceTimersByTime(130); // t=380ms — no single-poster drip in between
      });
      expect(gridImgs()).toHaveLength(4);

      act(() => {
        vi.advanceTimersByTime(570); // t=950ms — second batch lands whole
      });
      expect(gridImgs()).toHaveLength(8);
    } finally {
      viewport.restore();
    }
  });

  it('settles the count 80–120ms after posters appear, from worker films_found not poster count', () => {
    const viewport = stubViewportEntry();
    try {
      renderWithPosters(1200);
      viewport.enter();

      act(() => {
        vi.advanceTimersByTime(250); // posters visible
      });
      expect(gridImgs()).toHaveLength(4);
      // Not settled yet — and never derived from the 4 visible posters.
      expect(screen.queryByText(/films found/)).not.toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(100); // within the 80–120ms settle band
      });
      expect(screen.getByText('1,200 films found')).toBeInTheDocument();
    } finally {
      viewport.restore();
    }
  });

  it('shows every poster and the live count immediately under reduced motion', () => {
    const realMatchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    })) as typeof window.matchMedia;

    try {
      renderWithPosters(1200);

      expect(gridImgs()).toHaveLength(8);
      expect(screen.getByText('1,200 films found')).toBeInTheDocument();
    } finally {
      window.matchMedia = realMatchMedia;
    }
  });

  it('clears every reveal and settle timer on unmount', () => {
    const viewport = stubViewportEntry();
    try {
      const { unmount } = renderWithPosters();
      viewport.enter();

      act(() => {
        vi.advanceTimersByTime(250); // first batch shown; settle + next batch timers pending
      });
      expect(vi.getTimerCount()).toBeGreaterThan(0);

      unmount();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      viewport.restore();
    }
  });
});
