const { chromium } = require('playwright');
const fs = require('fs');

/**
 * A class to launch a browser, crawl an application, discover routes,
 * and automatically generate boilerplate Jest and Playwright E2E tests.
 */
class RouteDiscovery {
    constructor(baseUrl, options = {}) {
        // Normalize base URL (e.g., http://locahost:3000)
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.options = {
            // Configuration moved here for clarity
            loginUrl: '/sessions/login',
            email: 'a@a.com',
            password: 'demopassword',
            // --- New: Configurable login selectors ---
            emailSelector: 'input[name="email"], input[id="email"]',
            passwordSelector: 'input[name="password"], input[id="password"]',
            submitSelector: 'button[type="submit"], input[type="submit"]',
            // ----------------------------------------
            ...options
        };
        this.discoveredRoutes = [];
    }

    // =================================================================
    // CORE EXECUTION
    // =================================================================

    async discover() {
        let browser;
        let context;
        try {
            // Launch in headless mode by default for speed, but allow options to override
            // New: Added this.options.browserOptions for configurability
            browser = await chromium.launch({ headless: true, ...this.options.browserOptions });
            context = await browser.newContext();
            const page = await context.newPage();

            await this.runDiscovery(page);

        } catch (error) {
            console.error('\nFATAL ERROR during discovery process:', error.message);
        } finally {
            // Robustly ensure browser is closed
            if (browser) {
                await browser.close();
            }
        }
    }
    
    async runDiscovery(page) {
        console.log(`Attempting login to ${this.baseUrl}${this.options.loginUrl}...`);
        await this.login(page);

        console.log(`\nStarting route crawl from ${this.baseUrl}...`);
        // The core crawling logic
        const routes = await this.crawlRoutes(page);
        
        console.log(`\nDiscovered ${routes.length} unique routes.`);

        // --- New: Log discovered routes by module ---
        const moduleGroups = this.groupByModule(routes);

        console.log(`\n\x1b[35m--- Routes by Module ---\x1b[0m`);
        for (const [module, moduleRoutes] of Object.entries(moduleGroups)) {
            // Only log non-AJAX routes for simplicity
            const accessibleRoutes = moduleRoutes.filter(r => r.type !== 'ajax'); 
            if (accessibleRoutes.length > 0) {
                console.log(`\x1b[36m${module} (${accessibleRoutes.length} accessible routes):\x1b[0m`);
                accessibleRoutes.forEach(r => console.log(`  - [${r.type.toUpperCase()}] ${r.url.replace(this.baseUrl, '') || '/'}`));
            }
        }
        console.log(`\x1b[35m------------------------\x1b[0m`);
        // ------------------------------------------

        await this.generateTests(routes);
        
        return routes;
    }

    // =================================================================
    // BROWSER INTERACTION
    // =================================================================
    
    async login(page) {
        try {
            // Use config options for login path and selectors
            await page.goto(`${this.baseUrl}${this.options.loginUrl}`, { waitUntil: 'domcontentloaded' });
            await page.fill(this.options.emailSelector, this.options.email);
            await page.fill(this.options.passwordSelector, this.options.password);
            
            // New: Improved Promise.all with a generous timeout
            await Promise.all([
                page.waitForNavigation({ timeout: 30000 }),
                page.click(this.options.submitSelector)
            ]);

            // New: Basic check if login was successful
            if (page.url().includes(this.options.loginUrl)) {
                console.warn('⚠️ Login failed or redirected back to login page. Crawling may fail.');
            } else {
                console.log('✅ Login successful.');
            }
        } catch (error) {
            console.error(`Error during login: ${error.message}`);
        }
    }
    
