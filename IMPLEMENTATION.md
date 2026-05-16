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
- moves to dashboard (default `/dashboard`),
- follows discovered internal links,
- fills forms with dummy values and attempts submission,
- records route/link/form/network activity,
- generates Playwright output from the resulting recording,
- generates a one-test-per-touched-route Playwright spec file,
- writes error details to `storage/logs/e2e-recording.log`,
- writes untouched route checklist to `todo.txt`.

## Current scripts

1. `npm run record` (manual recording)
2. `npm run convert:playwright <recording.json>`
3. `npm run convert:phpunit <recording.json>`
4. `npm run playback <recording.json>`
5. `npm run discover` (crawler fallback or inventory-backed discovery)
6. `npm run generate:playwright:routes` (inventory-only generation)
7. `npm run generate:playwright:auto` (automatic traversal + generation)

## Makefile entrypoints

For easier usage, the repository includes a `Makefile`:

1. `make install`
2. `make export-routes`
3. `make auto` (recommended first run for automatic generation)
4. `make generate-routes`
5. `make discover`
6. `make record`
7. `make convert-playwright RECORDING=...`
8. `make convert-phpunit RECORDING=...`
9. `make playback RECORDING=...`

## Fallback mode

If route inventory is not available, `npm run discover` remains available for crawler-based route inference.
