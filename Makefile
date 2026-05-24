SHELL := /bin/bash

.DEFAULT_GOAL := help

.PHONY: help install setup routes generate-routes auto auto-one discover record convert-playwright convert-phpunit playback test test-one clean doctor

help:
	@echo "Playwright E2E Tooling"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-22s %s\n", $$1, $$2}'

install: ## Install dependencies + Playwright browsers
	npm run install:deps

setup: install ## Full setup
	@echo "Setup complete"

routes: ## Export Laravel routes
	npm run routes:export

generate-routes: ## Generate Playwright specs from routes.json
	npm run routes:generate

auto: ## Run full authenticated traversal
	npm run auto

auto-one: ## Run single route traversal (ROUTE required)
	@test -n "$(ROUTE)" || (echo "Missing ROUTE. Example: make auto-one ROUTE=/dashboard" && exit 1)
	npm run auto:single -- --singleRoute $(ROUTE)

discover: ## Run discovery mode
	npm run discover

record: ## Manual recording session
	npm run record

convert-playwright: ## Convert recording to Playwright (RECORDING required)
	@test -n "$(RECORDING)" || (echo "Missing RECORDING. Example: make convert-playwright RECORDING=recordings/session.json" && exit 1)
	npm run convert:playwright -- $(RECORDING)

convert-phpunit: ## Convert recording to PHPUnit (RECORDING required)
	@test -n "$(RECORDING)" || (echo "Missing RECORDING. Example: make convert-phpunit RECORDING=recordings/session.json" && exit 1)
	npm run convert:phpunit -- $(RECORDING)

playback: ## Replay recording (RECORDING required)
	@test -n "$(RECORDING)" || (echo "Missing RECORDING. Example: make playback RECORDING=recordings/session.json" && exit 1)
	npm run playback -- $(RECORDING)

test: ## Run Playwright tests
	npm run test

test-one: ## Run single test (ROUTE required)
	@test -n "$(ROUTE)" || (echo "Missing ROUTE. Example: make test-one ROUTE=/dashboard" && exit 1)
	npm run test:one -- $(ROUTE)

clean: ## Clean generated files
	rm -rf recordings tests-playwright storage/logs/*.log todo.txt

doctor: ## Validate environment
	@node -v >/dev/null 2>&1 || (echo "Node missing" && exit 1)
	@npx playwright --version >/dev/null 2>&1 || (echo "Playwright missing" && exit 1)
	@test -f routes.json || echo "Warning: routes.json missing"
	@test -f .env || echo "Warning: .env missing"