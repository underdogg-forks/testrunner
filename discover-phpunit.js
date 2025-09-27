const { chromium, errors } = require('playwright');
const fs = require('fs');

/**
 * A class to launch a browser, crawl an application, discover routes,
 * and automatically generate boilerplate PHPUnit Feature (HTTP) tests.
 */
class RouteDiscovery {
    constructor(baseUrl, options = {}) {
        this.baseUrl = baseUrl.replace(/\/$/, '');
        this.options = {
            loginUrl: '/admin/login', // Default to Filament's common login path
            email: 'a@a.com',
            password: 'demopassword',
            // Selectors are kept for the internal crawling login, but not used in generated PHP tests
            emailSelector: 'input[name="email"], input[id="email"]',
            passwordSelector: 'input[name="password"], input[id="password"]',
            submitSelector: 'button[type="submit"], input[type="submit"]',
            ...options
        };
        this.discoveredRoutes = [];
    }

    // =================================================================
    // CORE EXECUTION & CRAWLING (Using Playwright only for discovery)
    // =================================================================

    async discover() {
        let browser;
        let context;
        try {
            browser = await chromium.launch({ headless: true, ...this.options.browserOptions });
            context = await browser.newContext({ actionTimeout: 15000, navigationTimeout: 30000 });
            const page = await context.newPage();

            await this.runDiscovery(page);

        } catch (error) {
            if (error instanceof errors.TimeoutError) {
                console.error('\nFATAL ERROR: Operation timed out. Check if the application is running and the BASE_URL is correct.');
            } else {
                console.error('\nFATAL ERROR during discovery process:', error.message);
            }
        } finally {
            if (browser) {
                await browser.close();
            }
        }
    }
    
    async runDiscovery(page) {
        console.log(`Attempting login to ${this.baseUrl}${this.options.loginUrl}...`);
        // We still need to log in to crawl protected routes
        await this.login(page); 

        console.log(`\nStarting route crawl from ${this.baseUrl}...`);
        const routes = await this.crawlRoutes(page);
        
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
    }
    
    // NOTE: login, waitAndClick, crawlRoutes, determineRouteType, extractModule, groupByModule
    //       methods are assumed to be present and unchanged from the previous filament-optimized
    //       script version.

    // =================================================================
    // PHPUNIT FEATURE TEST GENERATION
    // =================================================================

    async generateTests(routes) {
        const moduleGroups = this.groupByModule(routes);
        
        // Ensure directories exist
        if (!fs.existsSync('tests')) fs.mkdirSync('tests');
        // All tests go into the standard Feature folder
        if (!fs.existsSync('tests/Feature')) fs.mkdirSync('tests/Feature');
        
        let featureCount = 0;

        // Generate test files
        for (const [module, moduleRoutes] of Object.entries(moduleGroups)) {
            // Filter out internal AJAX routes
            const featureRoutes = moduleRoutes.filter(r => r.type !== 'ajax');

            if (featureRoutes.length > 0) {
                fs.writeFileSync(`tests/Feature/Generated${module}Test.php`, this.generateFeatureTestFile(module, featureRoutes));
                featureCount++;
            }
        }
        
        console.log('\n\n✅ Generated test files for PHPUnit:');
        console.log(`- ${featureCount} Feature/HTTP test files in 'tests/Feature/'`);
    }

    /**
     * Generates a complete PHPUnit Feature Test class for a module.
     */
    generateFeatureTestFile(module, routes) {
        const tests = routes.map(route => this.generateFeatureTest(route)).join('\n');
        
        return `<?php

namespace Tests\\Feature;

use App\\Models\\User; // Adjust if your User model is elsewhere
use Illuminate\\Foundation\\Testing\\RefreshDatabase;
use Tests\\TestCase;

class Generated${module}Test extends TestCase
{
    use RefreshDatabase;

    /** @var \\App\\Models\\User The authenticated user for the tests. */
    protected \$user;

    protected function setUp(): void
    {
        parent::setUp();
        // -----------------------------------------------------------------
        // !!! IMPORTANT: UNCOMMENT AND ADJUST THE USER CREATION BELOW !!!
        // You need an authenticated user to access protected Filament routes.
        // -----------------------------------------------------------------
        // \$this->user = User::factory()->create(); 
    }

${tests}
}
`;
    }
    
