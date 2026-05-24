SHELL := /bin/bash

.PHONY: help install export-routes generate-routes auto auto-one test test-one discover record convert-playwright convert-phpunit playback

help: ## Show all commands
	@echo "Playwright Route Runner"
	@echo
	@echo "Quick start (automatic, no manual clicking):"
	@echo "  1) make install"
	@echo "  2) php artisan route:list --json > routes.json"
	@echo "  3) create .env with APP_URL, ROUTES_JSON, LOGIN_PATH, DASHBOARD_PATH, E2E_EMAIL, E2E_PASSWORD"
	@echo "  4) make auto"
	@echo "  5) make auto-one ROUTE=/dashboard  # headed single-route run with login"
	@echo "     Optional for auto: ROUTE=/dashboard HEADED=true"
	@echo
	@echo "Commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sed -E 's/:.*?## / - /'

install: ## Install dependencies and Playwright Chromium
	npm install
	npx playwright install chromium

export-routes: ## Print Laravel route export command
	@echo "Run in your Laravel app root:"
	@echo "php artisan route:list --json > routes.json"

generate-routes: ## Generate Playwright specs directly from routes.json
	npm run generate:playwright:routes

auto: ## Run automatic flow. Optional: ROUTE=/dashboard HEADED=true
	@route="$${ROUTE:-}"; \
	headed="$${HEADED:-false}"; \
	extra_args=""; \
	if [ -n "$$route" ]; then extra_args="$$extra_args --route=$$route"; fi; \
	if [ "$$headed" = "true" ]; then extra_args="$$extra_args --headed"; fi; \
	npm run generate:playwright:auto -- $$extra_args

<<<<<<< HEAD
auto-one: ## Run headed automatic flow for one route (ROUTE=/dashboard). Set ASSUME_AUTHENTICATED=true to skip login confirmation.
	@test -n "$(ROUTE)" || (echo "Usage: make auto-one ROUTE=/dashboard [ASSUME_AUTHENTICATED=true] [HEADED=true]" && exit 1)
	@headed="$${HEADED:-true}"; \
	extra_args="--singleRoute $(ROUTE)"; \
	if [ "$$headed" = "true" ]; then extra_args="$$extra_args --headed"; fi; \
	ASSUME_AUTHENTICATED=$${ASSUME_AUTHENTICATED:-false} npm run generate:playwright:auto -- $$extra_args
=======
auto-one: ## Run automatic flow for one route (ROUTE=/dashboard)
	@test -n "$(ROUTE)" || (echo "Usage: make auto-one ROUTE=/dashboard" && exit 1)
	HEADLESS=false ASSUME_AUTHENTICATED=false npm run generate:playwright:auto -- --singleRoute "$(ROUTE)"
>>>>>>> bb7e19b (Almost working: auto-login and then scan a single route from a previously generated `routes.json`)

test: ## Run all Playwright tests
	npx playwright test

test-one: ## Run one Playwright test by grep pattern (ROUTE=/dashboard)
	@test -n "$(ROUTE)" || (echo "Usage: make test-one ROUTE=/dashboard" && exit 1)
	npx playwright test --grep "$(ROUTE)"

discover: ## Run discovery workflow (inventory-backed or crawler fallback)
	npm run discover

record: ## Manual browser interaction recording
	npm run record

convert-playwright: ## Convert a manual recording to Playwright (set RECORDING=recordings/session-<timestamp>.json)
	@test -n "$(RECORDING)" || (echo "Usage: make convert-playwright RECORDING=recordings/session-<timestamp>.json" && exit 1)
	npm run convert:playwright $(RECORDING)

convert-phpunit: ## Convert a manual recording to PHPUnit (set RECORDING=recordings/session-<timestamp>.json)
	@test -n "$(RECORDING)" || (echo "Usage: make convert-phpunit RECORDING=recordings/session-<timestamp>.json" && exit 1)
	npm run convert:phpunit $(RECORDING)

playback: ## Replay a manual recording (set RECORDING=recordings/session-<timestamp>.json)
	@test -n "$(RECORDING)" || (echo "Usage: make playback RECORDING=recordings/session-<timestamp>.json" && exit 1)
	npm run playback $(RECORDING)
