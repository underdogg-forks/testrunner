const { defineConfig } = require('@playwright/test');

// Minimal config so `make test` / `npx playwright test` can find the specs
// this tool generates into E2E_TESTS_DIR (tests-playwright/ by default).
// Without this file Playwright falls back to a `tests/` directory that
// doesn't exist here, and every run reports "No tests found".
module.exports = defineConfig({
  testDir: process.env.E2E_TESTS_DIR || 'tests-playwright',
  // Every PHP request here pays Xdebug step-debug connection overhead (the
  // dev container has it enabled), so login under sustained serial load can
  // occasionally exceed 30s. 60s cut flaky login timeouts to zero in testing.
  timeout: 60000,
  // Generated specs log in as the same seeded E2E user repeatedly; running
  // fully parallel floods php-fpm with concurrent logins for one account and
  // times out under load. Default (serial within a file) avoids that
  // contention.
  reporter: 'line',
  use: {
    headless: process.env.HEADLESS !== 'false',
    baseURL: process.env.APP_URL || undefined,
  },
});