    /**
     * Generates a single Laravel Feature HTTP test case (GET or POST/PUT).
     */
    generateFeatureTest(route) {
        const testName = this.toSnakeCase(this.generateTestName(route));
        const relativeUrl = route.url.replace(this.baseUrl, '') || '/';
        const isEdit = route.url.match(/\/\d+$/) && route.type === 'form';
        const isCreate = route.type === 'form' && !isEdit;
        
        let method, data, assertion;

        if (isCreate) {
            // New Form submission test
            method = 'post';
            // Placeholder data, requires manual update to match Filament form fields
            data = `[
             // 'name' => 'Test Item ' . time(),
             // 'is_active' => true,
            ]`;
            assertion = '->assertSessionHasNoErrors()\n             ->assertRedirect()';
        } else if (isEdit) {
            // Edit/Update Form submission test
            method = 'put'; // Standard REST method for update
            // Placeholder data, requires manual update
            data = `[
             // 'name' => 'Updated Test Item ' . time(),
            ]`;
            assertion = '->assertSessionHasNoErrors()\n             ->assertStatus(302)'; // Typically redirects on update
        } else {
            // Index/View accessibility test
            method = 'get';
            data = null;
            assertion = `->assertStatus(200)\n             ->assertSee('Dashboard')`; // Check for a common Filament element
        }

        const methodCall = data ? `\$this->actingAs(\$this->user)->${method}('${relativeUrl}', ${data.trim()})` : `\$this->actingAs(\$this->user)->${method}('${relativeUrl}')`;

        return `
    /**
     * Test generated: ${testName}
     * URL: ${relativeUrl}
     * Type: ${route.type.toUpperCase()} (${method.toUpperCase()})
     *
     * @return void
     */
    public function test_${testName}(): void
    {
        // NOTE: This test requires \$this->user to be authenticated in setUp().
        // For POST/PUT tests, the data payload MUST be manually configured.
        ${methodCall}
             ${assertion};
    }
`;
    }
    
    // --- Utility Methods for PHP naming conventions ---
    toSnakeCase(str) {
        return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    }

    generateTestName(route) {
        const path = route.url.replace(this.baseUrl, '').replace(/^\//, '');
        const segments = path.split('/').filter(s => s && !s.match(/^\d+$/));
        const moduleContext = `in_${route.module}`;

        switch (route.type) {
            case 'form':
                if (route.url.match(/\/\d+$/)) { 
                    // Edit Form Submission -> Update action
                    return `can_update_${segments[0]}_${moduleContext}`; 
                }
                if (path.includes('/create') || path.includes('/new')) {
                    // Create Form Submission -> Store action
                    return `can_create_${segments[0]}_${moduleContext}`;
                }
                // Fallback: Accessibility check for the creation form
                return `can_access_create_form_${segments[0]}_${moduleContext}`;

            case 'view':
                return `can_access_view_${segments.join('_') || 'record'}_${moduleContext}`;

            default: // index type
                return `can_access_index_${segments.join('_') || 'homepage'}_${moduleContext}`;
        }
    }
}

// Usage
async function main() {
    const baseUrl = process.argv[2] || 'http://localhost:3000';
    
    const options = {
        email: process.env.TEST_EMAIL || 'a@a.com',
        password: process.env.TEST_PASSWORD || 'demopassword',
        browserOptions: { headless: process.env.HEADLESS !== 'false' },
        loginUrl: process.env.LOGIN_URL || '/admin/login' 
    };

    const discovery = new RouteDiscovery(baseUrl, options);
    
    console.log(`\n\x1b[34m--- Filament to PHPUnit Test Generator ---\x1b[0m`);
    console.log(`\x1b[33mBase URL:\x1b[0m ${baseUrl}`);
    
    await discovery.discover();
    
    console.log('\n\x1b[32m--- Next Steps for PHPUnit ---\x1b[0m');
    console.log('\x1b[36m1. Setup:\x1b[0m');
    console.log(' - \x1b[31mIMPORTANT:\x1b[0m You \x1b[37mMUST\x1b[0m edit the generated files in \x1b[37mtests/Feature/\x1b[0m.');
    console.log(' - \x1b[37mUncomment and adjust\x1b[0m the \x1b[37m\$this->user = User::factory()->create();\x1b[0m line in \x1b[37msetUp()\x1b[0m.');
    console.log(' - For \x1b[37mPOST/PUT\x1b[0m tests, you \x1b[37mMUST manually populate\x1b[0m the data array with valid form fields.');
    console.log('\n\x1b[36m2. Run tests:\x1b[0m');
    console.log('Run all generated PHP tests with your standard command:');
    console.log('\x1b[35mphp artisan test\x1b[0m');
}

if (require.main === module) {
    main().catch(console.error);
}
