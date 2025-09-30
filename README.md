# Advanced Playwright-based Recording System for Automated Test Generation

A comprehensive test automation system that records user interactions and generates automated tests for multiple frameworks.

## Features

✨ **Advanced Recording System**
- Records clicks, form inputs, route changes, and network requests
- Captures complete user sessions with detailed metadata
- Supports screenshots on each interaction (optional)
- Human-readable console logging

🔄 **Multi-Framework Test Generation**
- **Playwright Tests**: Modern, reliable E2E tests with auto-waiting
- **PHPUnit Tests**: Laravel Feature tests for backend validation
- **Jest Tests**: Via route discovery (discover-routes.js)

🎬 **Session Playback**
- Replay recorded sessions for debugging
- Supports both legacy and new recording formats
- Slow-motion playback for visualization

## Quick Setup

1. **Install dependencies**:
```bash
npm install --save-dev @playwright/test jest playwright
```

2. **Record a user session**:
```bash
npm run record
# Browser opens - interact with your app
# Press Ctrl+C when done
```

3. **Convert to tests**:
```bash
# Generate Playwright tests
npm run convert:playwright recordings/session-[timestamp].json

# Generate PHPUnit tests
npm run convert:phpunit recordings/session-[timestamp].json
```

4. **Replay session**:
```bash
npm run playback recordings/session-[timestamp].json
```


## Recording Configuration

You can configure the recording behavior using environment variables:

```bash
# Configure start URL (default: http://localhost:3000)
START_URL=http://localhost:8000 npm run record

# Set recording duration in milliseconds (default: 300000 = 5 minutes)
MAX_DURATION=600000 npm run record

# Disable network recording
RECORD_NETWORK=false npm run record

# Enable screenshot capture on each click
CAPTURE_SCREENSHOTS=true npm run record
```

## What Gets Recorded

### 📸 User Interactions
- **Clicks**: Element selector, text, position, tag name, data attributes
- **Form Inputs**: Field names, values, types, selectors
- **Form Submissions**: Complete form data with all fields

### 🌐 Navigation & Routes
- URL changes and page navigations
- SPA route transitions
- Full navigation history

### 🔌 Network Activity
- POST/PUT/PATCH/DELETE requests
- Request payloads and headers
- Response status and data (JSON)

### 📊 Session Metadata
- Start/end times and duration
- User agent and viewport size
- Complete interaction timeline

## Generated Test Examples

### Playwright Test Output
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

### PHPUnit Test Output
```php
class GeneratedTest extends TestCase
{
    public function test_login(): void
    {
        // Submit form with recorded data
        $response = $this->post('/login', [
            'email' => 'test@example.com',
            'password' => 'password123',
        ]);

        $response->assertSuccessful();
    }
}
```

## Usage Examples


### Run Playwright Tests
```bash
# Run all Playwright tests
npx playwright test

# Run specific test file
npx playwright test tests-playwright/generated-test-[timestamp].spec.js

# Run with headed browser (visible)
npx playwright test --headed

# Debug mode
npx playwright test --debug
```

### Run PHPUnit Tests
```bash
# Run all feature tests
php artisan test

# Run specific test
php artisan test tests/Feature/GeneratedTest[timestamp].php

# With verbose output
php artisan test --verbose
```

### Playback Recorded Sessions
```bash
# Replay a session (slow motion, visible browser)
npm run playback recordings/session-[timestamp].json
```

## Route Discovery (Alternative Workflow)

For automatic discovery of application routes and test generation:

```bash
# Discover routes and generate tests automatically
npm run discover
```

This creates:
- `tests/*.test.js` (Jest tests)
- `tests-playwright/*.spec.js` (Playwright tests)
- Configuration files for both frameworks


## Architecture

### Recording System (`advanced-recording.js`)
- Launches browser with Playwright
- Injects client-side recording scripts
- Captures all user interactions in real-time
- Saves complete session data to JSON

### Converters
- **`convert-to-playwright.js`**: Generates Playwright test files
- **`convert-to-phpunit.js`**: Generates PHPUnit Feature tests

### Playback (`playback.js`)
- Replays recorded sessions
- Supports both legacy and new formats
- Useful for debugging and validation

### Route Discovery (`discover-routes.js`, `discover-phpunit.js`)
- Automatically crawls application
- Discovers routes and forms
- Generates boilerplate tests

## Recording Format

Sessions are saved as JSON with the following structure:

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

## Benefits of This Approach

### 🎯 Precision
- Captures actual user behavior
- Real data values used in tests
- Exact interaction sequences

### ⚡ Speed
- Generate tests in seconds
- No manual test writing required
- Instant test creation from recordings

### 🔄 Flexibility
- Multiple output formats (Playwright, PHPUnit)
- Easy to customize generated tests
- Works with any web application

### 🛠️ Standard Tooling
- Uses industry-standard test frameworks
- Full IDE support and debugging
- Extensive ecosystem and plugins

### 📈 Scalability
- Record once, generate many tests
- Easy to maintain and update
- Supports complex workflows

## Extending Generated Tests

After generation, you can easily customize the tests:

### Playwright
```javascript
// Add custom assertions
test('user can login', async ({ page }) => {
  await page.goto('/login');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'password');
  await page.click('button[type="submit"]');
  
  // Add custom verification
  await expect(page.locator('.user-name')).toContainText('Test User');
  await expect(page).toHaveURL(/.*dashboard/);
});

// Add setup/teardown
test.beforeEach(async ({ page }) => {
  // Login before each test
  await page.goto('/login');
  await page.fill('[name="email"]', 'test@example.com');
  await page.fill('[name="password"]', 'password');
  await page.click('button[type="submit"]');
});
```

### PHPUnit
```php
public function test_user_can_create_post(): void
{
    $user = User::factory()->create();
    
    $response = $this->actingAs($user)->post('/posts', [
        'title' => 'Test Post',
        'content' => 'Test content',
    ]);
    
    $response->assertRedirect('/posts');
    $this->assertDatabaseHas('posts', ['title' => 'Test Post']);
}
```

## File Structure

```
testrunner/
├── advanced-recording.js      # Main recording script
├── convert-to-playwright.js   # Playwright test generator
├── convert-to-phpunit.js      # PHPUnit test generator  
├── playback.js                # Session playback script
├── discover-routes.js         # Route discovery (Jest/Playwright)
├── discover-phpunit.js        # Route discovery (PHPUnit)
├── package.json               # NPM configuration
├── recordings/                # Recorded sessions (JSON)
│   └── session-*.json
├── tests/                     # Generated PHPUnit tests
│   └── Feature/
├── tests-playwright/          # Generated Playwright tests
└── storage/                   # Logs and temporary files
    └── logs/
```

## Troubleshooting

### Browser doesn't open during recording
- Ensure Playwright is installed: `npm install playwright`
- Check if the START_URL is accessible
- Try running with headless disabled (default)

### Generated tests fail
- Verify the application is running at the correct URL
- Check selector stability (IDs are better than classes)
- Update generated tests with proper waits if needed

### Recording times out
- Increase MAX_DURATION environment variable
- Press Ctrl+C to stop recording manually

### Conversion fails
- Verify recording file exists and is valid JSON
- Check the recording file format matches expected structure

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is open source and available under the MIT License.
