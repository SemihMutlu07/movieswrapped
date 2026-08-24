import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { SHARE_VARIANTS } from '../../src/components/share/registry';

const orientations = ['horizontal', 'vertical'] as const;
const fixtures = ['baseline', 'stress'] as const;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function pngDimensions(file: string) {
  const bytes = fs.readFileSync(file);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

async function waitForCardAssets(page: import('@playwright/test').Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(Array.from(document.images).map(async (image) => {
      if (!image.complete) {
        await new Promise<void>((resolve) => {
          image.addEventListener('load', () => resolve(), { once: true });
          image.addEventListener('error', () => resolve(), { once: true });
        });
      }
      await image.decode().catch(() => undefined);
    }));
  });
}

test.beforeEach(async ({ page }) => {
  await page.route('**/tmdb-proxy/**', async (route) => {
    if (route.request().url().includes('broken')) return route.fulfill({ status: 404 });
    const fileName = path.basename(new URL(route.request().url()).pathname);
    const fixturePath = path.resolve('tests', 'share-cards', 'assets', fileName);
    await route.fulfill({
      contentType: 'image/png',
      headers: { 'access-control-allow-origin': '*' },
      body: fs.readFileSync(fixturePath),
    });
  });
});

for (const { key, orientation } of SHARE_VARIANTS) {
  test(`${key} ${orientation} baseline and stress stay inside the export root`, async ({ page }, testInfo) => {
    for (const fixture of fixtures) {
      await page.goto(`/dev/share-cards?variant=${key}&orientation=${orientation}&fixture=${fixture}`);
      const harness = page.locator('#share-card-harness');
      await expect(harness).toHaveAttribute('data-fixture', fixture);
      await expect(harness).toHaveAttribute('data-orientation', orientation);
      await expect(harness).toHaveAttribute('data-variant', key);
      const root = page.locator('[data-export-root="true"]');
      await expect(root).toBeVisible();
      await waitForCardAssets(page);
      const overflow = await root.evaluate((element) => ({
        width: element.clientWidth,
        height: element.clientHeight,
        scrollWidth: element.scrollWidth,
        scrollHeight: element.scrollHeight,
        offenders: Array.from(element.querySelectorAll<HTMLElement>('*'))
          .filter((child) => child.getBoundingClientRect().right > element.getBoundingClientRect().right)
          .slice(0, 3)
          .map((child) => ({ tag: child.tagName, className: child.className, right: child.getBoundingClientRect().right })),
      }));
      expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(overflow.width);
      expect(overflow.scrollHeight).toBeLessThanOrEqual(overflow.height);
    }

    await page.goto(`/dev/share-cards?variant=${key}&orientation=${orientation}&fixture=baseline`);
    const harness = page.locator('#share-card-harness');
    await expect(harness).toHaveAttribute('data-fixture', 'baseline');
    await expect(harness).toHaveAttribute('data-orientation', orientation);
    await expect(harness).toHaveAttribute('data-variant', key);
    await waitForCardAssets(page);
    const downloadPromise = page.waitForEvent('download');
    await page.getByTestId('export').click();
    await page.waitForFunction(() => document.body.dataset.exportStatus !== 'running');
    const exportStatus = await page.locator('body').getAttribute('data-export-status');
    expect(exportStatus).toBe('complete');
    const download = await downloadPromise;
    const file = path.join(testInfo.outputDir, `${key}-${orientation}.png`);
    await download.saveAs(file);
    const bytes = fs.readFileSync(file);
    expect(bytes.subarray(0, pngSignature.length)).toEqual(pngSignature);
    expect(pngDimensions(file)).toEqual(orientation === 'horizontal'
      ? { width: 2400, height: 1350 }
      : { width: 1350, height: 2400 });
    if (process.env.UPDATE_SHARE_SCREENSHOTS === '1') {
      const index = SHARE_VARIANTS.findIndex(({ key: variantKey }) => variantKey === key) + 1;
      const suffix = orientation === 'horizontal' ? 'twitter-2400x1350' : 'story-1350x2400';
      const destination = path.resolve('..', '_screenshots', 'share-cards', `${String(index).padStart(2, '0')}-${key}--${suffix}.png`);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(file, destination);
    }
  });
}
