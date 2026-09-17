import { expect, test, type Page } from '@playwright/test';

const sizes = [
  { width: 1440, height: 900 },
  { width: 1280, height: 600 },
  { width: 1024, height: 600 },
  { width: 390, height: 844 },
] as const;

const transitions = [
  ['genre', 'director', 1200],
  ['rating-personality', 'review-personality', 3300],
  ['persona', 'outro', 2800],
] as const;

async function boot(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem('consent_decision', 'reject'));
  await page.goto('/smt');
  await page.waitForURL(/\/en\/story/);
  await expect(page.getByTestId('story-slide-stage')).toBeVisible({ timeout: 30_000 });
  await page.getByLabel('Pause story').click();
}

async function clipState(page: Page) {
  return page.evaluate(() => {
    const stage = document.querySelector('[data-testid="story-slide-stage"]');
    const root = stage?.querySelector('[data-testid="story-finale-card"]') ?? stage;
    const nodes = [...(root?.querySelectorAll('p,h1,h2,h3,a,button') ?? [])];
    const visible = nodes.filter((el) => {
      const box = el.getBoundingClientRect();
      return Boolean((el.textContent ?? '').trim()) && box.width > 0 && box.height > 0 && Number(getComputedStyle(el).opacity) > 0.01;
    });
    const clipped: string[] = [];
    for (const el of nodes) {
      const box = el.getBoundingClientRect();
      if (!(el.textContent ?? '').trim() || !box.width || !box.height) continue;
      let parent = el.parentElement;
      while (parent && parent !== stage) {
        const style = getComputedStyle(parent);
        if (/hidden|clip/.test(style.overflow + style.overflowX + style.overflowY)) {
          const bounds = parent.getBoundingClientRect();
          const outside = box.left < bounds.left - 1 || box.right > bounds.right + 1 || box.top < bounds.top - 1 || box.bottom > bounds.bottom + 1;
          if (outside) clipped.push((el.textContent ?? '').trim().slice(0, 30));
        }
        parent = parent.parentElement;
      }
    }
    return {
      key: stage?.getAttribute('data-story-key'),
      text: visible.map((el) => (el.textContent ?? '').trim().slice(0, 80)),
      clipped,
    };
  });
}

async function toKey(page: Page, key: string) {
  const count = Number(await page.getByTestId('story-progress-bar').getAttribute('data-story-progress-count'));
  for (let i = 0; i < count; i += 1) {
    if ((await page.getByTestId('story-slide-stage').getAttribute('data-story-key')) === key) return;
    await page.getByLabel('Next slide').click();
  }
  throw new Error(`target ${key} not reached`);
}

for (const size of sizes) {
  for (const [previous, target, duration] of transitions) {
    test(`${previous} → ${target} stays readable during resize ${size.width}×${size.height}`, async ({ page }) => {
      await boot(page);
      await toKey(page, previous);
      await expect(page.getByTestId('story-slide-stage')).toHaveAttribute('data-story-key', previous);
      await page.getByLabel('Resume story').click();
      await page.getByLabel('Next slide').click();
      await expect(page.getByTestId('story-slide-stage')).toHaveAttribute('data-story-key', target, { timeout: 10_000 });

      await page.setViewportSize(size);
      const during = await clipState(page);
      expect(during.key).toBe(target);
      expect(during.text.length).toBeGreaterThan(0);
      expect(during.clipped).toEqual([]);

      await page.waitForTimeout(duration);
      const settled = await clipState(page);
      expect(settled.key).toBe(target);
      expect(settled.text.length).toBeGreaterThan(0);
      expect(settled.clipped).toEqual([]);
    });
  }
}
