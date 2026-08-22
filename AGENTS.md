# Agent Guidelines

This file describes the project for AI coding agents (GitHub Copilot, Cursor, Junie, etc.).

---

## What this project does

This is a **Node.js CLI toolchain** that:

1. Authenticates against a Laravel web application using Playwright
2. Visits every route in the app (from `routes.json` or by following links)
3. Records what it finds — status codes, discovered links, errors
4. Generates Playwright `.spec.js` test files automatically
5. Produces JSON reports for further analysis

It is not a test framework. It is a **scanner and test generator** that runs against a live Laravel app.

---

## Repository structure

```
advanced-generation.js       Main scanner — authenticated crawl, report, spec generation
advanced-recording.js        Manual session recorder (open browser, click around, save JSON)
convert-to-playwright.js     Converts a recording JSON → Playwright spec file
convert-to-phpunit.js        Converts a recording JSON → PHPUnit feature test
discover-routes.js           RouteDiscovery class — crawl, grouping, spec templates
discover-phpunit.js          Variant of RouteDiscovery that generates PHPUnit tests
generate-playwright-from-routes.js  Routes JSON → Playwright specs (no browser needed)
find-form-gaps.js            mind-the-gap frontend audit: DOM field constraints vs schema.json
playback.js                  Replays a recorded session in a browser
record-routes.js             Legacy minimal click recorder (not used by make targets)
utils.js                     Shared helpers: sortRoutes, buildTimeline, escape helpers
Makefile                     All user-facing commands
package.json                 npm scripts
.env.example                 All supported environment variables with descriptions
README.md                    User documentation (written for non-technical readers)
IMPLEMENTATION.md            Technical documentation for developers
```

---

## Key environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | Yes | Base URL of the target app |
| `LOGIN_PATH` | Yes | Login page path |
| `DASHBOARD_PATH` | Yes | Dashboard path (scan starting point) |
| `E2E_EMAIL` | Yes | Test user email |
| `E2E_PASSWORD` | Yes | Test user password |
| `ROUTES_JSON` | No | Path to `php artisan route:list --json` output |
| `SKIPPED_JSON` | No | Persisted skip list (`skipped.json` by default) |
| `ROUTE_PARAMS` | No | JSON map of URL param substitutions (single-quote in `.env`) |
| `HEADLESS` | No | `true` (default) or `false` |
| `STOP_ON_ERROR` | No | Abort on any error |
| `STOP_ON_FAIL_ROUTE` | No | Abort after first failing route |
| `SCREENSHOT_ON_ERROR` | No | Capture screenshot on route error (default `true`) |
| `TRACE` | No | Enable Playwright tracing (default `true` in CI) |

---

## Script execution order

```
make install           # 1 — always run first, once
make export-routes     # 2 — optional, generates routes.json
make auto              # 3 — main scan (or: make shallow)
make scan-todo         # 4 — optional, resume interrupted scan
make test              # 5 — run generated Playwright tests
```

---

## Code conventions

- CommonJS modules (`require` / `module.exports`) throughout — do not use ES module syntax (`import`/`export`) in `.js` files
- The Makefile is the public interface; npm scripts are internal
- All file paths are constructed with `path.join` / `path.resolve`
- Directories are created with `fs.mkdirSync(dir, { recursive: true })` before writing
- Log lines follow `[ISO_TIMESTAMP] [LEVEL] message {extra_json}` format
- The `runModel` object in `advanced-generation.js` is the canonical scan result; it is written to `storage/logs/run-report.json` at the end of every run regardless of errors

---

## Important behaviours

- Routes matching `shouldSkipRoute()` patterns are excluded (logout, livewire internals, etc.)
- Routes with URL parameters (`{id}`, `{external_id}`, etc.) are skipped **unless** `ROUTE_PARAMS` is set
- Errored routes are added to `skipped.json` and excluded from future runs automatically
- The scan always produces output files even if every route errored
- `make shallow` runs without `ROUTES_JSON` — it discovers routes by following links from the dashboard

---

## Output files

| File | Description |
|---|---|
| `storage/logs/run-report.json` | Latest scan report |
| `storage/logs/run-report-<ts>.json` | Timestamped copy |
| `recordings/scan-<ts>.json` | Session JSON (input for `convert-to-playwright.js`) |
| `tests-playwright/<phenomenon>/generated-<ts>.spec.js` | Auto-generated Playwright specs split by phenomenon |
| `todo.json` | Routes not yet scanned |
| `skipped.json` | Persisted skipped routes |
| `todo.txt` | Human-readable todo list |
| `schema.json` | mind-the-gap: DB column/index constraints per Filament resource, from `make export-schema` |

---

## mind-the-gap: form/DB constraint audit

`find-form-gaps.js` + `form-db-gaps.spec.js` are a permanent regression
gate, not a discovery/generation script like the rest of this tool — they
crawl real rendered forms and assert their DOM `required`/`maxlength`
attributes match the real DB column constraints exported by the Laravel
app's `php artisan mind-the-gap:export-schema` (`make export-schema` →
`schema.json`). Run both together with `make find-form-gaps`.

`form-db-gaps.spec.js` deliberately lives at the project root, not inside
`tests-playwright/` — that directory is blanket-gitignored (disposable
scan/generation output) and this spec is a permanent, committed regression
test. `make find-form-gaps` invokes it by explicit path, which Playwright
honors regardless of `testDir`.

See the `mind-the-gap` skill (`~/.claude/skills/mind-the-gap/SKILL.md`) for
the full methodology and how to port this to a non-Filament/non-Laravel
app.

## When modifying this project

- Run `npm install` after any `package.json` change
- The project has no build step — changes to `.js` files take effect immediately
- Test your changes with `make auto-one ROUTE=/dashboard HEADED=true` against a real app
- The `test-results/` directory is gitignored; it is created by Playwright at test time
- Do not introduce new dependencies without a clear reason — the project intentionally has minimal deps

---

## Behavioral test quality policy (critical)

This repository is used to generate Playwright/PHPUnit tests for external Laravel apps. Generated output must optimize for **behavioral confidence**, not route coverage volume.

### Mandatory workflow assertions
For generated Playwright tests, require:
1. Navigate to scenario entry point
2. Perform meaningful user action
3. Trigger state transition
4. Assert business outcome
5. Assert resulting application/domain state

For generated PHPUnit tests, require:
1. Arrange realistic fixtures/state
2. Execute meaningful HTTP/domain action
3. Assert behavioral response (validation/authz/redirect)
4. Assert persisted or session/domain mutation

### Prohibited weak-test output
Do not generate tests that only prove:
- route availability or status 200
- selector, button, or link visibility
- static page rendering
- raw network success (`response.ok()` etc.)
- DOM/CSS structure or framework internals

If UI visibility checks are present, they must be paired with outcome/state verification.

### Refactor expectations
When refactoring generated tests:
- remove weak assertions
- replace replay-only flows with complete business workflows
- reduce brittle selector coupling where possible
- keep scenarios explicit (avoid opaque loop-generated tests)

### Required self-audit for generation/refactor tasks
After each generated/refactored file, provide:
- Completed behavioral improvements
- Weak assertions removed
- Remaining weaknesses
- Structural coupling remaining
- TODO remediation gaps

Never mark work complete if behavioral gaps remain.
