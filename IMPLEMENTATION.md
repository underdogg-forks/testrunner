# Implementation Summary

## Known-Routes-First Test Recording and Generation

### Primary Workflow

This implementation supports routes already being known and uses route inventory as the input to test generation.

For Laravel applications, route inventory is obtained directly from Artisan:

```bash
php artisan route:list --json > routes.json
```

The route inventory can be passed directly into the discover/generator flow:

```bash
BASE_URL=http://localhost:8000 ROUTES_FILE=routes.json npm run discover
```

This generates Playwright tests from the Laravel route inventory without relying on crawler inference.

For Playwright-only generation from route inventory:

```bash
BASE_URL=http://localhost:8000 ROUTES_FILE=routes.json npm run generate:playwright:routes
```

For login-aware automated traversal + recording + Playwright generation:

```bash
BASE_URL=http://localhost:8000 ROUTES_FILE=routes.json npm run adavanced-generation
```

This run:
- Authenticates (default `/login`) for protected routes
- Visits known routes and menu-derived routes
- Fills forms with dummy data and attempts submission
- Logs issues to `storage/logs/e2e-recording.log`
- Generates `recordings/e2e-session-*.json` and `tests-playwright/advanced-generated-*.spec.js`

### Why this is the default

1. **Reliable source of truth**: route list comes from the framework, not guesswork.
2. **Better coverage planning**: tests can be mapped to known endpoints before recording.
3. **Less noise**: avoids crawler-only paths and internal navigation artifacts.

### Fallback Workflow for Exotic / Non-Laravel Apps

When a route list is not available (exotic or non-Laravel applications), crawler-based route discovery remains supported:

- `npm run discover`

This fallback crawls the application to infer reachable routes and generate starter tests.

### Current Tooling

1. **Recording**: `npm run record` (manual interaction recording in an opened browser)
2. **Conversion**:
   - `npm run convert:playwright <recording.json>`
   - `npm run convert:phpunit <recording.json>`
3. **Playback**: `npm run playback <recording.json>`
4. **Route inventory generation**: `npm run generate:playwright:routes`
5. **Advanced auto-generation**: `npm run adavanced-generation`
6. **Fallback discovery**: `npm run discover`

### Documentation Direction

Documentation now reflects:

- Known-routes-first operation as the standard workflow (Laravel via `php artisan route:list`).
- Discovery as an explicit fallback path for applications that cannot provide a route list upfront.
