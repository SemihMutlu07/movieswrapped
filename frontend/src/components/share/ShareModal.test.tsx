import React from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { toBlob } from 'html-to-image';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { trackEvent } from '@/lib/analytics';
import ShareModal, {
  exportExactPng,
  readPngDimensions,
  SHARE_EXPORT_CONFIG,
  shareSafeUrl,
} from '@/components/ShareModal';
import type { ShareCardData } from './types';
import { I18nProvider } from '@/i18n/I18nProvider';
import {
  SHARE_VARIANTS,
  shareVariantsForOrientation,
  ShareVariantRenderer,
} from './registry';
import { normalizeShareCardData } from './viewModel';

vi.mock('next/image', () => ({
  default: ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean; priority?: boolean }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
  ),
}));

vi.mock('html-to-image', () => ({
  toBlob: vi.fn(),
}));

vi.mock('@/lib/analytics', () => ({
  getTmdbImageUrl: (path: string | null | undefined) => (path ? `http://localhost:8000${path}` : null),
  trackEvent: vi.fn(),
}));

class ResizeObserverMock {
  private cb: ResizeObserverCallback;
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
  }
  observe = (target: Element) => {
    this.cb([{ target } as ResizeObserverEntry], this as unknown as ResizeObserver);
  };
  disconnect = vi.fn();
  unobserve = vi.fn();
}

const baseData: ShareCardData = {
  onScreenCrush: { name: 'Actor One', headshotUrl: '/tmdb-proxy/t/p/w300/a1.jpg', count: 4 },
  favoriteDirector: { name: 'Director One', headshotUrl: '/tmdb-proxy/t/p/w300/d1.jpg', count: 5 },
  year: 2026,
  writtenReviews: 42,
  genres: ['Bilim Kurgu', 'Drama', 'Noir'],
  watchedFilms: 120,
  spentDays: 9,
  spentHours: 216,
  timePercent: 3,
  cinemaScale: 72,
  personaLabel: 'Archivist',
  minutesAverage: 108,
  mostCommonRating: 4,
  peakDecade: '1990s',
  peakDecadeCount: 18,
  topActors: [
    { name: 'Actor One', headshotUrl: '/tmdb-proxy/t/p/w300/a1.jpg', count: 4 },
    { name: 'Actor Two', headshotUrl: '/tmdb-proxy/t/p/w300/a2.jpg', count: 3 },
  ],
  topDirectors: [
    { name: 'Director One', headshotUrl: '/tmdb-proxy/t/p/w300/d1.jpg', count: 5 },
    { name: 'Director Two', headshotUrl: '/tmdb-proxy/t/p/w300/d2.jpg', count: 2 },
  ],
  topReviewWords: [
    { word: 'dreamlike', count: 12 },
    { word: 'lonely', count: 9 },
    { word: 'funny', count: 7 },
  ],
};

function renderShareModal(cardProps = baseData, orientation: 'horizontal' | 'vertical' = 'horizontal') {
  return render(
    <I18nProvider locale="en"><ShareModal
      open
      onClose={() => {}}
      orientation={orientation}
      setOrientation={() => {}}
      cardProps={cardProps}
    /></I18nProvider>,
  );
}

function exportRoot() {
  const root = document.querySelector<HTMLElement>('[data-active="true"] [data-export-root="true"]');
  expect(root).not.toBeNull();
  return root as HTMLElement;
}

async function openSwapDrawer() {
  await userEvent.click(screen.getByRole('button', { name: /tune actor/i }));
  await waitFor(() => {
    expect(document.querySelector('[data-share-popover-panel="true"]')).toBeTruthy();
  });
}

beforeEach(() => {
  vi.mocked(toBlob).mockReset();
  vi.mocked(trackEvent).mockClear();
  // jsdom returns 0 for clientWidth/Height by default; the modal sizes its rail
  // off these, so without a mock variants never enter the mount budget.
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 400 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 700 });
  // The rail measures pageW/pageH via getBoundingClientRect (jsdom returns all
  // zeros). pageW has no clientWidth fallback, so without this the export cards
  // never mount and exportRoot() is null.
  Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ width: 400, height: 700, top: 0, left: 0, right: 400, bottom: 700, x: 0, y: 0, toJSON: () => ({}) }),
  });
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});


