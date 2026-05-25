# Junie Rubric — Behavioral PHPUnit Generation

## Scope
When generating PHPUnit tests from recordings/routes, convert technical traces into domain-behavior scenarios.

## Required Assertions
- Authorization policy behavior (allow/deny)
- Validation contract (specific failing fields/messages where appropriate)
- Persistence mutation (database has/doesntHave)
- Redirect/session/flash semantics
- Lifecycle transitions (draft → submitted, etc.)

## Avoid
- plain `assertStatus(200)` as primary success criterion
- route-only smoke checks
- assertions bound only to template fragments

## Minimum Scenario Structure
1. Arrange realistic fixtures/factories
2. Act with meaningful request payload
3. Assert response intent (redirect, validation, forbidden)
4. Assert resulting domain state in database/session

## Completion Rule
A test is incomplete if it lacks post-action state verification.
