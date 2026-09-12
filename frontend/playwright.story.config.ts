import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/story',
  testIgnore: 'share-proto.spec.ts',
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:3010',
    ...devices['Desktop Chrome'],
    channel: 'chromium',
  },
  webServer: {
    command: 'npx next dev --turbopack --hostname 127.0.0.1 --port 3010',
    url: 'http://127.0.0.1:3010/smt',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
