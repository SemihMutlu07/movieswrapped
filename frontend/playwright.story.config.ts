import { defineConfig, devices } from '@playwright/test';

// Port 3010 is the long-lived mw-story dev server. Reusing it would report a
// pass against whichever checkout happens to own that port. This suite always
// boots the checkout that launched it.
const STORY_PORT = 3012;

export default defineConfig({
  testDir: './tests/story',
  testIgnore: 'share-proto.spec.ts',
  timeout: 90_000,
  use: {
    baseURL: `http://127.0.0.1:${STORY_PORT}`,
    ...devices['Desktop Chrome'],
    channel: 'chromium',
  },
  webServer: {
    command: `npx next dev --turbopack --hostname 127.0.0.1 --port ${STORY_PORT}`,
    url: `http://127.0.0.1:${STORY_PORT}/smt`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
