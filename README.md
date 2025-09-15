# Simple Route Discovery + Standard Testing

This approach is much simpler and more maintainable than a custom framework.

## Quick Setup

1. **Create discovery script**:
```bash
# Copy discover-routes.js to your project
```

2. **Install dependencies**:
```bash
npm install --save-dev @playwright/test jest playwright
```

3. **Discover and generate tests**:
```bash
node discover-routes.js http://localhost:3000
```

This creates:
- `tests/*.test.js` (Jest tests)
- `tests-playwright/*.spec.js` (Playwright tests)
- Configuration files for both frameworks

## Usage Examples

### Run All Tests
```bash
# Jest
npm run test:jest

# Playwright
npm run test:playwright
```

### Run Specific Tests
```bash
# Jest - specific file
npm test -- clients.test.js

# Jest - specific test
npm test -- --testNamePattern="can create client"

# Playwright - specific file
npx playwright test clients.spec.js

# Playwright - specific test
npx playwright test --grep "can create client"
```

### Debug Mode
```bash
# Jest with debug
npm test -- --verbose

# Playwright with debug
npx playwright test --debug --grep "can create client"

# Playwright headed mode
npx playwright test --headed
```

## Generated Test Structure

### Jest Tests
```javascript
describe('clients module', () => {
  test('can view clients', async () => {
    await page.goto('/clients');
    await page.waitForLoadState('domcontentloaded');
    
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test('can create client', async () => {
    await page.goto('/clients/form');
    
    // Fill form automatically
    const inputs = await page.$$('input[type="text"], textarea');
    for (const input of inputs) {
      const name = await input.getAttribute('name');
      if (name) await input.fill(`Test ${name} ${Date.now()}`);
    }
    
    // Submit and verify
    await Promise.all([
      page.waitForNavigation(),
      page.click('button[type="submit"]')
    ]);
    
    const hasSuccess = await page.$('.alert-success') !== null;
    expect(hasSuccess).toBe(true);
  });
});
```

### Playwright Tests
```javascript
import { test, expect } from '@playwright/test';

test.describe('clients module', () => {
  test('can create client', async ({ page }) => {
    await page.goto('/clients/form');
    
    // Playwright's auto-waiting handles synchronization
    await page.waitForSelector('form');
    
    // Fill form
    const inputs = page.locator('input[type="text"], textarea');
    const count = await inputs.count();
    
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const name = await input.getAttribute('name');
      if (name) await input.fill(`Test ${name} ${Date.now()}`);
    }
    
    // Submit with proper waiting
    await Promise.all([
      page.waitForNavigation(),
      page.click('button[type="submit"]')
    ]);
    
    // Verify success with Playwright assertions
    await expect(page.locator('.alert-success')).toBeVisible();
  });
});
```

## Benefits of This Approach

### Leverage Existing Ecosystems
- **Jest**: Mature testing framework with extensive plugins
- **Playwright Test**: Built-in parallelization, retries, reporting
- **IDE Support**: Full IntelliSense, debugging, test runners

### Standard Tooling
```bash
# Jest watch mode
npm test -- --watch

# Playwright UI mode
npx playwright test --ui

# Built-in reporting
npx playwright show-report
```

### Easy Customization
```javascript
// Add custom helpers to Jest tests
const { fillForm, submitForm } = require('./test-helpers');

test('can create client', async () => {
  await page.goto('/clients/form');
  await fillForm(page, {
    name: 'Test Client',
    email: 'test@example.com'
  });
  await submitForm(page);
  // ... assertions
});
```

### Parallel Execution
```javascript
// Playwright runs tests in parallel by default
// Jest can be configured for parallel execution
```

## Extending Generated Tests

After generation, you can easily customize:

```javascript
// Add custom test methods
test('can upload client logo', async ({ page }) => {
  await page.goto('/clients/form');
  
  await page.setInputFiles('input[type="file"]', 'test-logo.png');
  await page.click('button[type="submit"]');
  
  await expect(page.locator('.success')).toBeVisible();
});

// Add before/after hooks
test.beforeEach(async ({ page }) => {
  // Login or setup before each test
  await page.goto('/login');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'password');
  await page.click('button[type="submit"]');
});
```

## Why This Is Better

1. **Simple**: One discovery script, standard test frameworks
2. **Maintainable**: No custom framework to maintain
3. **Powerful**: Full Jest/Playwright feature sets
4. **Fast**: `npx playwright test clients --grep "view client"` 
5. **Standard**: Team already knows Jest/Playwright
6. **Tooling**: IDE support, debugging, reporting all built-in

Instead of building a custom framework, this approach:
- Discovers routes automatically
- Generates standard Jest/Playwright tests
- Lets you use industry-standard tooling
- Provides the flexibility you need without the maintenance burden