describe('ShareModal customization popover', () => {
  it('reuses IsolatedModal so page chrome is inert', async () => {
    const chrome = document.createElement('div');
    chrome.textContent = 'page chrome';
    document.body.appendChild(chrome);
    renderShareModal();
    expect(await screen.findByTestId('isolated-modal')).toBeInTheDocument();
    expect(chrome).toHaveAttribute('inert');
    chrome.remove();
  });

  it('renders the customization panel in a body portal anchored to the tune button', async () => {
    renderShareModal();
    await openSwapDrawer();

    const panel = document.querySelector('[data-share-popover-panel="true"]');
    expect(panel).toBeTruthy();
    expect(panel?.parentElement).toBe(document.body);
    expect(within(panel as HTMLElement).getByText('Actor')).toBeInTheDocument();
  });

  it('keeps the popover inside the viewport when the tune button is near the top-right edge', async () => {
    const tuneRect = {
      top: 8,
      left: 348,
      right: 392,
      bottom: 52,
      width: 44,
      height: 44,
      x: 348,
      y: 8,
      toJSON: () => ({}),
    } as DOMRect;
    const defaultRect = {
      top: 0,
      left: 0,
      right: 400,
      bottom: 700,
      width: 400,
      height: 700,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
    const original = HTMLElement.prototype.getBoundingClientRect;
    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: function (this: HTMLElement) {
        if (this.getAttribute('aria-label') === 'Tune actor and director') return tuneRect;
        if (this.dataset.sharePopoverPanel === 'true') return original.call(this);
        return defaultRect;
      },
    });

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 400 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 700 });

    renderShareModal();
    await openSwapDrawer();

    const panel = document.querySelector<HTMLElement>('[data-share-popover-panel="true"]');
    expect(panel).toBeTruthy();

    await waitFor(() => {
      expect(Number.isFinite(Number.parseFloat(panel!.style.top))).toBe(true);
      expect(Number.isFinite(Number.parseFloat(panel!.style.left))).toBe(true);
    });

    const top = Number.parseFloat(panel!.style.top);
    const left = Number.parseFloat(panel!.style.left);
    expect(top).toBeGreaterThanOrEqual(12);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + 256).toBeLessThanOrEqual(400 - 12);

    Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
      configurable: true,
      value: original,
    });
  });

  it('closes the customization popover on Escape without closing the share modal', async () => {
    const onClose = vi.fn();
    render(
      <I18nProvider locale="en"><ShareModal
        open
        onClose={onClose}
        orientation="horizontal"
        setOrientation={() => {}}
        cardProps={baseData}
      /></I18nProvider>,
    );

    await openSwapDrawer();
    expect(document.querySelector('[data-share-popover-panel="true"]')).toBeTruthy();

    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('[data-share-popover-panel="true"]')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Share' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the customization popover when clicking outside', async () => {
    renderShareModal();
    await openSwapDrawer();
    expect(document.querySelector('[data-share-popover-panel="true"]')).toBeTruthy();

    await userEvent.pointer({ keys: '[MouseLeft]', target: document.body });
    expect(document.querySelector('[data-share-popover-panel="true"]')).toBeNull();
  });
});

describe('ShareModal person swap', () => {
  it('changes selected actor and director data when variety buttons are clicked', async () => {
    renderShareModal();

    expect(within(exportRoot()).getByText('Actor One')).toBeInTheDocument();
    expect(within(exportRoot()).getByText('Director One')).toBeInTheDocument();

    await openSwapDrawer();
    await userEvent.click(screen.getAllByRole('button', { name: 'Two' })[0]);
    expect(within(exportRoot()).getByText('Actor Two')).toBeInTheDocument();

    const directorButtons = screen.getAllByRole('button', { name: 'Two' });
    await userEvent.click(directorButtons[1]);
    expect(within(exportRoot()).getByText('Director Two')).toBeInTheDocument();
  });

  it('resets stale selected indexes when fresh share data arrives', async () => {
    const { rerender } = renderShareModal();

    await openSwapDrawer();
    await userEvent.click(screen.getAllByRole('button', { name: 'Two' })[0]);
    expect(within(exportRoot()).getByText('Actor Two')).toBeInTheDocument();

    const nextData: ShareCardData = {
      ...baseData,
      onScreenCrush: { name: 'Actor Three', headshotUrl: '/tmdb-proxy/t/p/w300/a3.jpg', count: 6 },
      favoriteDirector: { name: 'Director Three', headshotUrl: '/tmdb-proxy/t/p/w300/d3.jpg', count: 7 },
      topActors: [
        { name: 'Actor Three', headshotUrl: '/tmdb-proxy/t/p/w300/a3.jpg', count: 6 },
        { name: 'Actor Four', headshotUrl: '/tmdb-proxy/t/p/w300/a4.jpg', count: 1 },
      ],
      topDirectors: [
        { name: 'Director Three', headshotUrl: '/tmdb-proxy/t/p/w300/d3.jpg', count: 7 },
        { name: 'Director Four', headshotUrl: '/tmdb-proxy/t/p/w300/d4.jpg', count: 1 },
      ],
    };

    rerender(
      <I18nProvider locale="en"><ShareModal
        open
        onClose={() => {}}
        orientation="horizontal"
        setOrientation={() => {}}
        cardProps={nextData}
      /></I18nProvider>,
    );

    expect(within(exportRoot()).getByText('Actor Three')).toBeInTheDocument();
    expect(within(exportRoot()).getByText('Director Three')).toBeInTheDocument();
  });
});

