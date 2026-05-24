# Implementation summary

## Main route-inventory workflows

### 1) Direct Playwright generation from Laravel routes

```bash
php artisan route:list --json > routes.json
APP_URL=http://localhost:8000 ROUTES_JSON=routes.json npm run generate:playwright:routes
```

This generates module-based Playwright specs from known routes.

### 2) Automatic login-aware traversal and generation

```bash
npm run generate:playwright:auto
```

This workflow:

- logs in (default `/login`),
- fails fast if authentication is not confirmed (unless explicitly overridden),
- moves to dashboard (default `/dashboard`),
- follows discovered internal links,
- fills forms with dummy values and attempts submission,
- records route/link/form/network activity,
- generates Playwright output from the resulting recording,
- generates a one-test-per-touched-link Playwright spec file (matched and unmatched internal links),
- writes error details to `storage/logs/e2e-recording.log`,
- writes unmatched discovered links to `storage/logs/unmatched-links.log`,
- writes `todo.txt` with untouched route checklist plus generation retry items.

## Current scripts

1. `npm run record` (manual recording)
2. `npm run convert:playwright <recording.json>`
3. `npm run convert:phpunit <recording.json>`
4. `npm run playback <recording.json>`
5. `npm run discover` (crawler fallback or inventory-backed discovery)
6. `npm run generate:playwright:routes` (inventory-only generation)
7. `npm run generate:playwright:auto` (automatic traversal + generation)
8. `npm run generate:playwright:auto -- --singleRoute /dashboard` (single-route traversal)
9. `npx playwright test --grep /dashboard` (run one route-focused test)

## Makefile entrypoints

For easier usage, the repository includes a `Makefile`:

1. `make install`
2. `make export-routes`
3. `make auto` (recommended first run for automatic generation)
4. `make auto-one ROUTE=/dashboard [ASSUME_AUTHENTICATED=true]`
5. `make test`
6. `make test-one ROUTE=/dashboard`
7. `make generate-routes`
8. `make discover`
9. `make record`
10. `make convert-playwright RECORDING=...`
11. `make convert-phpunit RECORDING=...`
12. `make playback RECORDING=...`

## Fallback mode

If route inventory is not available, `npm run discover` remains available for crawler-based route inference.
