const { defineConfig } = require('@playwright/test');

// form-db-gaps.spec.js deliberately lives at the project root, not inside
// tests-playwright/ (which is blanket-gitignored disposable scan output —
// see .gitignore and AGENTS.md). Playwright only discovers spec files
// inside its configured testDir, even when given an explicit path, so this
// permanent regression test needs its own minimal config rather than
// playwright.config.js's testDir: tests-playwright.
module.exports = defineConfig({
  testDir: __dirname,
  testMatch: 'form-db-gaps.spec.js',
  timeout: 60000,
  reporter: 'line',
  use: {
    headless: process.env.HEADLESS !== 'false',
    baseURL: process.env.APP_URL || undefined,
  },
});
