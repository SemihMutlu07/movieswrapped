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
  it.each(['analysis_done', 'postback_started', 'completed'])(
    'does not open the story from a %s trace without the final result',
    (stage) => {
      vi.useFakeTimers();
      const onStoryReady = vi.fn();
      const { rerender } = render(
        <I18nProvider locale="en">
          <ScrapeStoryWait username="semihmutsuz" events={[{ stage }]} onStoryReady={onStoryReady} />
        </I18nProvider>,
      );
      act(() => { vi.advanceTimersByTime(3000); });
      expect(onStoryReady).not.toHaveBeenCalled();

      rerender(
        <I18nProvider locale="en">
          <ScrapeStoryWait username="semihmutsuz" resultReady onStoryReady={onStoryReady} />
        </I18nProvider>,
      );
      expect(onStoryReady).toHaveBeenCalledOnce();
      rerender(
        <I18nProvider locale="en">
          <ScrapeStoryWait username="semihmutsuz" resultReady queued onStoryReady={onStoryReady} />
        </I18nProvider>,
      );
      expect(onStoryReady).toHaveBeenCalledOnce();
    },
  );

  it('opens a completed result even without traces and despite an empty-fleet hint', () => {
    const onStoryReady = vi.fn();
    render(
      <I18nProvider locale="en">
        <ScrapeStoryWait username="semihmutsuz" queued resultReady onStoryReady={onStoryReady} />
      </I18nProvider>,
    );
    expect(onStoryReady).toHaveBeenCalledOnce();
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
            events={[...base, { stage: 'reviews_done' }, { stage: 'analysis_started' }]}
          />
        </I18nProvider>,
      );
      act(() => {
        vi.advanceTimersByTime(240);
      });
      // The re-targeted swap skips the stale reviews phase.
      expect(screen.getByTestId('scrape-story-wait')).toHaveAttribute('data-beat', 'analyzing');
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
