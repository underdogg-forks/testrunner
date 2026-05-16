# Implementation Summary

## Known-Routes-First Test Recording and Generation

### Primary Workflow

This implementation assumes routes are already known and uses that route inventory as the input to recording.

For Laravel applications, route inventory is obtained directly from Artisan:

```bash
php artisan route:list --json > routes.json
```

The `record` action is then used to capture real user interactions for those known routes, and the resulting session files are converted into test files (Playwright/PHPUnit).

### Why this is the default

1. **Reliable source of truth**: route list comes from the framework, not guesswork.
2. **Better coverage planning**: tests can be mapped to known endpoints before recording.
3. **Less noise**: avoids crawler-only paths and internal navigation artifacts.

### Fallback Workflow for Exotic / Non-Laravel Apps

When a route list is not available (exotic or non-Laravel applications), route discovery remains supported:

- `npm run discover`

This fallback crawls the application to infer reachable routes and generate starter tests.

### Current Tooling

1. **Recording**: `npm run record`
2. **Conversion**:
   - `npm run convert:playwright <recording.json>`
   - `npm run convert:phpunit <recording.json>`
3. **Playback**: `npm run playback <recording.json>`
4. **Fallback discovery**: `npm run discover`

### Documentation Direction

Documentation now reflects:

- Known-routes-first operation as the standard workflow (Laravel via `php artisan route:list`).
- Discovery as an explicit fallback path for applications that cannot provide a route list upfront.
