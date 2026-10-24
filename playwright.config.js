import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/browser',
  testMatch: '*.test.js',
  globalSetup: './test/browser/setup.js',
  timeout: 60000,
  fullyParallel: true,
  workers: '100%',
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    viewport: { width: 1440, height: 900 },
    // why: a trace with snapshots copies the whole document before and after every action, which takes about a second on a long article and was most of the time of its tests
    trace: { mode: 'retain-on-failure', snapshots: false },
  },
  outputDir: 'test-out/playwright',
});
