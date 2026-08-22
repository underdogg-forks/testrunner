const { defineConfig } = require('@playwright/test');

// form-db-gaps.spec.js deliberately lives at the project root, not inside
// tests-playwright/ (which is blanket-gitignored disposable scan output —
// see .gitignore and AGENTS.md). Playwright only discovers spec files
// inside its configured testDir, even when given an explicit path, so this
// permanent regression test needs its own minimal config rather than
// playwright.config.js's testDir: tests-playwright.
//
// The mind-the-gap-again required-field tests that used to live here
// (required-field-omission.spec.js) moved to the real app's own suite —
// Modules/<Name>/Tests/E2E/required-fields.spec.js in ivplv2 — since they
// mirror specific PHPUnit tests and belong alongside them, not in this
// tool. This config only covers the structural form/DB audit now.
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
