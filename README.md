# Playwright Test Recorder & Generator

A comprehensive test automation system that records user interactions and automatically generates test code for multiple frameworks.

## ✨ Features

- **🎬 Session Recording**: Records clicks, form inputs, route changes, and network requests with detailed metadata
- **🔄 Multi-Framework Test Generation**: Generate Playwright, PHPUnit, or Jest tests from a single recording
- **📼 Session Playback**: Replay recorded sessions for debugging and validation
- **🗺️ Known-Routes First**: Use your existing route list (for Laravel, `php artisan route:list`) to drive recording
- **🔍 Fallback Route Discovery**: Automatically crawl apps when routes are not available upfront
- **📸 Optional Screenshots**: Capture screenshots at each interaction point
- **📝 Human-Readable Logs**: Console logging for easy session review

## 🚀 Quick Start

### Installation

```bash
npm install --save-dev @playwright/test playwright jest
```

### Record a Session

```bash
npm run record
# Browser opens - interact with your app
# Press Ctrl+C when done
```

Recording is saved to `recordings/session-[timestamp].json`

### Known Routes Workflow (Recommended for Laravel)

For Laravel apps, export routes first and treat them as the source of truth:

```bash
php artisan route:list --json > routes.json
```

Then generate Playwright tests directly from that route inventory:

```bash
BASE_URL=http://localhost:8000 ROUTES_FILE=routes.json npm run discover
```

This uses your Laravel route table as the route source and generates module-based Playwright specs in `tests-playwright/`.

### Generate Tests

**Playwright Tests:**
```bash
npm run convert:playwright recordings/session-[timestamp].json
# Creates: tests-playwright/generated-test-[timestamp].spec.js
```

**PHPUnit Tests:**
```bash
npm run convert:phpunit recordings/session-[timestamp].json
# Creates: tests/Feature/GeneratedTest[timestamp].php
```

### Replay Session

```bash
npm run playback recordings/session-[timestamp].json
```

## 📋 What Gets Recorded

| Category | Details |
|----------|---------|
| **User Interactions** | Clicks (with selectors, text, position), form inputs (names, values, types), form submissions |
| **Navigation** | URL changes, SPA route transitions, full navigation history |
| **Network Activity** | POST/PUT/PATCH/DELETE requests with payloads, headers, and responses |
| **Session Metadata** | Start/end times, duration, user agent, viewport size, complete timeline |

## ⚙️ Configuration

Configure recording behavior with environment variables:

```bash
# Set start URL (default: http://localhost:3000)
START_URL=http://localhost:8000 npm run record

# Set max duration in milliseconds (default: 300000 = 5 minutes)
MAX_DURATION=600000 npm run record

# Disable network recording
RECORD_NETWORK=false npm run record

# Enable screenshot capture
CAPTURE_SCREENSHOTS=true npm run record
```

## 📂 Project Structure

```
testrunner/
├── advanced-recording.js      # Main recording script
├── convert-to-playwright.js   # Playwright test generator
├── convert-to-phpunit.js      # PHPUnit test generator  
├── playback.js                # Session playback script
├── discover-routes.js         # Route discovery (Jest/Playwright)
├── discover-phpunit.js        # Route discovery (PHPUnit)
├── utils.js                   # Shared utility functions
├── package.json               # NPM configuration
├── recordings/                # Recorded sessions (JSON)
├── tests/                     # Generated PHPUnit tests
├── tests-playwright/          # Generated Playwright tests
└── storage/logs/              # Session logs
```

## 📝 Generated Test Examples

### Playwright Test

```javascript
import { test, expect } from '@playwright/test';

test.describe('Recorded User Session', () => {
  test('should replay user interactions', async ({ page }) => {
    // Step 1: Navigate to /login
    await test.step('Navigate to /login', async () => {
      await page.goto('http://localhost:3000/login');
      await page.waitForLoadState('networkidle');
    });

    // Step 2: Fill "email" with "test@example.com"
    await test.step('Fill email', async () => {
      await page.locator('[name=\'email\']').fill('test@example.com');
    });

    // Step 3: Click "Sign In"
    await test.step('Click "Sign In"', async () => {
      const element = page.locator('button[type=\'submit\']').first();
      await element.waitFor({ state: 'visible', timeout: 10000 });
      await element.click();
      await page.waitForLoadState('networkidle');
    });
  });
});
```

**Run it:**
```bash
npx playwright test tests-playwright/generated-test-*.spec.js
npx playwright test --headed  # Run with visible browser
npx playwright test --debug   # Debug mode
```

### PHPUnit Test

```php
class GeneratedTest extends TestCase
{
    public function test_login(): void
    {
        // Submit form with recorded data
        $response = $this->actingAs($this->user)->post('/login', [
            'email' => 'test@example.com',
            'password' => 'password123',
        ]);

        $response->assertSessionHasNoErrors();
        $response->assertStatus(302);
    }
}
```

**Run it:**
```bash
php artisan test                                    # All tests
php artisan test tests/Feature/GeneratedTest*.php  # Specific test
php artisan test --verbose                         # Verbose output
```

## 🔍 Route Discovery (Fallback for Exotic/Non-Laravel Apps)

If your app cannot provide routes upfront (for example, exotic or non-Laravel stacks), use crawler-based discovery:

```bash
npm run discover
```

This crawls your application and creates:
- `tests/*.test.js` (Jest tests)
- `tests-playwright/*.spec.js` (Playwright tests)
- Configuration files for both frameworks

## 🎯 Benefits

| Benefit | Description |
|---------|-------------|
| **Precision** | Captures actual user behavior, real data values, and exact interaction sequences |
| **Speed** | Generate complete tests in seconds with no manual writing required |
| **Flexibility** | Multiple output formats, easy customization, works with any web application |
| **Standard Tooling** | Uses industry-standard frameworks with full IDE support and debugging |
| **Scalability** | Record once, generate many tests; easy to maintain and update |

## 🛠️ Extending Generated Tests

Generated tests are fully editable. Enhance them with:

**Custom assertions:**
```javascript
await expect(page.locator('.user-name')).toContainText('Test User');
await expect(page).toHaveURL(/.*dashboard/);
```

**Setup/teardown:**
```javascript
test.beforeEach(async ({ page }) => {
  // Login before each test
  await page.goto('/login');
  // ... login steps
});
```

**Database verification (PHPUnit):**
```php
$this->assertDatabaseHas('posts', ['title' => 'Test Post']);
```

## 📊 Recording Format

Sessions are saved as JSON:

```json
{
  "metadata": {
    "startTime": "ISO timestamp",
    "startUrl": "http://...",
    "userAgent": "...",
    "viewport": { "width": 1280, "height": 720 },
    "duration": 150000
  },
  "clicks": [...],
  "routes": [...],
  "formData": [...],
  "networkRequests": [...],
  "screenshots": [...]
}
```

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| **Browser doesn't open** | Ensure Playwright is installed: `npm install playwright`<br>Verify START_URL is accessible |
| **Generated tests fail** | Check selector stability (prefer IDs over classes)<br>Add proper waits in tests<br>Verify app is running at correct URL |
| **Recording times out** | Increase MAX_DURATION environment variable<br>Or manually stop with Ctrl+C |
| **Conversion fails** | Verify recording file exists and is valid JSON<br>Check file format matches expected structure |

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is open source and available under the MIT License.
