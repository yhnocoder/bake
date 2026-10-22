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
    trace: 'retain-on-failure',
  },
  outputDir: 'test-out/playwright',
});
