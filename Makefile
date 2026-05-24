SHELL := /bin/bash

.PHONY: help install export-routes routes generate-routes auto shallow auto-one scan-todo test test-one discover record convert-playwright convert-phpunit playback clear

ENV_FILE ?= .env

include $(ENV_FILE)
export $(shell sed 's/=.*//' $(ENV_FILE) 2>/dev/null)

help:
	@echo "Playwright Route Testrunner"
	@echo
	@echo "Setup:"
	@echo "  make install"
	@echo
	@echo "Scanning:"
	@echo "  make export-routes                         export Laravel routes to routes.json"
	@echo "  make auto                                  full scan using routes.json"
	@echo "  make shallow                               link-crawl scan (no routes.json needed)"
	@echo "  make auto-one ROUTE=/dashboard             scan a single route"
	@echo "  make scan-todo                             resume an interrupted scan"
	@echo
	@echo "Testing:"
	@echo "  make test                                  run all generated Playwright tests"
	@echo "  make test-one ROUTE=/dashboard             run tests matching a route"
	@echo
	@echo "Recording:"
	@echo "  make record                                open browser for manual recording"
	@echo "  make convert-playwright RECORDING=file     convert recording to Playwright test"
	@echo "  make convert-phpunit    RECORDING=file     convert recording to PHPUnit test"
	@echo "  make playback           RECORDING=file     replay a recording"
	@echo
	@echo "Maintenance:"
	@echo "  make clear                                 delete old logs and trace files"
	@echo
	@echo "Flags (set in .env or on the command line):"
	@echo "  STOP_ON_ERROR=true"
	@echo "  STOP_ON_FAIL_ROUTE=true   (alias: STOP_ON_FAILURE=true)"
	@echo "  SCREENSHOT_ON_ERROR=true"
	@echo "  TRACE=true"
	@echo "  ROUTE_PARAMS={\"external_id\":\"abc-123\"}"
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
	@if [ -z "$(ROUTES_JSON)" ]; then echo "❌ ROUTES_JSON is not set. Run 'make export-routes' first, or use 'make shallow' to scan without a route list."; exit 1; fi
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
	ROUTE_PARAMS=$(ROUTE_PARAMS) \
	npm run auto

shallow:
	APP_URL=$(APP_URL) \
	LOGIN_PATH=$(LOGIN_PATH) \
	DASHBOARD_PATH=$(DASHBOARD_PATH) \
	E2E_EMAIL=$(E2E_EMAIL) \
	E2E_PASSWORD=$(E2E_PASSWORD) \
	HEADLESS=$(HEADLESS) \
	ASSUME_AUTHENTICATED=$(ASSUME_AUTHENTICATED) \
	STOP_ON_ERROR=$(STOP_ON_ERROR) \
	STOP_ON_FAIL_ROUTE=$(STOP_ON_FAIL_ROUTE) \
	STOP_ON_FAILURE=$(STOP_ON_FAILURE) \
	SCREENSHOT_ON_ERROR=$(SCREENSHOT_ON_ERROR) \
	TRACE=$(TRACE) \
	SKIPPED_JSON=$(SKIPPED_JSON) \
	npm run auto -- --shallow

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
	ROUTE_PARAMS=$(ROUTE_PARAMS) \
	npm run auto

scan-todo:
	@if [ ! -f "todo.json" ]; then echo "❌ todo.json not found. Run 'make auto' or 'make shallow' first."; exit 1; fi
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
	ROUTE_PARAMS=$(ROUTE_PARAMS) \
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
	@test -n "$(RECORDING)" || (echo "Usage: make convert-playwright RECORDING=recordings/session-....json" && exit 1)
	npm run convert:playwright $(RECORDING)

convert-phpunit:
	@test -n "$(RECORDING)" || (echo "Usage: make convert-phpunit RECORDING=recordings/session-....json" && exit 1)
	npm run convert:phpunit $(RECORDING)

playback:
	@test -n "$(RECORDING)" || (echo "Usage: make playback RECORDING=recordings/session-....json" && exit 1)
	npm run playback $(RECORDING)

clear:
	@echo "Clearing logs and zip artifacts..."
	@rm rm -Rf storage/logs/* storage/logs/screenshots/* storage/logs/traces/* recordings/*
	@rm skipped.json
	@find . -type f -name "*.zip" -not -path "./node_modules/*" -delete
	@echo "Done."