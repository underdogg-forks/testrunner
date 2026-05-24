const { chromium, errors } = require('playwright');
const fs = require('fs');
const path = require('path');

function urlIncludes(url, fragment) {
    if (!url || !fragment) return false;
    return String(url).includes(fragment);
}

/**
 * A class to launch a browser, crawl an application, discover routes,
 * and automatically generate boilerplate Jest and Playwright E2E tests.
 * * IMPROVEMENT: This version is adapted for Laravel Filament (Livewire-based) 
 * by simulating clicks and monitoring URL changes via the History API,
 * instead of relying on traditional a[href] and page.goto().
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
            routeInventoryExclusions: ['_', 'api/', 'sanctum/csrf-cookie'],
            // ----------------------------------------
            ...options
        };
        this.discoveredRoutes = [];
    }

    // =================================================================
    // CORE EXECUTION
    // =================================================================

    async discover() {
        if (this.options.routesFile) {
            const routes = this.loadLaravelRoutesFromJson(this.options.routesFile);
            console.log(`\nUsing route inventory from ${this.options.routesFile}...`);
            console.log(`\nDiscovered ${routes.length} unique routes.`);

            const moduleGroups = this.groupByModule(routes);
            console.log(`\n\x1b[35m--- Routes by Module ---\x1b[0m`);
            for (const [module, moduleRoutes] of Object.entries(moduleGroups)) {
                const accessibleRoutes = moduleRoutes.filter(r => r.type !== 'ajax');
                if (accessibleRoutes.length > 0) {
                    console.log(`\x1b[36m${module} (${accessibleRoutes.length} accessible routes):\x1b[0m`);
                    accessibleRoutes.forEach(r => console.log(`  - [${r.type.toUpperCase()}] ${r.url.replace(this.baseUrl, '') || '/'}`));
                }
            }
            console.log(`\x1b[35m------------------------\x1b[0m`);

            await this.generateTests(routes);
            return;
        }

        let browser;
        let context;
        try {
            // Launch in headless mode by default for speed, but allow options to override
            browser = await chromium.launch({ headless: true, ...this.options.browserOptions });
            // Set a global default timeout for all Playwright operations
            context = await browser.newContext({
                // Added a reasonable default timeout for navigation and actions
                actionTimeout: 15000, 
                navigationTimeout: 30000 
            });
            const page = await context.newPage();

            await this.runDiscovery(page);

        } catch (error) {
            // Added Playwright timeout error handling
            if (error instanceof errors.TimeoutError) {
                console.error('\nFATAL ERROR: Operation timed out. Check if the application is running and the BASE_URL is correct.');
            } else {
                console.error('\nFATAL ERROR during discovery process:', error.message);
            }
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
        // Use the authenticated page to start crawling
        const routes = await this.crawlRoutes(page);
        
        console.log(`\nDiscovered ${routes.length} unique routes.`);

        // Log discovered routes (kept the improved logging from the previous version)
        const moduleGroups = this.groupByModule(routes);
        console.log(`\n\x1b[35m--- Routes by Module ---\x1b[0m`);
        for (const [module, moduleRoutes] of Object.entries(moduleGroups)) {
            const accessibleRoutes = moduleRoutes.filter(r => r.type !== 'ajax'); 
            if (accessibleRoutes.length > 0) {
                console.log(`\x1b[36m${module} (${accessibleRoutes.length} accessible routes):\x1b[0m`);
                accessibleRoutes.forEach(r => console.log(`  - [${r.type.toUpperCase()}] ${r.url.replace(this.baseUrl, '') || '/'}`));
            }
        }
        console.log(`\x1b[35m------------------------\x1b[0m`);
        
        await this.generateTests(routes);
        
        return routes;
    }

    loadLaravelRoutesFromJson(routesFile) {
        const absolutePath = path.isAbsolute(routesFile) ? routesFile : path.resolve(process.cwd(), routesFile);
        if (!fs.existsSync(absolutePath)) {
            throw new Error(`Routes file not found: ${absolutePath}`);
        }

        const raw = fs.readFileSync(absolutePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) {
            throw new Error('Expected Laravel route:list JSON output to be an array');
        }

        const discovered = [];
        const seen = new Set();

        for (const route of parsed) {
            const uri = (route.uri || '').toString().trim();
            if (!uri) continue;
            if (this.shouldExcludeInventoryRoute(uri)) continue;

            const methodsRaw = route.method || route.methods || '';
            const methods = Array.isArray(methodsRaw)
                ? methodsRaw.map(m => String(m).toUpperCase())
                : String(methodsRaw).split('|').map(m => m.trim().toUpperCase()).filter(Boolean);

            if (!methods.includes('GET') && !methods.includes('HEAD')) continue;

            const normalizedUri = uri === '/' ? '' : `/${uri.replace(/^\/+/, '')}`;
            const fullUrl = normalizedUri ? `${this.baseUrl}${normalizedUri}` : `${this.baseUrl}/`;
            if (seen.has(fullUrl)) continue;
            seen.add(fullUrl);

            discovered.push({
                url: fullUrl,
                type: this.determineRouteType(fullUrl),
                module: this.extractModule(fullUrl),
                methods
            });
        }

        return discovered;
    }

    shouldExcludeInventoryRoute(uri) {
        const exclusions = Array.isArray(this.options.routeInventoryExclusions)
            ? this.options.routeInventoryExclusions
            : [];
        return exclusions.some(pattern => {
            if (!pattern) return false;
            if (pattern.endsWith('/')) return uri.startsWith(pattern);
            if (pattern.startsWith('_')) return uri.startsWith(pattern);
            return uri === pattern;
        });
    }

    // =================================================================
    // BROWSER INTERACTION
    // =================================================================
    
    async login(page) {
        try {
            await page.goto(`${this.baseUrl}${this.options.loginUrl}`, { waitUntil: 'domcontentloaded' });
            await page.fill(this.options.emailSelector, this.options.email);
            await page.fill(this.options.passwordSelector, this.options.password);
            
            await Promise.all([
                // Wait for URL to change (away from the login URL)
                page.waitForURL(url => !urlIncludes(url, this.options.loginUrl), { timeout: 30000 }),
                page.click(this.options.submitSelector)
            ]);

            if (page.url().includes(this.options.loginUrl)) {
                console.warn('⚠️ Login failed or redirected back to login page. Crawling may fail.');
            } else {
                console.log('✅ Login successful.');
            }
        } catch (error) {
            console.error(`Error during login: ${error.message}`);
        }
    }

    /**
     * Helper function to click an element and wait for a URL change (Livewire/SPA style)
     */
    async waitAndClick(page, element) {
        // Get the URL *before* the click
        const initialUrl = page.url();
        
        try {
            // Start waiting for the URL to change
            const navigationPromise = page.waitForURL(url => String(url) !== initialUrl, { timeout: 15000 });
            
            // Perform the click action
            await element.click();

            // Wait for the navigation to complete
            await navigationPromise;
            return page.url();

        } catch (error) {
            // Ignore timeout errors, as not every link click causes a URL change (e.g., modals, form buttons)
            if (error instanceof errors.TimeoutError) {
                return initialUrl; // Return the initial URL if no navigation happened
            }
            throw error;
        }
    }
    
    async crawlRoutes(page) {
        const routes = new Set();
        const visited = new Set();
        // Use a set for toVisit to prevent duplicates before processing
        const toVisit = new Set([this.baseUrl]); 
        
        // New: Filter to ignore common static file extensions
        const linkFilter = /\.(css|js|png|jpg|gif|svg|ico|pdf|zip|xml)$/i; 
        
        let crawledCount = 0;
        const maxCrawlDepth = 500; 

        // Convert Set to Array for standard loop/pop behavior
        const queue = Array.from(toVisit);

        while (queue.length > 0 && crawledCount < maxCrawlDepth) {
            const url = queue.pop();
            
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
                // Navigate to the clean URL
                await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
                
                routes.add({
                    url: cleanUrl,
                    type: this.determineRouteType(cleanUrl),
                    module: this.extractModule(cleanUrl)
                });
                
                // --- Filament/Livewire Crawling Strategy ---
                // Look for links in common navigation areas
                const linkSelector = 'aside a[href], nav a[href], .fi-sidebar-item, button, [wire:click]';
                
                // Filter to only get elements that are actually links or sidebars items
                const elements = await page.locator(linkSelector).all();

                for (const element of elements) {
                    const href = await element.getAttribute('href');
                    const text = await element.textContent();

                    let nextUrl = null;

                    if (href && href.startsWith(this.baseUrl) && !linkFilter.test(href)) {
                        // Standard link (e.g., Logout or external link)
                        nextUrl = href.split('?')[0];
                    } else if (await element.isVisible() && text && text.trim().length > 0) {
                        // This is a Livewire component (e.g., fi-sidebar-item) - we must click it.
                        try {
                            const newUrl = await this.waitAndClick(page, element);
                            if (newUrl !== cleanUrl && newUrl.startsWith(this.baseUrl)) {
                                nextUrl = newUrl.split('?')[0];
                                
                                // Return to the original page for the next link in the loop
                                await page.goto(cleanUrl); 
                            }
                        } catch (clickError) {
                            // Suppress errors for non-navigation clicks (like modals)
                        }
                    }

                    if (nextUrl) {
                        // Normalize the discovered URL
                        if (nextUrl.endsWith('/') && nextUrl !== this.baseUrl) {
                            nextUrl = nextUrl.slice(0, -1);
                        }
                        if (!visited.has(nextUrl) && !toVisit.has(nextUrl)) {
                            toVisit.add(nextUrl);
                            queue.push(nextUrl); // Add to the queue for processing
                        }
                    }
                }
                
                // Live progress bar for long crawls
                process.stdout.write(`\rCrawled ${crawledCount} routes...`);

            } catch (error) {
                // Log only non-timeout errors
                if (!(error instanceof errors.TimeoutError)) {
                    console.log(`\nError crawling ${cleanUrl}:`, error.message.substring(0, 80) + '...');
                } else {
                    console.log(`\nTimeout crawling ${cleanUrl}`);
                }
            }
        }
        
        return Array.from(routes);
    }
    
    // =================================================================
    // ROUTE ANALYSIS (No change needed here)
    // =================================================================
    
    determineRouteType(url) {
        const path = url.replace(this.baseUrl, '').toLowerCase();
        if (path.includes('/form') || path.includes('/create') || path.includes('/edit') || path.includes('/new')) return 'form';
        if (path.includes('/view') || path.match(/\/\d+$/)) return 'view';
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
    // TEST GENERATION (Selectors updated for robustness)
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
        const config = `module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
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
  
  await Promise.all([
    page.waitForURL(url => !url.toString().includes('${this.options.loginUrl}')),
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
    baseURL: '${this.baseUrl}',
    trace: 'on-first-retry',
  },
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  globalSetup: require.resolve('./tests-playwright/global-setup.js'),
});`;
        fs.writeFileSync('playwright.config.js', config);

        const globalSetup = `import { chromium } from '@playwright/test';

async function globalSetup() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  // Login
  await page.goto('${this.baseUrl}${this.options.loginUrl}');
  await page.fill('${this.options.emailSelector}', '${this.options.email}');
  await page.fill('${this.options.passwordSelector}', '${this.options.password}');
  
  await Promise.all([
    page.waitForURL(url => !url.toString().includes('${this.options.loginUrl}')),
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
        const tests = routes.filter(r => r.type !== 'ajax').map(route => this.generateJestTest(route)).join('\n\n');
        
        return `describe('${module} module', () => {
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
        const relativeUrl = route.url.replace(this.baseUrl, ''); 
        
        if (route.type === 'form') {
            return `  test('${testName}', async () => {
    // Navigate to form page and wait for Livewire component to load
    await page.goto('${relativeUrl}');
    await page.waitForLoadState('networkidle');
    
    // Selector updated to exclude disabled/readonly fields
    const inputs = await page.$$('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])');
    
    for (const input of inputs) {
      const name = await input.getAttribute('name');
      if (name) {
        const type = (await input.getAttribute('type') || '').toLowerCase();
        if (type !== 'checkbox' && type !== 'radio' && type !== 'file') {
            await input.fill(\`Test \${name} \${Date.now()}\`);
        }
      }
    }
    
    // Submit form and wait for navigation (Filament often redirects on success)
    await Promise.all([
      // Wait for URL change away from the form URL
      page.waitForURL(url => !url.toString().includes('${relativeUrl}'), { timeout: 15000 }), 
      page.click('${this.options.submitSelector}')
    ]);
    
    // Check for Filament success notification
    const hasSuccess = await page.$('.alert-success, .success-message, .filament-notifications-body') !== null;
    expect(hasSuccess).toBe(true);
  });`;
        }
        
        return `  test('${testName}', async () => {
    // Basic page access test
    await page.goto('${relativeUrl}');
    
    // Wait for Livewire components/content to settle
    await page.waitForLoadState('networkidle');
    
    // Assert title exists and content body has substantial text
    const title = await page.title();
    expect(title).toBeTruthy();
    
    // Check for substantial body text (good for Livewire content)
    const bodyText = await page.textContent('body', { timeout: 5000 });
    expect(bodyText.length).toBeGreaterThan(100);
  });`;
    }
    
    generatePlaywrightTest(route) {
        const testName = this.generateTestName(route);
        const relativeUrl = route.url.replace(this.baseUrl, '');
        
        if (route.type === 'form') {
            return `  test('${testName}', async ({ page }) => {
    await test.step('Navigate to form', async () => {
      await page.goto('${relativeUrl}');
      await page.waitForSelector('form', { timeout: 10000 });
    });

    await test.step('Fill and Submit Form', async () => {
      // Selector updated to exclude disabled/readonly fields
      const inputs = page.locator('input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled])');
      const count = await inputs.count();
      
      for (let i = 0; i < count; i++) {
        const input = inputs.nth(i);
        const name = await input.getAttribute('name');
        if (name) {
            const type = await input.getAttribute('type') || '';
            // Only fill text-like fields
            if (!['checkbox', 'radio', 'file'].includes(type.toLowerCase())) {
                await input.fill(\`Test \${name} \${Date.now()}\`);
            }
        }
      }
      
      await Promise.all([
        // Wait for URL change (assuming a redirect on success)
        page.waitForURL(url => !url.toString().includes('${relativeUrl}'), { timeout: 15000 }), 
        page.click('${this.options.submitSelector}')
      ]);
    });

    // Use Playwright's stronger assertion to wait for visibility of Filament success notification
    await expect(page.locator('.alert-success, .success-message, .filament-notifications-body')).toBeVisible();
  });`;
        }
        
        return `  test('${testName}', async ({ page }) => {
    await page.goto('${relativeUrl}');
    
    // Wait for Livewire components/content to settle
    await page.waitForLoadState('networkidle');
    
    // Basic page load verification
    await expect(page).toHaveTitle(/.+/);
    
    // Assert body contains substantial text
    const body = page.locator('body');
    await expect(body).toHaveText(/.{100,}/);
  });`;
    }
    
    generateTestName(route) {
        const path = route.url.replace(this.baseUrl, '').replace(/^\//, '');
        const segments = path.split('/').filter(s => s && !s.match(/^\d+$/));
        
        const moduleContext = `[${route.module}]`;

        switch (route.type) {
            case 'form':
                if (path.includes('/edit') || route.url.match(/\/\d+$/)) { 
                    return `can edit ${segments[0]} ${moduleContext}`;
                }
                if (path.includes('/new') || path.includes('/create')) {
                    return `can create ${segments[0]} ${moduleContext}`;
                }
                return `can use form on ${segments.join(' ') || 'homepage'} ${moduleContext}`;

            case 'view':
                return `can view ${segments.join(' ') || 'record'} ${moduleContext}`;

            default:
                return `can access ${segments.join(' ') || 'homepage'} ${moduleContext}`;
        }
    }
}

// Usage
async function main() {
    const dotEnvPath = path.resolve('.env');
    if (fs.existsSync(dotEnvPath)) {
        for (const rawLine of fs.readFileSync(dotEnvPath, 'utf8').split(/\r?\n/)) {
            const line = rawLine.trim();
            if (!line || line.startsWith('#')) continue;
            const idx = line.indexOf('=');
            if (idx === -1) continue;
            const key = line.slice(0, idx).trim();
            let value = line.slice(idx + 1).trim();
            if (!key || process.env[key] !== undefined) continue;
            if (
                (value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith('\'') && value.endsWith('\''))
            ) {
                value = value.slice(1, -1);
            }
            process.env[key] = value;
        }
    }

    const args = process.argv.slice(2);
    let baseUrl = process.env.APP_URL || process.env.BASE_URL || 'http://localhost:3000';
    let routesFile = process.env.ROUTES_JSON || process.env.ROUTES_FILE;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--routes=')) {
            const value = arg.split('=').slice(1).join('=');
            routesFile = value ? value.trim() : '';
        } else if (arg === '--routes' && args[i + 1] && !args[i + 1].startsWith('--')) {
            routesFile = args[i + 1];
            i++;
        } else if (!arg.startsWith('--') && !process.env.APP_URL && !process.env.BASE_URL) {
            baseUrl = arg;
        }
    }

    routesFile = typeof routesFile === 'string' ? routesFile.trim() : routesFile;
    if (typeof routesFile === 'string' && routesFile.length === 0) {
        console.error('❌ Error: --routes must include a non-empty file path.');
        process.exit(1);
    }
    
    const options = {
        email: process.env.E2E_EMAIL || process.env.TEST_EMAIL || 'a@a.com',
        password: process.env.E2E_PASSWORD || process.env.TEST_PASSWORD || 'demopassword',
        browserOptions: { headless: process.env.HEADLESS !== 'false' },
        emailSelector: process.env.EMAIL_SELECTOR,
        passwordSelector: process.env.PASSWORD_SELECTOR,
        submitSelector: process.env.SUBMIT_SELECTOR,
        loginUrl: process.env.LOGIN_PATH || process.env.LOGIN_URL,
        routesFile
    };

    const discovery = new RouteDiscovery(baseUrl, options);
    
    console.log(`\n\x1b[34m--- Filament Route Discovery Tool ---\x1b[0m`);
    console.log(`\x1b[33mBase URL:\x1b[0m ${baseUrl}`);
    if (routesFile) {
        console.log(`\x1b[33mRoutes file:\x1b[0m ${routesFile}`);
    }
    
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
