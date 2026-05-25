# Copilot Instructions — Behavioral Playwright/PHPUnit Generation

This repository generates tests for **other projects**. Generated tests must prioritize **business confidence** over superficial coverage.

## Non-Negotiable Principle
A generated test is valid only when it proves an end-user business capability. Avoid route-smoke or selector-smoke output.

## Required Test Shape (Playwright)
Every generated/refactored Playwright test must include:
1. Navigation to workflow entry
2. Meaningful user action
3. State transition trigger
4. Business outcome assertion
5. Resulting application-state assertion

## Required Test Shape (PHPUnit)
Every generated/refactored PHPUnit test must include:
1. Seed/arrange realistic domain state
2. Perform action (HTTP/domain service)
3. Assert behavioral outcome (redirect/validation/authorization/domain effect)
4. Assert persisted/state mutation (DB/session/queued effect)

## Allowed Assertions (when relevant)
- Authentication success/failure
- Authorization boundaries
- Validation failures/success with field-level errors
- CRUD persistence and visibility
- Redirect correctness
- Session mutation
- Search/filter behavior changes
- Workflow completion and lifecycle transitions

## Forbidden in Isolation
Do not emit tests that only assert:
- HTTP 200/OK
- response.ok()
- element/link/button visibility only
- route availability
- static markup/DOM structure
- CSS class presence
- framework internals

If a visibility/assertion is used, pair it with business-state verification.

## Generator/Refactor Guidance
- Prefer resilient selectors (roles, labels, accessible names) over brittle CSS chains.
- Avoid loop-generated mega tests; prefer explicit scenario tests with clear user intent.
- Do not over-abstract into heavy POM layers for generated output.
- Keep assertions user-observable and business-meaningful.

## Quality Gate (must pass before writing output)
- Does the test prove a business capability?
- Would deleting this test reduce behavioral confidence?
- Is there a clear action → outcome causal chain?
- Does it verify resulting state (not just rendering)?
- Is it resilient to moderate UI refactors?

If any answer is “no”, continue refactoring instead of finalizing.

## Mandatory Self-Audit Block
For any generated/refactored test output, append a machine-readable audit section with:
- Completed behavioral improvements
- Weak assertions removed
- Remaining weaknesses
- Structural coupling remaining
- TODO gaps

Never claim completion while gaps remain.
