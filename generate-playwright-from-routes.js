const fs = require('fs');
const path = require('path');
const { RouteDiscovery } = require('./discover-routes');

/**
 * Generate Playwright tests from a Laravel route inventory (route:list --json).
 *
 * Usage examples:
 *   BASE_URL=http://localhost:8000 ROUTES_FILE=routes.json npm run generate:playwright:routes
 *   node generate-playwright-from-routes.js --baseUrl http://localhost:8000 --routes routes.json
 */
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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
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
    if (arg.startsWith('--baseUrl=')) {
      const value = arg.split('=').slice(1).join('=');
      if (value) baseUrl = value.trim();
    } else if (arg === '--baseUrl' && args[i + 1] && !args[i + 1].startsWith('--')) {
      baseUrl = args[i + 1].trim();
      i++;
    } else if (arg.startsWith('--routes=')) {
      const value = arg.split('=').slice(1).join('=');
      routesFile = value ? value.trim() : '';
    } else if (arg === '--routes' && args[i + 1] && !args[i + 1].startsWith('--')) {
      routesFile = args[i + 1].trim();
      i++;
    }
  }

  if (typeof routesFile !== 'string' || routesFile.trim().length === 0) {
    console.error('❌ Error: Provide a Laravel routes JSON file via ROUTES_JSON, ROUTES_FILE, or --routes.');
    process.exit(1);
  }

  const discovery = new RouteDiscovery(baseUrl, {
    email: process.env.E2E_EMAIL || process.env.TEST_EMAIL || 'a@a.com',
    password: process.env.E2E_PASSWORD || process.env.TEST_PASSWORD || 'demopassword',
    emailSelector: process.env.EMAIL_SELECTOR,
    passwordSelector: process.env.PASSWORD_SELECTOR,
    submitSelector: process.env.SUBMIT_SELECTOR,
    loginUrl: process.env.LOGIN_PATH || process.env.LOGIN_URL
  });

  const routes = discovery.loadLaravelRoutesFromJson(routesFile);
  const moduleGroups = discovery.groupByModule(routes);

  if (!fs.existsSync('tests-playwright')) fs.mkdirSync('tests-playwright');
  discovery.generatePlaywrightConfig();

  for (const [module, moduleRoutes] of Object.entries(moduleGroups)) {
    fs.writeFileSync(
      `tests-playwright/${module}.spec.js`,
      discovery.generatePlaywrightTestFile(module, moduleRoutes)
    );
  }

  console.log(`✅ Generated ${Object.keys(moduleGroups).length} Playwright spec file(s) from ${routesFile}`);
  console.log(`📁 Output: tests-playwright/*.spec.js`);
  console.log(`▶️ Run: npx playwright test`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error('❌ Failed to generate Playwright tests from routes:', error.message);
    process.exit(1);
  });
}
