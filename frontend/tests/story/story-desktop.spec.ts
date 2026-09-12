import { expect, test, type Page } from '@playwright/test';

const STATS = {
  scraped_username: 'semihmutsuz',
  total_films: 692,
  days_watched: 61,
  average_rating: 3.44,
  total_countries: 56,
  favorite_genre: { name: 'Drama', count: 301 },
  most_watched_director: { name: 'Denis Villeneuve', count: 9 },
  sinefil_meter: { score: 68, type: 'Explorer' },
  cinematic_persona: { persona: 'Emotional Masochist', description: 'You seek out what hurts.' },
  all_films: [
    { title: 'Arrival', poster_path: '/demo/arrival.jpg', rating: 5, genres: ['Drama'] },
    { title: 'Dune', poster_path: '/demo/dune.jpg', rating: 5, director: 'Denis Villeneuve' },
  ],
};

const SLIDE_SETTLE_MS = 750;

async function acceptAnalytics(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('consent_decision', 'accept');
  });
}

async function dismissDevOverlay(page: Page) {
  await page.evaluate(() => {
    document.querySelectorAll('nextjs-portal').forEach((node) => node.remove());
  }).catch(() => undefined);
}

async function seedStats(page: Page) {
  await acceptAnalytics(page);
  await page.addInitScript((stats) => {
    sessionStorage.setItem('letterboxdStats', JSON.stringify(stats));
  }, STATS);
}

test.use({ viewport: { width: 1440, height: 900 } });

test('desktop story plays seeded stats without the phone gate', async ({ page }) => {
  await seedStats(page);
  await page.goto('/en/story');

  await expect(page.getByText('@semihmutsuz')).toBeVisible();
  await expect(page.getByTestId('story-progress-bar')).toBeVisible();
  await expect(page.getByTestId('story-poster-field')).toBeVisible();
  await expect(page.getByLabel('Next slide')).toBeVisible();
  await expect(page.getByTestId('desktop-required-story')).toBeHidden();
  await expect(page.getByText(/tap to continue/i)).toHaveCount(0);
});

test('desktop story reaches the landscape finale', async ({ page }) => {
  await seedStats(page);
  await page.goto('/en/story');
  await expect(page.getByText('@semihmutsuz')).toBeVisible();

  const next = page.getByLabel('Next slide');
  for (let i = 0; i < 14; i += 1) {
    if (await page.getByRole('link', { name: /open the dossier/i }).isVisible()) break;
    await page.waitForTimeout(2100);
    if (await next.isVisible()) await next.click();
  }

  await expect(page.getByRole('link', { name: /open the dossier/i })).toBeVisible();
  await expect(page.locator('[data-finale-orientation]')).toHaveAttribute('data-finale-orientation', 'horizontal');
  await expect(page.getByTestId('story-poster-field')).toBeVisible();
});

test('/smt seeds the real fixture into the desktop story', async ({ page }) => {
  await acceptAnalytics(page);
  await page.goto('/smt');
  await page.waitForURL(/\/en\/story/, { timeout: 30_000 });
  await expect(page.getByTestId('story-progress-bar')).toBeVisible();
  await expect(page.getByTestId('desktop-required-story')).toBeHidden();
  await expect(page.getByTestId('story-poster-field')).toBeVisible();
});

test.describe('phone handoff', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  test('landing asks the visitor to continue on desktop', async ({ page }) => {
    await acceptAnalytics(page);
    await page.goto('/en');
    await expect(page.getByTestId('desktop-required-landing')).toBeVisible();
    await expect(page.getByRole('button', { name: /copy this page/i })).toBeVisible();
    await expect(page.getByTestId('upload-drop-zone')).toHaveCount(0);
  });
});

test.describe('narrow desktop window', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('landing keeps drag-and-drop upload', async ({ page }) => {
    await acceptAnalytics(page);
    await page.goto('/en');
    await expect(page.getByTestId('upload-drop-zone')).toBeVisible();
    await expect(page.getByTestId('desktop-required-landing')).toHaveCount(0);
  });

  test('story still plays in a narrow desktop window', async ({ page }) => {
    await acceptAnalytics(page);
    await page.goto('/smt');
    await page.waitForURL(/\/en\/story/, { timeout: 30_000 });
    await expect(page.getByTestId('story-progress-bar')).toBeVisible();
    await expect(page.getByTestId('desktop-required-story')).toHaveCount(0);
  });
});

test.describe('phone story gate', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });

  test('story does not play on a phone UA', async ({ page }) => {
    await acceptAnalytics(page);
    await page.goto('/smt');
    await page.waitForURL(/\/en\/story/, { timeout: 30_000 });
    await expect(page.getByTestId('desktop-required-story')).toBeVisible();
    await expect(page.getByTestId('story-progress-bar')).toHaveCount(0);
  });
});

