const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

class RouteDiscovery {
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.options = options;
        this.discoveredRoutes = [];
    }
    
    async discover() {
        const browser = await chromium.launch({ headless: false });
        const context = await browser.newContext();
        const page = await context.newPage();
        
        try {
            // Login
            await this.login(page);
            
            // Discover routes
            const routes = await this.crawlRoutes(page);
            
            // Generate test files
            await this.generateJestTests(routes);
            await this.generatePlaywrightTests(routes);
            
            console.log(`Discovered ${routes.length} routes`);
            return routes;
            
        } finally {
            await browser.close();
        }
    }
    
    async login(page) {
        await page.goto(`${this.baseUrl}/sessions/login`);
        await page.fill('input[name="email"]', 'a@a.com');
        await page.fill('input[name="password"]', 'demopassword');
        await Promise.all([
            page.waitForNavigation(),
            page.click('button[type="submit"]')
        ]);
    }
    
    async crawlRoutes(page) {
        const routes = new Set();
        const visited = new Set();
        const toVisit = [this.baseUrl];
        
        while (toVisit.length > 0) {
            const url = toVisit.pop();
            if (visited.has(url)) continue;
            visited.add(url);
            
            try {
                await page.goto(url, { waitUntil: 'domcontentloaded' });
                
                // Add current route
                routes.add({
                    url,
                    type: this.determineRouteType(url),
                    module: this.extractModule(url)
                });
                
                // Find more links
                const links = await page.locator('a[href]').evaluateAll(links => 
                    links.map(link => link.href).filter(href => 
                        href && !href.includes('#') && !href.includes('javascript:')
                    )
                );
                
                links.forEach(link => {
                    if (link.startsWith(this.baseUrl) && !visited.has(link)) {
                        toVisit.push(link);
                    }
                });
                
            } catch (error) {
                console.log(`Error crawling ${url}:`, error.message);
            }
        }
        
        return Array.from(routes);
    }
    
    determineRouteType(url) {
        const path = url.replace(this.baseUrl, '').toLowerCase();
        if (path.includes('/form') || path.includes('/create') || path.includes('/edit')) return 'form';
        if (path.includes('/view') || path.match(/\/\d+$/)) return 'view';
        if (path.includes('/ajax') || path.includes('.json')) return 'ajax';
        return 'index';
    }
    
    extractModule(url) {
        const path = url.replace(this.baseUrl, '').replace(/^\//, '');
        const module = path.split('/')[0] || 'core';
        return module;
    }
    
    async generateJestTests(routes) {
        const moduleGroups = this.groupByModule(routes);
        
        // Create tests directory
        if (!fs.existsSync('tests')) fs.mkdirSync('tests');
        
        // Generate Jest config
        this.generateJestConfig();
        
        // Generate test files
        for (const [module, moduleRoutes] of Object.entries(moduleGroups)) {
            const testContent = this.generateJestTestFile(module, moduleRoutes);
            fs.writeFileSync(`tests/${module}.test.js`, testContent);
        }
        
        console.log('Generated Jest test files');
    }
    
    async generatePlaywrightTests(routes) {
        const moduleGroups = this.groupByModule(routes);
        
        // Create tests directory
        if (!fs.existsSync('tests-playwright')) fs.mkdirSync('tests-playwright');
        
        // Generate Playwright config
        this.generatePlaywrightConfig();
        
        // Generate test files
        for (const [module, moduleRoutes] of Object.entries(moduleGroups)) {
            const testContent = this.generatePlaywrightTestFile(module, moduleRoutes);
            fs.writeFileSync(`tests-playwright/${module}.spec.js`, testContent);
        }
        
        console.log('Generated Playwright test files');
    }
    
    groupByModule(routes) {
        return routes.reduce((groups, route) => {
            if (!groups[route.module]) groups[route.module] = [];
            groups[route.module].push(route);
            return groups;
        }, {});
    }
    
    generateJestConfig() {
        const config = `module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000
};`;
        
        fs.writeFileSync('jest.config.js', config);
        
        const setup = `const { chromium } = require('playwright');

let browser;
let context;
let page;

beforeAll(async () => {
  browser = await chromium.launch();
  context = await browser.newContext();
  page = await context.newPage();
  
  // Login once for all tests
  await page.goto('http://localhost:3000/sessions/login');
  await page.fill('input[name="email"]', 'a@a.com');
  await page.fill('input[name="password"]', 'demopassword');
  await Promise.all([
    page.waitForNavigation(),
    page.click('button[type="submit"]')
  ]);
  
  global.page = page;
});

afterAll(async () => {
  await browser.close();
});`;
        
        if (!fs.existsSync('tests')) fs.mkdirSync('tests');
        fs.writeFileSync('tests/setup.js', setup);
    }
    
    generatePlaywrightConfig() {
        const config = `import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests-playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});`;
        
        fs.writeFileSync('playwright.config.js', config);
    }
    
    generateJestTestFile(module, routes) {
        const tests = routes.map(route => this.generateJestTest(route)).join('\n\n');
        
        return `describe('${module} module', () => {
  const page = global.page;

${tests}
});`;
    }
    
    generatePlaywrightTestFile(module, routes) {
        const tests = routes.map(route => this.generatePlaywrightTest(route)).join('\n\n');
        
        return `import { test, expect } from '@playwright/test';

test.describe('${module} module', () => {
${tests}
});`;
    }
    
    generateJestTest(route) {
        const testName = this.generateTestName(route);
        
        if (route.type === 'form') {
            return `  test('${testName}', async () => {
    await page.goto('${route.url}');
    
    // Wait for form
    await page.waitForSelector('form');
    
    // Fill form with test data
    const inputs = await page.$$('input[type="text"], input[type="email"], textarea');
    for (const input of inputs) {
      const name = await input.getAttribute('name');
      if (name && !['_token'].includes(name)) {
        await input.fill(\`Test \${name} \${Date.now()}\`);
      }
    }
    
    // Submit form
    await Promise.all([
      page.waitForNavigation(),
      page.click('button[type="submit"], input[type="submit"]')
    ]);
    
    // Verify success
    const hasSuccess = await page.$('.alert-success, .success-message') !== null;
    expect(hasSuccess).toBe(true);
  });`;
        }
        
        return `  test('${testName}', async () => {
    await page.goto('${route.url}');
    await page.waitForLoadState('domcontentloaded');
    
    // Basic page load verification
    const title = await page.title();
    expect(title).toBeTruthy();
    
    const bodyText = await page.textContent('body');
    expect(bodyText.length).toBeGreaterThan(100);
  });`;
    }
    
    generatePlaywrightTest(route) {
        const testName = this.generateTestName(route);
        
        if (route.type === 'form') {
            return `  test('${testName}', async ({ page }) => {
    await page.goto('${route.url}');
    
    // Wait for form
    await page.waitForSelector('form');
    
    // Fill form with test data
    const inputs = page.locator('input[type="text"], input[type="email"], textarea');
    const count = await inputs.count();
    
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      const name = await input.getAttribute('name');
      if (name && !['_token'].includes(name)) {
        await input.fill(\`Test \${name} \${Date.now()}\`);
      }
    }
    
    // Submit form
    await Promise.all([
      page.waitForNavigation(),
      page.click('button[type="submit"], input[type="submit"]')
    ]);
    
    // Verify success
    await expect(page.locator('.alert-success, .success-message')).toBeVisible();
  });`;
        }
        
        return `  test('${testName}', async ({ page }) => {
    await page.goto('${route.url}');
    
    // Basic page load verification
    await expect(page).toHaveTitle(/.+/);
    
    const body = page.locator('body');
    await expect(body).toContainText(/.{100,}/);
  });`;
    }
    
    generateTestName(route) {
        const path = route.url.replace(this.baseUrl, '').replace(/^\//, '');
        const segments = path.split('/').filter(s => s && !s.match(/^\d+$/));
        
        switch (route.type) {
            case 'form':
                return path.match(/\/\d+$/) ? 
                    `can edit ${segments[0]}` : 
                    `can create ${segments[0]}`;
            case 'view':
                return `can view ${segments.join(' ')}`;
            default:
                return `can access ${segments.join(' ') || 'homepage'}`;
        }
    }
}

// Usage
async function main() {
    const baseUrl = process.argv[2] || 'http://localhost:3000';
    const discovery = new RouteDiscovery(baseUrl);
    
    console.log(`Discovering routes for ${baseUrl}...`);
    await discovery.discover();
    
    console.log('\\nGenerated files:');
    console.log('- jest.config.js');
    console.log('- playwright.config.js');
    console.log('- tests/*.test.js (Jest)');
    console.log('- tests-playwright/*.spec.js (Playwright)');
    console.log('\\nTo run tests:');
    console.log('npm test (Jest)');
    console.log('npx playwright test (Playwright)');
}

if (require.main === module) {
    main().catch(console.error);
}

module.exports = { RouteDiscovery };
