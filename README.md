````md
# Playwright Laravel E2E Generator

This tool generates Playwright test suites from:

- Laravel route inventory (deterministic)
- Authenticated browser traversal (dynamic)

---

## Quick Start

```bash
make install
php artisan route:list --json > routes.json
make auto
````

---

## What it does

* logs into your application
* starts from dashboard or selected route
* crawls internal links safely
* fills forms with synthetic data
* records navigation and network activity
* generates Playwright test suites
* reports untouched routes

---

## Main commands

### Full automated run

```bash
make auto
```

### Single route run

```bash
make auto-one ROUTE=/dashboard
```

### Run tests

```bash
make test
```

### Run one test

```bash
make test-one ROUTE=/dashboard
```

---

## Route-based generation (deterministic)

```bash
php artisan route:list --json > routes.json
make generate-routes
```

---

## Manual recording

```bash
make record
```

Convert recording:

```bash
make convert-playwright RECORDING=recordings/session.json
```

Replay recording:

```bash
make playback RECORDING=recordings/session.json
```

---

## Outputs

* `recordings/` → raw browser sessions
* `tests-playwright/` → generated test suites
* `storage/logs/` → logs and unmatched links
* `todo.txt` → uncovered routes + retry items

---

## Configuration (.env)

```env
APP_URL=http://localhost:8000
ROUTES_JSON=routes.json
LOGIN_PATH=/login
DASHBOARD_PATH=/dashboard
E2E_EMAIL=admin@example.com
E2E_PASSWORD=secret
```

Optional:

```env
HEADLESS=true
HEADED=true
ASSUME_AUTHENTICATED=false
REQUIRE_AUTH_CONFIRMATION=true
MAX_LINKS_PER_PAGE=250
```

---

## Recommended workflow

```bash
make install
make routes
make auto
```

---

## Debug workflow

```bash
make auto-one ROUTE=/dashboard HEADED=true
```

---

## Notes

* Parameterized Laravel routes (`{id}`) are ignored
* Authentication routes are excluded from traversal
* Only internal application links are followed
* Designed for stable Playwright test generation from real usage flows

```
```
