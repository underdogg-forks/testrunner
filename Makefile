SHELL := /bin/bash

.DEFAULT_GOAL := help

.PHONY: help install setup test test-one auto auto-one routes generate-routes discover record convert-playwright convert-phpunit playback clean doctor

APP_ENV ?= .env

help: ## Show available commands
	@echo "Playwright E2E Tooling"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-22s %s\n", $$1, $$2}'

install: ## Install dependencies and Playwright browsers
	npm install
	npx playwright install chromium

setup: install ## Full initial setup (install + browser deps)
	@echo "Setup complete"

routes: ## Export Laravel routes to routes.json
	php artisan route:list --json > routes.json

generate-routes: ## Generate Playwright specs from routes.json
	npm run generate:playwright:routes

auto: ## Run full automatic traversal (optional: ROUTE=/dashboard HEADED=true)
	@route="$${ROUTE:-}"; \
	headed="$${HEADED:-false}"; \
	args=""; \
	[ -n "$$route" ] && args="$$args --route=$$route"; \
	[ "$$headed" = "true" ] && args="$$args --headed"; \
	npm run generate:playwright:auto -- $$args

auto-one: ## Run single-route traversal (ROUTE required, optional HEADED=true)
	@test -n "$(ROUTE)" || (echo "Missing ROUTE. Example: make auto-one ROUTE=/dashboard" && exit 1)
	@headed="$${HEADED:-true}"; \
	args="--singleRoute $(ROUTE)"; \
	[ "$$headed" = "true" ] && args="$$args --headed"; \
	ASSUME_AUTHENTICATED=$${ASSUME_AUTHENTICATED:-false} npm run generate:playwright:auto -- $$args

test: ## Run full Playwright test suite
	npx playwright test

test-one: ## Run a single test (ROUTE=/dashboard)
	@test -n "$(ROUTE)" || (echo "Missing ROUTE. Example: make test-one ROUTE=/dashboard" && exit 1)
	npx playwright test --grep "$(ROUTE)"

discover: ## Run route discovery workflow
	npm run discover

record: ## Start manual recording session
	npm run record

convert-playwright: ## Convert recording to Playwright (RECORDING required)
	@test -n "$(RECORDING)" || (echo "Missing RECORDING. Example: make convert-playwright RECORDING=recordings/session.json" && exit 1)
	npm run convert:playwright $(RECORDING)

convert-phpunit: ## Convert recording to PHPUnit (RECORDING required)
	@test -n "$(RECORDING)" || (echo "Missing RECORDING. Example: make convert-phpunit RECORDING=recordings/session.json" && exit 1)
	npm run convert:phpunit $(RECORDING)

playback: ## Replay a recorded session (RECORDING required)
	@test -n "$(RECORDING)" || (echo "Missing RECORDING. Example: make playback RECORDING=recordings/session.json" && exit 1)
	npm run playback $(RECORDING)

clean: ## Clean generated artifacts
	rm -rf recordings tests-playwright storage/logs/*.log todo.txt

doctor: ## Validate environment and dependencies
	@node -v >/dev/null 2>&1 || (echo "Node.js missing" && exit 1)
	@npx playwright --version >/dev/null 2>&1 || (echo "Playwright missing" && exit 1)
	@test -f routes.json || echo "Warning: routes.json missing"
	@test -f .env || echo "Warning: .env missing"