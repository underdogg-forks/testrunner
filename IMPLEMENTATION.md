# Implementation Overview

## Purpose

This toolchain provides automated end-to-end scanning and test generation for Laravel applications:

- Laravel route inventory → Playwright test generation
- Authenticated browser-based crawling
- Form interaction simulation
- Network and navigation recording
- Test generation for Playwright and PHPUnit

---

## Core Workflows

### 1. Route Inventory Scan (recommended)

Exports your Laravel route list, then visits every page as an authenticated user.

```bash
make export-routes   # php artisan route:list --json > routes.json
make auto            # scan all routes, generate tests
```

**Outputs:**

- `recordings/scan-<timestamp>.json` — raw session data
- `tests-playwright/generated-<timestamp>.spec.js` — ready-to-run Playwright tests
- `storage/logs/run-report.json` — scan report

### 2. Shallow Scan (no routes.json required)

Starts from the dashboard and follows every link it finds.

```bash
make shallow
```

Use this when you cannot run `php artisan route:list`, or when you want to discover only the pages a normal user can reach by clicking.

### 3. Single-Route Scan

```bash
make auto-one ROUTE=/dashboard HEADED=true
```

Scans one route, useful for debugging. `HEADED=true` opens a visible browser.

### 4. Todo Completion

When a full scan is interrupted or times out, `todo.json` tracks the remaining routes.

```bash
make scan-todo
```

### 5. Manual Recording

```bash
make record
```

Opens a browser session where you interact with the app manually. Every click, form fill, and navigation is recorded.

Convert the recording to tests:

```bash
make convert-playwright RECORDING=recordings/session-<timestamp>.json
make convert-phpunit    RECORDING=recordings/session-<timestamp>.json
```

Replay the recording:

```bash
make playback RECORDING=recordings/session-<timestamp>.json
```

---

## Script Roles

| Script | File | Purpose |
|---|---|---|
| `npm run auto` | `advanced-generation.js` | Main scanner — authenticated crawl + test generation |
| `npm run record` | `advanced-recording.js` | Manual session recorder |
| `npm run convert:playwright` | `convert-to-playwright.js` | Recording → Playwright spec |
| `npm run convert:phpunit` | `convert-to-phpunit.js` | Recording → PHPUnit feature test |
| `npm run playback` | `playback.js` | Replay a recorded session |
| `npm run discover` | `discover-routes.js` | Standalone route crawler + test generator |
| `npm run routes:generate` | `generate-playwright-from-routes.js` | routes.json → Playwright spec (no browser) |

---

## Configuration

**Required:**

| Variable | Description |
|---|---|
| `APP_URL` | Base URL of the application |
| `LOGIN_PATH` | Login page path (e.g. `/login`) |
| `DASHBOARD_PATH` | Dashboard path (e.g. `/dashboard`) |
| `E2E_EMAIL` | Test user email (use a non-admin account) |
| `E2E_PASSWORD` | Test user password |

**Optional:**

| Variable | Default | Description |
|---|---|---|
| `ROUTES_JSON` | — | Path to `php artisan route:list --json` output |
| `SKIPPED_JSON` | `skipped.json` | Persisted skip list across runs |
| `ROUTE_PARAMS` | `{}` | JSON map of URL param substitutions, e.g. `{"external_id":"abc"}` |
| `HEADLESS` | `true` | Run browser invisibly |
| `ASSUME_AUTHENTICATED` | `false` | Skip the login step |
| `STOP_ON_ERROR` | `false` | Abort the scan on any error |
| `STOP_ON_FAIL_ROUTE` | `false` | Abort after the first failing route |
| `SCREENSHOT_ON_ERROR` | `true` | Capture screenshot on route error |
| `TRACE` | `true` in CI | Record Playwright trace files |

---

## Parameterized Routes

Routes like `/user/{external_id}` are skipped by default because the scanner cannot guess a real ID. To scan them, provide substitution values:

```env
ROUTE_PARAMS={"external_id":"abc-123","id":"42"}
```

The scanner substitutes the values and visits the resolved URLs. Use a dedicated test record rather than your admin account to get representative results.

---

## Make Targets

```bash
make install                                 # npm install + playwright install chromium
make export-routes                           # php artisan route:list --json > routes.json
make auto                                    # full scan (requires ROUTES_JSON)
make shallow                                 # link-crawl scan (no ROUTES_JSON needed)
make auto-one ROUTE=/path                    # single-route scan
make scan-todo                               # resume from todo.json
make test                                    # npx playwright test
make test-one ROUTE=/path                    # run tests matching route
make record                                  # manual recording session
make convert-playwright RECORDING=file.json  # convert recording to Playwright
make convert-phpunit    RECORDING=file.json  # convert recording to PHPUnit
make playback           RECORDING=file.json  # replay recording
make clear                                   # delete logs and zip artifacts
```

---

## Recommended Workflow

```
make install
make export-routes
make auto
make test
```

Debug a single route:

```
make auto-one ROUTE=/dashboard HEADED=true
```

---

## Safety Notes

- Logout and registration routes are excluded automatically.
- Parameterized routes (e.g. `{id}`) are skipped unless `ROUTE_PARAMS` is set.
- Internal framework routes (`/livewire`, `/_debugbar`, `/sanctum`, etc.) are excluded.
- Errored routes are automatically added to `skipped.json` and excluded from future runs.