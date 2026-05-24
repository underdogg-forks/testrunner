# GitHub Copilot Instructions

This file gives GitHub Copilot context about the project so it can give better suggestions.

---

## Project overview

**Playwright Route Testrunner** — a Node.js CLI tool that scans a Laravel web application and auto-generates Playwright end-to-end tests.

It is a **scanner**, not a test framework. It authenticates via login, visits every page, and writes `.spec.js` files.

---

## Stack

- Node.js (CommonJS modules — `require`/`module.exports`)
- Playwright (`@playwright/test`, `playwright`)
- No TypeScript, no bundler, no transpilation

---

## Entry points

| Command | File |
|---|---|
| `make auto` / `npm run auto` | `advanced-generation.js` |
| `make shallow` | `advanced-generation.js` (no ROUTES_JSON) |
| `make record` | `advanced-recording.js` |
| `make discover` | `discover-routes.js` |
| `make convert-playwright` | `convert-to-playwright.js` |
| `make convert-phpunit` | `convert-to-phpunit.js` |
| `make playback` | `playback.js` |
| `npm run routes:generate` | `generate-playwright-from-routes.js` |

---

## Key design decisions

1. **`runModel`** in `advanced-generation.js` is the single canonical object for a scan run. It is always written to disk at the end, even if errors occurred.

2. **Parameterized routes** (`{id}`, `{external_id}`) are skipped unless `ROUTE_PARAMS` env var provides substitution values.

3. **`skipped.json`** persists across runs. Routes that error are added automatically so future runs skip them.

4. **`shallow` mode** runs without `routes.json`. The scanner discovers routes by following links from the dashboard. Useful when `php artisan route:list` is unavailable.

5. **Output files** are always written. A scan with zero successful routes still produces a report, a todo, and an (empty) spec file.

---

## Coding conventions

- All file paths use `path.join` or `path.resolve`
- Directories are created with `fs.mkdirSync(dir, { recursive: true })` before writing
- Logging uses the `[ISO_TIMESTAMP] [LEVEL] message` format
- CLI flags are parsed manually (no third-party arg parser)
- Boolean env vars accept `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`

---

## Environment variables

See `.env.example` for a full list. Key variables:

```
APP_URL          Target application URL
E2E_EMAIL        Test user email (non-admin recommended)
E2E_PASSWORD     Test user password
ROUTES_JSON      Path to routes.json (optional)
ROUTE_PARAMS     JSON of URL param substitutions: {"external_id":"abc-123"}
HEADLESS         true/false (default true)
STOP_ON_ERROR    Abort scan on first error
TRACE            Enable Playwright tracing (auto-enabled in CI)
```

---

## Suggested test user setup

When testing routes like `/user/{external_id}`:

1. Create a dedicated test user in the database (not admin)
2. Note their `external_id`
3. Set `ROUTE_PARAMS={"external_id":"their-id"}` in `.env`
4. Set `E2E_EMAIL` and `E2E_PASSWORD` to that user's credentials

This ensures the scanner sees what a real user sees, not what an admin sees.

---

## When adding features

- Keep CommonJS — do not convert to ESM
- Do not add npm packages without a clear need
- Makefile is the public interface; keep `make help` up to date
- New scan modes should integrate with `createRunModel` and `writeRunOutputs` so reports are consistent
- Always test with `make auto-one ROUTE=/some-route HEADED=true` against a live app
