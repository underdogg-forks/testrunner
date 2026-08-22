/**
 * mind-the-gap: frontend form/DB constraint audit.
 *
 * Permanent regression gate (not a generated snapshot) — companion to the
 * Laravel app's Modules/Core/Tests/Feature/FormDbConstraintAuditTest.php.
 * That test checks the live server-side Filament form schema against real
 * DB columns; this spec checks the actually-rendered DOM against the same
 * DB columns, catching drift the server-side check can't see (a Blade
 * override, an attribute stripped by JS, a field that silently isn't
 * rendered at all).
 *
 * Requires schema.json (regenerate via `make export-schema`, which runs
 * `php artisan mind-the-gap:export-schema` in the Laravel app).
 */
import { test, expect } from '@playwright/test';
import { loadSchema, auditResource } from './find-form-gaps.js';

const APP_URL = process.env.APP_URL || 'http://ip2.test';
const SCHEMA_JSON = process.env.SCHEMA_JSON || 'schema.json';
const TENANT_SLUG = process.env.TENANT_SLUG || 'ivplv2';
const CREATE_BUTTON_PATTERN = /^(New|Add)\s/i;

let schema;

try {
  schema = loadSchema(SCHEMA_JSON);
} catch (error) {
  schema = { resources: [], knownGaps: {} };
  test('schema.json is missing or invalid — run `make export-schema` first', () => {
    throw error;
  });
}

for (const resource of schema.resources || []) {
  test.describe(`mind-the-gap: ${resource.panel} / ${resource.slug}`, () => {
    // 90s, not the config's 60s default: this spec logs in fresh once per
    // resource (20+ times in one run), serially, against an app whose
    // php-fpm has Xdebug's per-request connection overhead always on — the
    // same load profile documented in playwright.config.js and CLAUDE.md's
    // #689 note. A 60s *inner* waitForURL below is meaningless if the
    // *outer* per-test timeout is also 60s; give it real headroom instead.
    test.setTimeout(90000);

    // Confirmed across 3 consecutive full runs: every resource that reaches
    // the actual DOM-vs-schema comparison passes deterministically; 1-2
    // *different*, non-deterministic resources per run fail purely in the
    // login beforeEach (60s waitForURL) under the load of ~20 fresh serial
    // logins against this app's always-on Xdebug overhead — never the
    // comparison itself. Same profile as issue #689 (see CLAUDE.md). Retry
    // absorbs that login flake without masking a real violation: a genuine
    // schema mismatch is deterministic and still fails after retry.
    test.describe.configure({ retries: 2 });

    test.beforeEach(async ({ page }) => {
      await page.goto(`${APP_URL}/login`);
      if (!page.url().includes('/login')) return;
      await page.fill('input[name="email"], input[type="email"], input#email', process.env.E2E_EMAIL);
      await page.fill('input[name="password"], input[type="password"], input#password', process.env.E2E_PASSWORD);
      await Promise.all([
        page.waitForURL((u) => !String(u).includes('/login'), { timeout: 60000 }),
        page.click('button[type="submit"], input[type="submit"], button:has-text("Login")'),
      ]);
    });

    test(`rendered create-form fields match DB constraints (${resource.table})`, async ({ page }) => {
      const { violations, skippedReason } = await auditResource(page, resource, {
        baseUrl: APP_URL,
        tenantSlug: TENANT_SLUG,
        createButtonPattern: CREATE_BUTTON_PATTERN,
        knownGaps: schema.knownGaps || {},
      });

      if (skippedReason) {
        test.info().annotations.push({ type: 'skipped-reason', description: skippedReason });
        return;
      }

      expect(violations, violations.join('\n')).toEqual([]);
    });
  });
}
