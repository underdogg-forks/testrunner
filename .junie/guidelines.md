# Junie Guidelines

This file gives JetBrains Junie context about the project.

---

## Project summary

**Playwright Route Testrunner** is a Node.js CLI tool that scans a Laravel web application and auto-generates Playwright tests. It authenticates via a login form, visits every route, and produces a JSON report plus `.spec.js` test files.

---

## How to run the project

```bash
# 1. Install
make install

# 2. Configure
cp .env.example .env
# edit .env with your APP_URL, E2E_EMAIL, E2E_PASSWORD, etc.

# 3. Scan (with routes.json)
make export-routes
make auto

# 3. Or scan without routes.json
make shallow

# 4. Run tests
make test
```

---

## Language and module system

- **Node.js** (CommonJS, `require`/`module.exports`)
- **No TypeScript** — all files are plain `.js`
- **No build step** — changes take effect immediately
- **Playwright** for browser automation (`@playwright/test`)
- **Jest** is a devDependency but is not used for the scanner itself — only for generated test templates

---

## File responsibilities

| File | Role |
|---|---|
| `advanced-generation.js` | Main scanner entrypoint. Reads `.env`, loads routes, crawls, writes reports. |
| `advanced-recording.js` | Manual recorder. Opens a browser for the user to interact with. |
| `convert-to-playwright.js` | Converts `recordings/session-*.json` → Playwright `.spec.js` |
| `convert-to-phpunit.js` | Converts `recordings/session-*.json` → PHPUnit `.php` |
| `discover-routes.js` | `RouteDiscovery` class: crawl, group by module, generate test templates |
| `generate-playwright-from-routes.js` | Converts `routes.json` → Playwright specs without opening a browser |
| `playback.js` | Replays a recorded session |
| `utils.js` | Shared: `sortRoutes`, `buildTimeline`, string escape helpers |
| `Makefile` | All user-facing commands |

---

## Environment variables

All supported variables are documented in `.env.example`. The most important ones:

- `APP_URL` — target application base URL
- `E2E_EMAIL` / `E2E_PASSWORD` — credentials for the test user (use a non-admin account)
- `ROUTES_JSON` — optional path to `php artisan route:list --json` output
- `ROUTE_PARAMS` — JSON object for substituting URL parameters, e.g. `{"external_id":"abc-123"}`

---

## Coding guidelines

1. Keep CommonJS (`require`/`module.exports`) — do not convert to ESM
2. Use `path.join` / `path.resolve` for all file paths
3. Create directories with `fs.mkdirSync(dir, { recursive: true })` before writing files
4. The `runModel` object is the single source of truth for a scan run; always write it to disk at the end
5. Do not add new npm dependencies without strong justification
6. Makefile is the public API; npm scripts are private implementation details

---

## Parameterized routes

Routes like `/user/{external_id}` are skipped by default. To enable scanning:

```env
ROUTE_PARAMS={"external_id":"abc-123"}
```

The scanner substitutes values from `ROUTE_PARAMS` when loading the route inventory.

---

## Output contract

Every scan (regardless of errors) writes:

- `storage/logs/run-report.json`
- `recordings/scan-<timestamp>.json`
- `tests-playwright/generated-<timestamp>.spec.js`
- `todo.json`
- `skipped.json`