describe('ShareModal review words', () => {
  it('renders the top review words in vertical share cards when available', () => {
    renderShareModal(baseData, 'vertical');

    const root = within(exportRoot());
    expect(root.getByText(/review words/i)).toBeInTheDocument();
    expect(root.getByText('dreamlike / lonely / funny')).toBeInTheDocument();
  });

  it('keeps the original metric when review words are unavailable', () => {
    renderShareModal({ ...baseData, topReviewWords: undefined }, 'vertical');

    const root = within(exportRoot());
    expect(root.queryByText(/review words/i)).not.toBeInTheDocument();
    expect(root.getByText(/peak decade/i)).toBeInTheDocument();
  });
});

describe('share registry and privacy', () => {
  it('maps the four landscape and three portrait sketches to distinct compositions', () => {
    expect(SHARE_VARIANTS.map(({ labelKey, orientation }) => [labelKey, orientation])).toEqual([
      ['share.variant.default', 'horizontal'],
      ['share.variant.appleHig', 'horizontal'],
      ['share.variant.editorial', 'horizontal'],
      ['share.variant.variant3', 'horizontal'],
      ['share.variant.doubleFeature', 'vertical'],
      ['share.variant.contactSheet', 'vertical'],
      ['share.variant.admitOne', 'vertical'],
    ]);
    const label = (key: string) => key;
    expect(shareVariantsForOrientation('horizontal', label)).toHaveLength(4);
    expect(shareVariantsForOrientation('vertical', label)).toHaveLength(3);
  });

  it('keeps format choices and tuning in one ordered control row', () => {
    renderShareModal();
    const controls = screen.getByRole('group', { name: /share format and people/i });
    const story = within(controls).getByRole('button', { name: /story/i }) as HTMLButtonElement;
    const landscape = within(controls).getByRole('button', { name: /landscape/i }) as HTMLButtonElement;
    const tune = within(controls).getByRole('button', { name: /tune actor/i }) as HTMLButtonElement;

    expect(controls).toContainElement(story);
    expect(controls).toContainElement(landscape);
    expect(controls).toContainElement(tune);
    const orderedButtons = Array.from(controls.querySelectorAll<HTMLButtonElement>('button'));
    expect(orderedButtons.indexOf(story)).toBeLessThan(orderedButtons.indexOf(landscape));
    expect(orderedButtons.indexOf(landscape)).toBeLessThan(orderedButtons.indexOf(tune));
  });

  it('normalizes a missing director without dropping film slots', () => {
    const normalized = normalizeShareCardData({
      ...baseData,
      favoriteDirector: null,
      topFilms: Array.from({ length: 6 }, (_, index) => ({
        title: `Film ${index}`,
        year: '2026',
        posterPath: null,
      })),
    });
    expect(normalized.favoriteDirector).toEqual({
      name: '',
      headshotUrl: '',
      count: 0,
    });
    expect(normalized.topFilms).toHaveLength(5);
  });

  it('hides the username on every rendered card and resets on reopen', async () => {
    const props = { ...baseData, username: 'long-letterboxd-name' };
    const { rerender } = renderShareModal(props);
    expect(within(exportRoot()).getByText('@long-letterboxd-name')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('switch', { name: /show username/i }));
    expect(within(exportRoot()).queryByText('@long-letterboxd-name')).not.toBeInTheDocument();

    rerender(<I18nProvider locale="en"><ShareModal open={false} onClose={() => {}} orientation="horizontal" setOrientation={() => {}} cardProps={props} /></I18nProvider>);
    rerender(<I18nProvider locale="en"><ShareModal open onClose={() => {}} orientation="horizontal" setOrientation={() => {}} cardProps={props} /></I18nProvider>);
    expect(within(exportRoot()).getByText('@long-letterboxd-name')).toBeInTheDocument();
  });
});

describe('shareSafeUrl', () => {
  it('converts direct TMDB image URLs to backend proxy URLs for canvas export', () => {
    expect(shareSafeUrl('https://image.tmdb.org/t/p/w500/person.jpg')).toBe(
      'http://localhost:8000/tmdb-proxy/t/p/w500/person.jpg',
    );
  });
});

function pngBlob(width: number, height: number) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return new Blob([bytes], { type: 'image/png' });
}

