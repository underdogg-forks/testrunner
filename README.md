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
BASE_URL=http://localhost:8000 ROUTES_FILE=routes.json npm run generate:playwright:routes
```

## Advanced automatic traversal from routes.json

Run:

```bash
BASE_URL=http://localhost:8000 ROUTES_FILE=routes.json npm run advanced.js
```

Equivalent commands:

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
- `advanced-generation.js` → `npm run advanced.js`
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

- `BASE_URL` (default: `http://localhost:3000`)
- `ROUTES_FILE` (required for route-inventory workflows)
- `LOGIN_URL` (default: `/login`)
- `DASHBOARD_URL` (default: `/dashboard`)
- `TEST_EMAIL`
- `TEST_PASSWORD`
- `HEADLESS` (`true`/`false`)

Manual recorder variables:

- `START_URL`
- `MAX_DURATION`
- `RECORD_NETWORK`
- `CAPTURE_SCREENSHOTS`