test('locale switch keeps the current slide', async ({ page }) => {
  await acceptAnalytics(page);
  await page.goto('/smt');
  await page.waitForURL(/\/en\/story/, { timeout: 30_000 });
  await dismissDevOverlay(page);
  await page.getByLabel('Pause story').click();
  await page.getByLabel('Next slide').click();
  await expect(page.getByText('711 films')).toBeVisible();
  await expect(page.getByLabel('Turkish')).toHaveText('TR');
  await page.getByLabel('Turkish').click({ force: true });
  await page.waitForURL(/\/tr\/story/, { timeout: 20_000 });
  await expect(page.getByTestId('story-slide-stage')).toHaveAttribute('data-story-key', 'volume');
  await expect(page.getByText('711 film')).toBeVisible();
});

test('paused skip shows the settled director copy', async ({ page }) => {
  await acceptAnalytics(page);
  await page.goto('/smt');
  await page.waitForURL(/\/en\/story/, { timeout: 30_000 });
  await dismissDevOverlay(page);
  await page.getByLabel('Pause story').click();
  const next = page.getByLabel('Next slide');
  for (let i = 0; i < 4; i += 1) await next.click();
  await expect(page.getByTestId('story-slide-stage')).toHaveAttribute('data-story-key', 'director');
  await expect(page.getByText(/most-watched director/i)).toBeVisible();
  await expect(page.getByText('Woody Allen')).toBeVisible();
});

test('finale keeps Woody as crush and Scorsese as director', async ({ page }) => {
  await acceptAnalytics(page);
  await page.goto('/smt');
  await page.waitForURL(/\/en\/story/, { timeout: 30_000 });
  await dismissDevOverlay(page);
  await page.getByLabel('Pause story').click();
  const next = page.getByLabel('Next slide');
  for (let i = 0; i < 16; i += 1) {
    if ((await page.getByTestId('story-slide-stage').getAttribute('data-story-last')) === 'true') break;
    await next.click();
  }
  await expect(page.getByTestId('story-finale-card')).toBeVisible();
  await expect(page.getByText('Woody Allen').first()).toBeVisible();
  await expect(page.getByText('Martin Scorsese').first()).toBeVisible();
  await expect(page.locator('[data-finale-orientation]')).toHaveAttribute('data-finale-orientation', 'horizontal');
});

async function walkFixtureSlides(page: Page, options: { screenshotDir?: string } = {}) {
  await dismissDevOverlay(page);
  await expect(page.getByTestId('story-slide-stage')).toBeVisible();
  await page.getByLabel('Pause story').click();

  const count = Number(await page.getByTestId('story-progress-bar').getAttribute('data-story-progress-count'));
  expect(count).toBeGreaterThan(6);

  const next = page.getByLabel('Next slide');
  const keys: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const stage = page.getByTestId('story-slide-stage');
    await expect(stage).toBeVisible();
    const key = await stage.getAttribute('data-story-key');
    keys.push(key ?? `unknown-${i}`);
    await page.waitForTimeout(SLIDE_SETTLE_MS);
    await expect(page.getByText(/tap to continue/i)).toHaveCount(0);
    if (key === 'rhythm') await expect(page.getByText('February 2026')).toBeVisible();
    if (key === 'director') await expect(page.getByText(/most-watched director/i)).toBeVisible();
    if (key === 'actor') await expect(page.getByText(/same person, other credit/i)).toBeVisible();
    if (key === 'sinefil') await expect(page.getByText(/you're an Eclectic Viewer/i)).toBeVisible();
    if (options.screenshotDir) {
      await page.screenshot({ path: `${options.screenshotDir}/${String(i).padStart(2, '0')}-${key}.png` });
    }
    const box = await stage.evaluate((element) => ({
      key: element.getAttribute('data-story-key'),
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    }));
    expect(box.scrollWidth, JSON.stringify(box)).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(box.scrollHeight, JSON.stringify(box)).toBeLessThanOrEqual(box.clientHeight + 1);

    if (i === count - 1) break;
    await next.click();
    await expect(stage).not.toHaveAttribute('data-story-key', key ?? '');
  }
  expect(keys).toContain('intro');
  expect(keys).toContain('outro');
}

test('real fixture slides fit the desktop frame', async ({ page }) => {
  await acceptAnalytics(page);
  await page.goto('/smt');
  await page.waitForURL(/\/en\/story/, { timeout: 30_000 });
  await dismissDevOverlay(page);
  await walkFixtureSlides(page, { screenshotDir: '/tmp/mw-story-slides' });
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1920, height: 1080 },
] as const) {
  test.describe(`${viewport.width}px story`, () => {
    test.use({ viewport });

    test(`real fixture slides fit ${viewport.width}×${viewport.height}`, async ({ page }) => {
      await acceptAnalytics(page);
      await page.goto('/smt');
      await page.waitForURL(/\/en\/story/, { timeout: 30_000 });
      await dismissDevOverlay(page);
      await walkFixtureSlides(page);
    });
  });
}
