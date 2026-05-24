# Playwright Route Testrunner

This repository scans a target PHP/Laravel app (configured via `.env`), generates Playwright tests, and always writes a final run report.

## Quick start

```bash
make install
make auto
```

## Configuration (`.env`)

```env
APP_URL=http://example.test
LARAVEL_PATH=/example/path/to/laravel
ROUTES_JSON=routes.json
LOGIN_PATH=/login
DASHBOARD_PATH=http://example.test/dashboard
E2E_EMAIL=example@example.com
E2E_PASSWORD=example123
HEADLESS=false
ASSUME_AUTHENTICATED=false
```

Optional control flags:

```env
STOP_ON_ERROR=false
STOP_ON_FAIL_ROUTE=false
STOP_ON_FAILURE=false
SCREENSHOT_ON_ERROR=true
TRACE=true
```

- `TRACE` defaults to `true` in CI when not set.
- `STOP_ON_FAILURE` is an alias of `STOP_ON_FAIL_ROUTE`.

## Main commands

```bash
make install
make routes
make auto
make auto-one ROUTE=/dashboard
make scan-todo
make test
```

## Modes

### 1) Full scan

```bash
make auto
```

Scans route inventory when available, discovers links, generates Playwright output, and writes unified reporting.

### 2) Single-route scan (with discovery expansion)

```bash
make auto-one ROUTE=/dashboard
```

Starts from one route but still scans discovered internal routes.

### 3) Todo completion mode

```bash
make scan-todo
```

Uses `todo.json` (`nonScannedRoutes` + `erroredRoutes`) to continue unfinished coverage.

## CLI flags (supported by scanner)

- `--stop-on-error`
- `--stop-on-fail-route`
- `--stop-on-failure` (alias)
- `--screenshot-on-error` (default `true`)
- `--trace` (default `true` in CI)

## Outputs per run

- `storage/logs/run-report.json` (latest)
- `storage/logs/run-report-<timestamp>.json` (historical)
- `todo.json` (next-pass input for `make scan-todo`)
- `todo.txt` (human-readable backlog)
- `recordings/scan-<timestamp>.json`
- `tests-playwright/generated-<timestamp>.spec.js`
- `storage/logs/screenshots/*` and/or `storage/logs/traces/*` for failures

## Report classification

Every run report includes:

- `scannedRoutes`
- `erroredRoutes`
- `skippedRoutes`
- `nonScannedRoutes`

The report is always produced, including non-Laravel/dynamic-only scans.