    async crawlRoutes(page) {
        const routes = new Set();
        const visited = new Set();
        const toVisit = [this.baseUrl];
        // New: Filter to ignore common static file extensions
        const linkFilter = /\.(css|js|png|jpg|gif|svg|ico|pdf|zip|xml)$/i; 
        
        let crawledCount = 0;
        const maxCrawlDepth = 500; 

        while (toVisit.length > 0 && crawledCount < maxCrawlDepth) {
            const url = toVisit.pop();
            
            // --- Improved URL normalization ---
            let cleanUrl = url.split('?')[0];
            // Remove trailing slash, unless it's the base URL
            if (cleanUrl.endsWith('/') && cleanUrl !== this.baseUrl) {
                cleanUrl = cleanUrl.slice(0, -1);
            }
            if (visited.has(cleanUrl)) continue;
            // ----------------------------------
            
            visited.add(cleanUrl);
            crawledCount++;

            try {
                await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                
                routes.add({
                    url: cleanUrl,
                    type: this.determineRouteType(cleanUrl),
                    module: this.extractModule(cleanUrl)
                });
                
                // Find all links on the page
                const links = await page.locator('a[href]').evaluateAll(elements => 
                    elements.map(el => el.href)
                );
                
                links.forEach(link => {
                    if (link.startsWith(this.baseUrl) && 
                        !link.includes('#') && 
                        !link.includes('javascript:') &&
                        // Use the new filter
                        !linkFilter.test(link)
                    ) {
                        // --- Improved Link Normalization ---
                        let nextUrl = link.split('?')[0];
                        if (nextUrl.endsWith('/') && nextUrl !== this.baseUrl) {
                            nextUrl = nextUrl.slice(0, -1);
                        }
                        if (!visited.has(nextUrl)) {
                            toVisit.push(nextUrl);
                        }
                        // ------------------------------------
                    }
                });
                
                // Live progress bar for long crawls
                process.stdout.write(`\rCrawled ${crawledCount} routes...`);

            } catch (error) {
                console.log(`\nError crawling ${cleanUrl}:`, error.message.substring(0, 80) + '...');
            }
        }
        
        return Array.from(routes);
    }
    
    // =================================================================
    // ROUTE ANALYSIS
    // =================================================================
    
    determineRouteType(url) {
        const path = url.replace(this.baseUrl, '').toLowerCase();
        // New: Added '/new' to form routes
        if (path.includes('/form') || path.includes('/create') || path.includes('/edit') || path.includes('/new')) return 'form';
        if (path.includes('/view') || path.match(/\/\d+$/)) return 'view';
        // New: Added '/api/' for better AJAX detection
        if (path.includes('/ajax') || path.includes('.json') || path.includes('/api/')) return 'ajax';
        return 'index';
    }
    
