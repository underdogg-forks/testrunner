# Junie Rubric — Behavioral Refactor Standard

Use this rubric whenever creating/refactoring Playwright tests.

## Goal
Maximize confidence in business behavior, not route count.

## Step Protocol (required)
1. Define task and intended business capability.
2. Execute changes.
3. Audit outcomes.
4. Mark complete/incomplete honestly.
5. If incomplete, document why and list concrete TODO remediation.

## Weak Assertion Detection Checklist
Mark as weak unless paired with business-state assertions:
- `expect(response.ok()).toBeTruthy()`
- `expect(response.status()).toBe(200)`
- `toBeVisible()` on button/link/selector with no workflow outcome
- “page renders” assertions only
- replay-only click scripts without domain assertions

## Strong Assertion Patterns
- Failed login keeps user unauthenticated and surfaces validation/auth error.
- Successful create updates list/detail view and persists record.
- Unauthorized actor receives redirect/403 and no forbidden mutation occurs.
- Filter/search changes result set and reset restores baseline.
- Workflow transition changes status and enables/disables next step.

## Output Contract
Each authored/refactored test should clearly encode:
- user role
- starting state
- action
- expected business result
- persisted/app state verification

## Mandatory Self-Audit Template
### Self Audit
#### Completed
- ...

#### Weak Assertions Removed
- ...

#### Remaining Weaknesses
- ...

#### Structural Coupling Remaining
- ...

#### TODO
- ...
