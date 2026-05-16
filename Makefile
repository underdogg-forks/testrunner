SHELL := /bin/bash

.PHONY: help install export-routes generate-routes auto discover record convert-playwright convert-phpunit playback

help: ## Show all commands
	@echo "Playwright Route Runner"
	@echo
	@echo "Quick start (automatic, no manual clicking):"
	@echo "  1) make install"
	@echo "  2) php artisan route:list --json > routes.json"
	@echo "  3) create .env with APP_URL, ROUTES_JSON, LOGIN_PATH, DASHBOARD_PATH, E2E_EMAIL, E2E_PASSWORD"
	@echo "  4) make auto"
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

auto: ## Run automatic login + traversal + form fill + per-link Playwright generation
	npm run generate:playwright:auto

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