    extractModule(url) {
        const path = url.replace(this.baseUrl, '').replace(/^\//, '');
        const module = path.split('/')[0] || 'core';
        return module;
    }

    groupByModule(routes) {
        return routes.reduce((groups, route) => {
            if (!groups[route.module]) groups[route.module] = [];
            groups[route.module].push(route);
            return groups;
        }, {});
    }

    // =================================================================
    // TEST GENERATION
    // =================================================================

    async generateTests(routes) {
        const moduleGroups = this.groupByModule(routes);
        
        // Ensure directories exist
        if (!fs.existsSync('tests')) fs.mkdirSync('tests');
        if (!fs.existsSync('tests-playwright')) fs.mkdirSync('tests-playwright');
        
        // Generate configs
        this.generateJestConfig();
        this.generatePlaywrightConfig();
        
        // Generate test files
        for (const [module, moduleRoutes] of Object.entries(moduleGroups)) {
            fs.writeFileSync(`tests/${module}.test.js`, this.generateJestTestFile(module, moduleRoutes));
            fs.writeFileSync(`tests-playwright/${module}.spec.js`, this.generatePlaywrightTestFile(module, moduleRoutes));
        }
        
        console.log('\n\n✅ Generated test files:');
        console.log(`- ${Object.keys(moduleGroups).length} Jest files in 'tests/'`);
        console.log(`- ${Object.keys(moduleGroups).length} Playwright files in 'tests-playwright/'`);
    }

    generateJestConfig() {
        // ... Jest config generation logic is mostly the same
        const config = `module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  // Increased timeout for Playwright operations
  testTimeout: 60000 
};`;
        fs.writeFileSync('jest.config.js', config);
        
        const setup = `const { chromium } = require('playwright');
const BASE_URL = '${this.baseUrl}';

let browser;
let context;
let page;

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext();
  page = await context.newPage();
  
  // Login once for all tests, using config variables
  await page.goto(\`\${BASE_URL}${this.options.loginUrl}\`);
  await page.fill('${this.options.emailSelector}', '${this.options.email}');
  await page.fill('${this.options.passwordSelector}', '${this.options.password}');
  
  // New: Better wait condition for navigation (wait for URL to change away from login)
  await Promise.all([
    page.waitForURL(url => !url.includes('${this.options.loginUrl}')),
    page.click('${this.options.submitSelector}')
  ]);
  
  global.page = page;
});

afterAll(async () => {
  await browser.close();
});`;
        
        fs.writeFileSync('tests/setup.js', setup);
    }
    
    generatePlaywrightConfig() {
        const config = `import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests-playwright',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: 'html',
  use: {
    // Inject the actual baseURL
    baseURL: '${this.baseUrl}',
    trace: 'on-first-retry',
  },
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // New: Added globalSetup to handle login and save authentication state
  globalSetup: require.resolve('./tests-playwright/global-setup.js'),
});`;
        fs.writeFileSync('playwright.config.js', config);

        // New: Playwright global-setup for login persistence (best practice)
        const globalSetup = `import { chromium } from '@playwright/test';

async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Login
  await page.goto('${this.baseUrl}${this.options.loginUrl}');
  await page.fill('${this.options.emailSelector}', '${this.options.email}');
  await page.fill('${this.options.passwordSelector}', '${this.options.password}');
  
  await Promise.all([
    page.waitForURL(url => !url.includes('${this.options.loginUrl}')),
    page.click('${this.options.submitSelector}')
  ]);
  
  // Save authentication state to be used in all tests
  await page.context().storageState({ path: 'storageState.json' });
  await browser.close();
}

export default globalSetup;`;

        fs.writeFileSync('tests-playwright/global-setup.js', globalSetup);
    }
    
    // =================================================================
    // TEST CONTENT GENERATION
    // =================================================================
    
    generateJestTestFile(module, routes) {
        // Filter out 'ajax' routes as they don't usually load a full page
        const tests = routes.filter(r => r.type !== 'ajax').map(route => this.generateJestTest(route)).join('\n\n');
        
        return `describe('${module} module', () => {
  // 'page' is available globally from tests/setup.js
  const page = global.page; 

${tests}
});`;
    }
    
    generatePlaywrightTestFile(module, routes) {
        const tests = routes.filter(r => r.type !== 'ajax').map(route => this.generatePlaywrightTest(route)).join('\n\n');
        
        return `import { test, expect } from '@playwright/test';

// Use the saved authentication state from global-setup
test.use({ storageState: 'storageState.json' }); 

test.describe('${module} module', () => {
${tests}
});`;
    }
    
    generateJestTest(route) {
        const testName = this.generateTestName(route);
        // Use relative URL (Playwright automatically prepends baseURL)
        const relativeUrl = route.url.replace(this.baseUrl, ''); 
        
        if (route.type === 'form') {
            return `  test('${testName}', async () => {
    // Navigate to form page
    await page.goto('${relativeUrl}');
    
    // New: Better selector to exclude hidden/submit/button inputs
    const inputs = await page.$$('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([readonly]), textarea:not([readonly])');
    
    for (const input of inputs) {
      const name = await input.getAttribute('name');
      if (name) { // Skip inputs without a name
        // Avoid filling disabled/checked inputs
        const type = (await input.getAttribute('type') || '').toLowerCase();
        if (type !== 'checkbox' && type !== 'radio') {
            await input.fill(\`Test \${name} \${Date.now()}\`);
        }
      }
    }
    
    // Submit form and wait for navigation
    await Promise.all([
      page.waitForNavigation({ timeout: 15000 }),
      page.click('${this.options.submitSelector}')
    ]);
    
    // New: Included common Filament success selector
    const hasSuccess = await page.$('.alert-success, .success-message, .filament-notifications-body') !== null;
    expect(hasSuccess).toBe(true);
  });`;
        }
        
        return `  test('${testName}', async () => {
    // Basic page access test
    await page.goto('${relativeUrl}');
    
    await page.waitForLoadState('domcontentloaded');
    
    // Assert title exists and content body has substantial text
    const title = await page.title();
    expect(title).toBeTruthy();
    
    const bodyText = await page.textContent('body', { timeout: 5000 });
    expect(bodyText.length).toBeGreaterThan(100);
  });`;
    }
    
    generatePlaywrightTest(route) {
        const testName = this.generateTestName(route);
        const relativeUrl = route.url.replace(this.baseUrl, '');
        
        if (route.type === 'form') {
            return `  test('${testName}', async ({ page }) => {
    // Use test.step for cleaner reporting
    await test.step('Navigate to form', async () => {
      await page.goto('${relativeUrl}');
      await page.waitForSelector('form', { timeout: 10000 });
    });

    await test.step('Fill and Submit Form', async () => {
      // Better locator for form inputs
      const inputs = page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([readonly]), textarea:not([readonly])');
      const count = await inputs.count();
      
      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);
        const name = await input.getAttribute('name');
        if (name) {
            const type = await input.getAttribute('type') || '';
            // Only fill text-like fields
            if (!['checkbox', 'radio'].includes(type.toLowerCase())) {
                await input.fill(\`Test \${name} \${Date.now()}\`);
            }
        }
      }
      
      await Promise.all([
        // Wait for URL change (assuming a redirect on success)
        page.waitForURL(url => !url.includes('${relativeUrl}')), 
        page.click('${this.options.submitSelector}')
      ]);
    });

    // New: Use Playwright's stronger assertion to wait for visibility
    await expect(page.locator('.alert-success, .success-message, .filament-notifications-body')).toBeVisible();
  });`;
        }
        
        return `  test('${testName}', async ({ page }) => {
    await page.goto('${relativeUrl}');
    
    // Basic page load verification
    await expect(page).toHaveTitle(/.+/);
    
    // Assert body contains substantial text
    const body = page.locator('body');
    await expect(body).toHaveText(/.{100,}/);
  });`;
    }
    
    // --- Improved generateTestName for clearer Form names ---
    generateTestName(route) {
        // Remove base URL, remove leading slash
        const path = route.url.replace(this.baseUrl, '').replace(/^\//, '');
        // Split by segment, filtering out empty strings and numbers
        const segments = path.split('/').filter(s => s && !s.match(/^\d+$/));
        
        // Use the module name in the test name for better context
        const moduleContext = `[${route.module}]`;

        switch (route.type) {
            case 'form':
                // Check if path contains typical 'edit' keywords or ends with an ID
                if (path.includes('/edit') || route.url.match(/\/\d+$/)) { 
                    return `can edit ${segments[0]} ${moduleContext}`;
                }
                // Check if path contains typical 'create/new' keywords
                if (path.includes('/new') || path.includes('/create')) {
                    return `can create ${segments[0]} ${moduleContext}`;
                }
                return `can use form on ${segments.join(' ') || 'homepage'} ${moduleContext}`;

            case 'view':
                return `can view ${segments.join(' ') || 'record'} ${moduleContext}`;

            default: // index type
                return `can access ${segments.join(' ') || 'homepage'} ${moduleContext}`;
        }
    }
    // --------------------------------------------------------
}  // end of class maybe?

// Usage
async function main() {
    const baseUrl = process.argv[2] || 'http://localhost:3000';
    
    // New: Allows configuration via environment variables
    const options = {
        email: process.env.TEST_EMAIL || 'a@a.com',
        password: process.env.TEST_PASSWORD || 'demopassword',
        browserOptions: { headless: process.env.HEADLESS !== 'false' },
        // --- Added environment variable for custom login selectors ---
        emailSelector: process.env.EMAIL_SELECTOR,
        passwordSelector: process.env.PASSWORD_SELECTOR,
        submitSelector: process.env.SUBMIT_SELECTOR,
        loginUrl: process.env.LOGIN_URL
    };

    const discovery = new RouteDiscovery(baseUrl, options);
    
    // New: Added basic ANSI color codes for console output
    console.log(`\n\x1b[34m--- Route Discovery Tool ---\x1b[0m`);
    console.log(`\x1b[33mBase URL:\x1b[0m ${baseUrl}`);
    
    await discovery.discover();
    
    console.log('\n\x1b[32m--- Instructions ---\x1b[0m');
    console.log('\x1b[36mGenerated files:\x1b[0m');
    console.log(`- \x1b[37mjest.config.js\x1b[0m`);
    console.log(`- \x1b[37mplaywright.config.js\x1b[0m`);
    console.log(`- \x1b[37mtests/*.test.js\x1b[0m (Jest)`);
    console.log(`- \x1b[37mtests-playwright/*.spec.js\x1b[0m (Playwright)`);
    console.log('\n\x1b[36mTo run tests:\x1b[0m');
    console.log('\x1b[37m- Jest:\x1b[0m \x1b[35mnpm test\x1b[0m (Requires setup)');
    console.log('\x1b[37m- Playwright:\x1b[0m \x1b[35mnpx playwright test\x1b[0m');
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { RouteDiscovery };
