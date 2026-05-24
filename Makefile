SHELL := /bin/bash

.PHONY: help install export-routes routes generate-routes auto auto-one scan-todo test test-one discover record convert-playwright convert-phpunit playback clear

ENV_FILE ?= .env

include $(ENV_FILE)
export $(shell sed 's/=.*//' $(ENV_FILE) 2>/dev/null)

help:
	@echo "Route Discovery System"
	@echo
	@echo "Core commands:"
	@echo "  make install"
	@echo "  make export-routes"
	@echo "  make auto"
	@echo "  make auto-one ROUTE=/dashboard"
	@echo "  make scan-todo"
	@echo "  make clear"
	@echo "  make test"
	@echo "  make test-one ROUTE=/dashboard"
	@echo
	@echo "Flags (set to true/false):"
	@echo "  STOP_ON_ERROR=true"
	@echo "  STOP_ON_FAIL_ROUTE=true (alias: STOP_ON_FAILURE=true)"
	@echo "  SCREENSHOT_ON_ERROR=true"
	@echo "  TRACE=true"
	@echo

install:
	npm install
	npx playwright install chromium

export-routes:
	php artisan route:list --json > routes.json

routes: export-routes

generate-routes:
	npm run routes:generate

auto:
	@if [ -z "$(ROUTES_JSON)" ]; then echo "❌ ROUTES_JSON missing"; exit 1; fi
	ROUTES_JSON=$(ROUTES_JSON) \
	APP_URL=$(APP_URL) \
	LOGIN_PATH=$(LOGIN_PATH) \
	DASHBOARD_PATH=$(DASHBOARD_PATH) \
	E2E_EMAIL=$(E2E_EMAIL) \
	E2E_PASSWORD=$(E2E_PASSWORD) \
	HEADLESS=$(HEADLESS) \
	ASSUME_AUTHENTICATED=$(ASSUME_AUTHENTICATED) \
	REQUIRE_AUTH_CONFIRMATION=$(REQUIRE_AUTH_CONFIRMATION) \
	STOP_ON_ERROR=$(STOP_ON_ERROR) \
	STOP_ON_FAIL_ROUTE=$(STOP_ON_FAIL_ROUTE) \
	STOP_ON_FAILURE=$(STOP_ON_FAILURE) \
	SCREENSHOT_ON_ERROR=$(SCREENSHOT_ON_ERROR) \
	TRACE=$(TRACE) \
	SKIPPED_JSON=$(SKIPPED_JSON) \
	npm run auto

auto-one:
	@test -n "$(ROUTE)" || (echo "Usage: make auto-one ROUTE=/dashboard [HEADED=true]" && exit 1)
	ROUTE=$(ROUTE) \
	ROUTES_JSON=$(ROUTES_JSON) \
	APP_URL=$(APP_URL) \
	HEADLESS=false \
	HEADED=$(HEADED) \
	ASSUME_AUTHENTICATED=$(ASSUME_AUTHENTICATED) \
	STOP_ON_ERROR=$(STOP_ON_ERROR) \
	STOP_ON_FAIL_ROUTE=$(STOP_ON_FAIL_ROUTE) \
	STOP_ON_FAILURE=$(STOP_ON_FAILURE) \
	SCREENSHOT_ON_ERROR=$(SCREENSHOT_ON_ERROR) \
	TRACE=$(TRACE) \
	SKIPPED_JSON=$(SKIPPED_JSON) \
	npm run auto

scan-todo:
	@if [ ! -f "todo.json" ]; then echo "❌ todo.json not found. Run make auto first."; exit 1; fi
	ROUTES_JSON=$(ROUTES_JSON) \
	APP_URL=$(APP_URL) \
	LOGIN_PATH=$(LOGIN_PATH) \
	DASHBOARD_PATH=$(DASHBOARD_PATH) \
	E2E_EMAIL=$(E2E_EMAIL) \
	E2E_PASSWORD=$(E2E_PASSWORD) \
	HEADLESS=$(HEADLESS) \
	ASSUME_AUTHENTICATED=$(ASSUME_AUTHENTICATED) \
	REQUIRE_AUTH_CONFIRMATION=$(REQUIRE_AUTH_CONFIRMATION) \
	STOP_ON_ERROR=$(STOP_ON_ERROR) \
	STOP_ON_FAIL_ROUTE=$(STOP_ON_FAIL_ROUTE) \
	STOP_ON_FAILURE=$(STOP_ON_FAILURE) \
	SCREENSHOT_ON_ERROR=$(SCREENSHOT_ON_ERROR) \
	TRACE=$(TRACE) \
	SKIPPED_JSON=$(SKIPPED_JSON) \
	npm run auto -- --todo=todo.json

test:
	npx playwright test

test-one:
	@test -n "$(ROUTE)" || (echo "Usage: make test-one ROUTE=/dashboard" && exit 1)
	npx playwright test --grep "$(ROUTE)"

discover:
	npm run discover

record:
	npm run record

convert-playwright:
	@test -n "$(RECORDING)" || (echo "Usage: make convert-playwright RECORDING=..." && exit 1)
	npm run convert:playwright $(RECORDING)

convert-phpunit:
	@test -n "$(RECORDING)" || (echo "Usage: make convert-phpunit RECORDING=..." && exit 1)
	npm run convert:phpunit $(RECORDING)

playback:
	@test -n "$(RECORDING)" || (echo "Usage: make playback RECORDING=..." && exit 1)
	npm run playback $(RECORDING)

clear:
	@echo "Clearing logs and zip artifacts..."
	@rm -rf storage/logs/*
	@rm -f recordings/scan-*.json
	@rm -f tests-playwright/generated-*.spec.js
	@rm -f todo.json todo.txt
	@find . -type f -name "*.zip" -not -path "./node_modules/*" -delete
	@echo "Done."