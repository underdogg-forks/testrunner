# Playwright Route Testrunner

A tool that logs into your website, visits every page, checks nothing is broken, and writes Playwright tests automatically.

> **New here?** Follow the [step-by-step guide](#step-by-step-guide) below. You do not need to understand how it works — just follow the steps.

---

## What you need before starting

1. **Node.js 18 or newer** — download from [nodejs.org](https://nodejs.org)
2. A running copy of your Laravel website (it must be reachable in your browser)
3. A regular (non-admin) test user account on that website

---

## Step-by-step guide

### Step 1 — Install

Open a terminal in this folder and run:

```bash
make install
```

This downloads all the tools the scanner needs. Do this once.

---

### Step 2 — Configure

Copy the example settings file and fill it in:

```bash
cp .env.example .env
```

Open `.env` in any text editor and set these values:

| Setting | What to enter | Example |
|---|---|---|
| `APP_URL` | Your website address | `http://mysite.test` |
| `LARAVEL_PATH` | Where your Laravel project lives | `/home/me/mysite` |
| `LOGIN_PATH` | The path to your login page | `/login` |
| `DASHBOARD_PATH` | The path to your dashboard | `/dashboard` |
| `E2E_EMAIL` | Email for a **non-admin** test account | `testuser@mysite.test` |
| `E2E_PASSWORD` | Password for that test account | `secret123` |

**Why a non-admin user?** Admin accounts often see extra pages that regular users cannot. Tests written for admin will fail when run as a normal user.

If your app has routes with URL parameters like `/user/{external_id}`, add the real value to use during scanning:

```env
ROUTE_PARAMS='{"external_id":"abc-123-def"}'
```

---

### Step 3 — Export your routes (optional but recommended)

If you have access to the Laravel project:

```bash
make export-routes
```

This creates a `routes.json` file that lists every page in your app. The scanner uses it to find pages it might otherwise miss.

**No access to Laravel?** Skip this step and use `make shallow` in Step 4 instead.

---

### Step 4 — Scan your website

**With `routes.json` (recommended):**

```bash
make auto
```

**Without `routes.json` — follows links only:**

```bash
make shallow
```

The scanner will:
1. Open a browser (invisible by default)
2. Log in using your test account
3. Visit every page it knows about
4. Write a report of what it found

When it finishes you will see output like:

```
[INFO] scan summary { scanned: 42, errored: 2, skipped: 5 }
[INFO] report   -> storage/logs/run-report.json
[INFO] session  -> recordings/scan-2025-01-01T12-00-00.json
[INFO] spec     -> tests-playwright/generated-2025-01-01T12-00-00.spec.js
```

The `.spec.js` file is a ready-to-run Playwright test file.

---

### Step 5 — Run the generated tests

```bash
make test
```

This runs all the Playwright tests that were created in Step 4.

---

### Step 6 — Fix unfinished pages (optional)

If the scan was interrupted or some pages had errors, resume where it left off:

```bash
make scan-todo
```

---

## Script execution order

Run scripts in this order:

```
1.  make install              ← once, first time only
2.  make export-routes        ← once per deployment (optional)
3.  make auto                 ← main scan (or: make shallow)
4.  make scan-todo            ← if step 3 was interrupted
5.  make test                 ← run the generated tests
```

For manual recording (record your own actions):

```
1.  make install
2.  make record               ← open browser, do things manually
3.  make convert-playwright RECORDING=recordings/session-....json
4.  make test
```

---

## All commands

```bash
make install                                # Install Node dependencies + Playwright
make export-routes                          # php artisan route:list → routes.json
make auto                                   # Full scan using routes.json
make shallow                                # Scan by following links only (no routes.json needed)
make auto-one ROUTE=/dashboard             # Scan a single page
make scan-todo                              # Resume an unfinished scan
make test                                   # Run all generated Playwright tests
make test-one ROUTE=/dashboard             # Run tests matching a route
make record                                 # Open browser for manual recording
make convert-playwright RECORDING=file.json # Recording → Playwright test
make convert-phpunit    RECORDING=file.json # Recording → PHPUnit test
make playback           RECORDING=file.json # Replay a recording in the browser
make clear                                  # Delete old logs and trace files
make help                                   # Show this list
```

---

## All settings (`.env`)

```env
# Required
APP_URL=http://example.test
LARAVEL_PATH=/path/to/your/laravel/project
LOGIN_PATH=/login
DASHBOARD_PATH=/dashboard
E2E_EMAIL=testuser@example.test
E2E_PASSWORD=yourpassword

# Optional — route file
ROUTES_JSON=routes.json
SKIPPED_JSON=skipped.json

# Optional — parameterized routes
# Wrap in single quotes to avoid shell/Makefile issues
ROUTE_PARAMS='{"external_id":"abc-123"}'

# Optional — browser
HEADLESS=true          # true = invisible browser, false = visible
ASSUME_AUTHENTICATED=false

# Optional — error behaviour
STOP_ON_ERROR=false        # stop the whole scan on any error
STOP_ON_FAIL_ROUTE=false   # stop after the first failing route
STOP_ON_FAILURE=false      # alias for STOP_ON_FAIL_ROUTE
SCREENSHOT_ON_ERROR=true   # take a screenshot when a page errors
TRACE=true                 # record a Playwright trace (always on in CI)
```

---

## What the scan produces

After every scan you will find these files:

| File | What it is |
|---|---|
| `storage/logs/run-report.json` | Full report of the latest scan |
| `storage/logs/run-report-<timestamp>.json` | Historical copy |
| `recordings/scan-<timestamp>.json` | Session data (use with `convert-playwright`) |
| `tests-playwright/generated-<timestamp>.spec.js` | Auto-generated Playwright tests |
| `todo.json` | Pages not yet scanned — input for `make scan-todo` |
| `skipped.json` | Pages skipped due to errors — persists across runs |
| `todo.txt` | Human-readable version of `todo.json` |
| `storage/logs/screenshots/` | Screenshots captured on errors |
| `storage/logs/traces/` | Playwright trace files for failures |

The report always contains four categories:

- `scannedRoutes` — pages the scanner visited successfully
- `erroredRoutes` — pages that returned an error or threw an exception
- `skippedRoutes` — pages excluded by pattern or a previous error
- `nonScannedRoutes` — pages in `routes.json` that were not reached

---

## Parameterized routes (`/user/{external_id}`)

Routes with URL parameters like `/user/{external_id}` or `/user/{external_id}/edit`
are skipped by default because the scanner does not know which ID to use.

To scan them, add the real values to your `.env`:

```env
ROUTE_PARAMS='{"external_id":"abc-123-def","id":"42"}'
```

The scanner will substitute these values and visit the resolved URLs.

**Tip:** Use a dedicated test record (not your admin account) so the scan reflects what normal users see.

---

## Cleanup

```bash
make clear
```

Removes everything inside `storage/logs/` and all `.zip` trace files.
Generated tests in `tests-playwright/` are not deleted.
