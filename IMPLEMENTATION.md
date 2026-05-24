# Implementation Overview

## System Purpose

This toolchain provides:

- Laravel route inventory → Playwright generation
- Authenticated crawler-based traversal
- Form interaction simulation
- Network + navigation recording
- Automated test generation (Playwright + optional PHPUnit conversion)

---

## Core Workflows

### 1. Route Inventory Generation (Deterministic)

Uses Laravel route export as the source of truth.

```bash
php artisan route:list --json > routes.json
APP_URL=http://localhost:8000 ROUTES_JSON=routes.json npm run generate:playwright:routes

Output:

Route-based Playwright specs
2. Automatic Authenticated Traversal (Dynamic)

Runs a browser session that:

authenticates via login flow
starts from dashboard or a single route
discovers internal links
fills and submits forms with synthetic data
records navigation + interactions
generates test artifacts

Run:

make auto

Single route:

make auto-one ROUTE=/dashboard
Outputs

Each run generates:

recordings/e2e-session-*.json
tests-playwright/advanced-generated-*.spec.js
tests-playwright/advanced-generated-per-link-*.spec.js
storage/logs/e2e-recording.log
storage/logs/unmatched-links.log
todo.txt
Script Roles
Script	Purpose
record	manual interaction capture
convert:playwright	recording → Playwright
convert:phpunit	recording → PHPUnit
playback	replay recorded session
discover	fallback crawler-based discovery
generate:playwright:routes	inventory-based generation
generate:playwright:auto	full authenticated crawler
Execution Modes
Full mode
make auto
login required
full traversal
form submission enabled
link discovery enabled
Single-route mode
make auto-one ROUTE=/dashboard
isolated execution
safer for debugging
no global crawl required
Configuration

Required:

APP_URL
ROUTES_JSON
LOGIN_PATH
DASHBOARD_PATH
E2E_EMAIL
E2E_PASSWORD

Optional:

HEADLESS (default true)
HEADED (overrides HEADLESS)
ASSUME_AUTHENTICATED
REQUIRE_AUTH_CONFIRMATION
MAX_LINKS_PER_PAGE
Make Targets
make install
make setup
make routes
make auto
make auto-one ROUTE=/dashboard
make test
make test-one ROUTE=/dashboard
make record
make discover
make convert-playwright RECORDING=...
make convert-phpunit RECORDING=...
make playback RECORDING=...
Recommended Flow
make install
make routes
make auto
Debug Flow
make auto-one ROUTE=/dashboard HEADED=true
Safety Notes
logout/login routes are excluded automatically
parameterized routes are ignored
internal framework routes are excluded