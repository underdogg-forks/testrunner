# Playwright test recorder and generator

This repository contains scripts to:

- record manual browser interactions,
- generate Playwright/PHPUnit tests from recordings,
- generate Playwright specs from Laravel route inventory,
- run an advanced login-aware traversal that follows links, fills forms, and reports untouched routes.

## Install

```bash
npm install
npx playwright install chromium
```

## Recommended Laravel workflow

Export route inventory:

```bash
php artisan route:list --json > routes.json
```

Generate Playwright specs directly from known routes:

```bash
APP_URL=http://localhost:8000 ROUTES_JSON=routes.json npm run generate:playwright:routes
```

## Automatic traversal from routes.json

Run:

```bash
npm run generate:playwright:auto
```

Equivalent commands:

- `npm run advanced.js` (legacy alias)
- `npm run advanced-generation`
- `npm run adavanced-generation` (compatibility alias)

What it does:

1. Logs in with Playwright.
2. Navigates to dashboard (`/dashboard` by default).
3. Loads links from pages and matches coverage against `routes.json`.
4. Follows discovered internal links and records them.
5. Fills forms with dummy data and tries submit actions.
6. Generates:
   - `recordings/e2e-session-*.json`
   - `tests-playwright/advanced-generated-*.spec.js`
   - `tests-playwright/advanced-generated-per-link-*.spec.js` (one test per touched route/link)
7. Writes errors to:
   - `storage/logs/e2e-recording.log`
8. Writes untouched route checklist to:
   - `todo.txt`

## Manual recording workflow

```bash
npm run record
```

This is manual recording only. It records what you click/type and does not auto-crawl routes.

Output:

- `recordings/session-*.json`
- `storage/logs/console.log`

Convert manual recordings:

```bash
npm run convert:playwright recordings/session-<timestamp>.json
npm run convert:phpunit recordings/session-<timestamp>.json
```

Replay a recording:

```bash
npm run playback recordings/session-<timestamp>.json
```

## Script reference

- `advanced-recording.js` → `npm run record`
- `advanced-generation.js` → `npm run generate:playwright:auto`
- `generate-playwright-from-routes.js` → `npm run generate:playwright:routes`
- `discover-routes.js` → `npm run discover`
- `discover-phpunit.js`
- `convert-to-playwright.js` → `npm run convert:playwright <recording.json>`
- `convert-to-phpunit.js` → `npm run convert:phpunit <recording.json>`
- `playback.js` → `npm run playback <recording.json>`
- `record-routes.js` (legacy lightweight click recorder)
- `utils.js` (shared helpers)

## Configuration

Common variables:

- `APP_URL` (`BASE_URL` alias; default: `http://localhost:3000`)
- `ROUTES_JSON` (`ROUTES_FILE` alias; required for route-inventory workflows)
- `LOGIN_PATH` (`LOGIN_URL` alias; default: `/login`)
- `DASHBOARD_PATH` (`DASHBOARD_URL` alias; default: `/dashboard`)
- `E2E_EMAIL` (`TEST_EMAIL` alias)
- `E2E_PASSWORD` (`TEST_PASSWORD` alias)
- `HEADLESS` (`true`/`false`)
- `MAX_LINKS_PER_PAGE` (default: `250`)

The script loads variables from `.env` automatically if the file exists.

Recommended `.env` for authenticated traversal:

```dotenv
APP_URL=http://localhost:8000
ROUTES_JSON=routes.json
LOGIN_PATH=/login
DASHBOARD_PATH=/dashboard
E2E_EMAIL=admin@example.com
E2E_PASSWORD=secret
```

Then run:

```bash
npm run generate:playwright:auto
```

Manual recorder variables:

- `START_URL`
- `MAX_DURATION`
- `RECORD_NETWORK`
- `CAPTURE_SCREENSHOTS`