describe('ShareModal export outcomes', () => {
  it('treats a cancelled system share as cancellation, not success', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
    vi.stubGlobal('navigator', {
      userAgent: 'iPhone',
      platform: 'iPhone',
      maxTouchPoints: 1,
      canShare: () => true,
      share,
    });
    vi.mocked(toBlob).mockResolvedValue(pngBlob(2400, 1350));
    const onDownloadSuccess = vi.fn();

    render(
      <I18nProvider locale="en"><ShareModal
        open
        onClose={() => {}}
        orientation="horizontal"
        setOrientation={() => {}}
        cardProps={baseData}
        onDownloadSuccess={onDownloadSuccess}
      /></I18nProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: /share or save png/i }));

    await waitFor(() => {
      expect(trackEvent).toHaveBeenCalledWith(
        'share_export_cancelled',
        expect.objectContaining({ method: 'system_share' }),
      );
    });
    expect(vi.mocked(trackEvent).mock.calls.some(([name]) => name === 'share_export_succeeded')).toBe(false);
    expect(onDownloadSuccess).not.toHaveBeenCalled();
  });

  it('shows a retryable error and records a failed export', async () => {
    vi.mocked(toBlob).mockRejectedValue(new Error('canvas allocation failed'));
    renderShareModal();

    await userEvent.click(screen.getByRole('button', { name: /share or save png/i }));

    expect(await screen.findByRole('alert', {}, { timeout: 3_000 })).toHaveTextContent(
      'Could not export this card. Try again.',
    );
    expect(trackEvent).toHaveBeenCalledWith(
      'share_export_failed',
      expect.objectContaining({ reason: 'Error' }),
    );
  });
});

describe('exact intended exports', () => {
  it.each(SHARE_VARIANTS)('keeps $label at its exact low-memory output size', async ({ key, orientation }) => {
    Object.defineProperty(navigator, 'deviceMemory', { configurable: true, value: 1 });
    const expected = orientation === 'horizontal'
      ? { width: 2400, height: 1350, pixelRatio: 2 }
      : { width: 1350, height: 2400, pixelRatio: 2 };
    vi.mocked(toBlob).mockResolvedValueOnce(pngBlob(expected.width, expected.height));
    const rendered = render(
      <I18nProvider locale="en">
        <ShareVariantRenderer variant={key} data={baseData} orientation={orientation} />
      </I18nProvider>,
    );
    const root = rendered.container.querySelector<HTMLElement>('[data-export-root="true"]');
    expect(root, `${key} must expose an export root`).not.toBeNull();

    const blob = await exportExactPng(root!, orientation, '#000');

    expect(await readPngDimensions(blob)).toEqual({
      width: expected.width,
      height: expected.height,
    });
    expect(toBlob).toHaveBeenLastCalledWith(root, expect.objectContaining({
      width: SHARE_EXPORT_CONFIG[orientation].domWidth,
      height: SHARE_EXPORT_CONFIG[orientation].domHeight,
      pixelRatio: expected.pixelRatio,
    }));
    rendered.unmount();
  });
});

describe.each([
  ['horizontal', 2400, 1350, 2],
  ['vertical', 1350, 2400, 2],
] as const)('exact %s export', (orientation, width, height, pixelRatio) => {

  it('retries failures and wrong-sized blobs without lowering quality', async () => {
    vi.mocked(toBlob)
      .mockRejectedValueOnce(new Error('canvas allocation failed'))
      .mockResolvedValueOnce(pngBlob(1, 1))
      .mockResolvedValueOnce(pngBlob(width, height));

    await expect(exportExactPng(document.createElement('div'), orientation, '#000')).resolves.toBeInstanceOf(Blob);
    expect(vi.mocked(toBlob).mock.calls.slice(-3).map(([, options]) => options?.pixelRatio)).toEqual([
      pixelRatio,
      pixelRatio,
      pixelRatio,
    ]);
  });
});

describe('seven composition content contracts', () => {
  it.each(SHARE_VARIANTS)('renders core information in $label', ({ key, orientation }) => {
    const { container } = render(
      <I18nProvider locale="en">
        <ShareVariantRenderer variant={key} data={baseData} orientation={orientation} />
      </I18nProvider>,
    );

    expect(container.textContent).toContain('movieswrapped.com');
    expect(container.textContent).toContain('2026');
    expect(container.textContent).toContain('120');
    expect(container.textContent).toContain('42');
    expect(container.textContent).toContain('9');
    expect(container.textContent).toContain('72');
    expect(container.textContent).toContain('Actor One');
    expect(container.textContent).toContain('Director One');
    expect(container.textContent).toContain('Bilim Kurgu');
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });
});

