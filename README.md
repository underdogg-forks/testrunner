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

## Simplest path (no manual interaction)

1. Export routes from Laravel:

```bash
php artisan route:list --json > routes.json
```

2. Create `.env`:

```dotenv
APP_URL=http://localhost:8000
ROUTES_JSON=routes.json
LOGIN_PATH=/login
DASHBOARD_PATH=/dashboard
E2E_EMAIL=admin@example.com
E2E_PASSWORD=secret
```

3. Run automatic traversal + test generation:

```bash
make auto
```

Single route from `make auto`:

```bash
make auto ROUTE=/dashboard
```

Headed browser (visible):

```bash
make auto ROUTE=/dashboard HEADED=true
```

This logs in, traverses links, fills forms with dummy values, generates Playwright tests, and writes untouched routes to `todo.txt`.
If login is not confirmed, the run now fails fast with: `Cannot continue without confirmed authenticated state.`

## Single-route run (`/dashboard`)

Use this when you want one route only:

```bash
make auto-one ROUTE=/dashboard
```

If you explicitly want a test-driven run without login confirmation:

```bash
make auto-one ROUTE=/dashboard ASSUME_AUTHENTICATED=true
```

Equivalent Yarn command:

```bash
ASSUME_AUTHENTICATED=true yarn auto --singleRoute /dashboard
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

Or with Yarn:

```bash
yarn auto
```

What it does:

1. Logs in with Playwright.
2. Navigates to dashboard (`/dashboard` by default).
3. Loads links from pages and matches coverage against `routes.json`.
4. Follows discovered internal links and records them.
5. Fills forms with dummy data and tries submit actions.
6. Generates:
   - `recordings/e2e-session-*.json`
   - `tests-playwright/advanced-generated-*.spec.js`
   - `tests-playwright/advanced-generated-per-link-*.spec.js` (one test per touched matched/unmatched internal link)
7. Writes errors to:
   - `storage/logs/e2e-recording.log`
8. Writes unmatched discovered links to:
   - `storage/logs/unmatched-links.log`
9. Writes untouched route checklist to:
   - `todo.txt` (includes untouched routes, unmatched links, and generation retry items)

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

## Makefile commands

Use `make help` to list commands:

- `make install`
- `make export-routes`
- `make generate-routes`
- `make auto` (requires confirmed authentication)
- `make auto-one ROUTE=/dashboard [ASSUME_AUTHENTICATED=true]`
- `make test`
- `make test-one ROUTE=/dashboard`
- `make discover`
- `make record`
- `make convert-playwright RECORDING=recordings/session-<timestamp>.json`
- `make convert-phpunit RECORDING=recordings/session-<timestamp>.json`
- `make playback RECORDING=recordings/session-<timestamp>.json`

## Configuration

Common variables:

- `APP_URL` (`BASE_URL` alias; default: `http://localhost:3000`)
- `ROUTES_JSON` (`ROUTES_FILE` alias; required for route-inventory workflows)
- `LOGIN_PATH` (`LOGIN_URL` alias; default: `/login`)
- `DASHBOARD_PATH` (`DASHBOARD_URL` alias; default: `/dashboard`)
- `E2E_EMAIL` (`TEST_EMAIL` alias)
- `E2E_PASSWORD` (`TEST_PASSWORD` alias)
- `HEADLESS` (`true`/`false`)
- `HEADED` (`true`/`false`, overrides `HEADLESS` and runs visible browser)
- `MAX_LINKS_PER_PAGE` (default: `250`)
- `ROUTE`, `SINGLE_ROUTE_PATH`, or `SINGLE_ROUTE` (example: `/dashboard`)
- `ASSUME_AUTHENTICATED` (`true`/`false`, default: `false`)
- `REQUIRE_AUTH_CONFIRMATION` (`true`/`false`, default: `true`)

The script loads variables from `.env` automatically if the file exists.

Manual recorder variables:

- `START_URL`
- `MAX_DURATION`
- `RECORD_NETWORK`
- `CAPTURE_SCREENSHOTS`

## Which command should I run?

After `yarn install`:

- Generate automatically: `yarn auto`
- Run all tests: `yarn test`
- Run one route test from generated specs: `ROUTE=/dashboard yarn test:one`
