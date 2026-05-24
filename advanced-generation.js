const { chromium, errors } = require('playwright');
const fs = require('fs');
const path = require('path');
const { RouteDiscovery } = require('./discover-routes');
const { convertToPlaywright } = require('./convert-to-playwright');

function normalizeUrl(url) {
  if (!url) return '';
  const noHash = url.split('#')[0];
  const noQuery = noHash.split('?')[0];
  return noQuery.endsWith('/') && !/^https?:\/\/[^/]+\/$/.test(noQuery)
      ? noQuery.slice(0, -1)
      : noQuery;
}

function toBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return String(value).toLowerCase() === 'true';
}

function resolveRouteUrl(baseUrl, routeValue) {
  if (!routeValue) return '';
  if (/^https?:\/\//i.test(routeValue)) return normalizeUrl(routeValue);

  const normalizedPath = routeValue.startsWith('/')
      ? routeValue
      : `/${routeValue}`;

  return normalizeUrl(`${baseUrl}${normalizedPath}`);
}

function parseArgs() {
  const args = process.argv.slice(2);

  const get = (name) => {
    const exact = `--${name}`;
    const prefix = `--${name}=`;

    const index = args.findIndex(a => a === exact || a.startsWith(prefix));
    if (index === -1) return '';

    const arg = args[index];

    if (arg.startsWith(prefix)) {
      return arg.slice(prefix.length);
    }

    if (args[index + 1] && !args[index + 1].startsWith('--')) {
      return args[index + 1];
    }

    return '';
  };

  const has = (name) => args.includes(`--${name}`);

  return {
    baseUrl: get('baseUrl'),
    routesFile: get('routes'),
    loginUrl: get('loginUrl'),
    dashboardUrl: get('dashboardUrl'),
    email: get('email'),
    password: get('password'),

    singleRoute: get('singleRoute') || get('route'),

    headless: get('headless'),
    assumeAuthenticated: get('assumeAuthenticated'),
    requireAuthConfirmation: get('requireAuthConfirmation'),

    maxLinksPerPage: get('maxLinksPerPage'),

    hasHeaded: has('headed')
  };
}

async function run() {
  const cli = parseArgs();

  const baseUrl = (cli.baseUrl || process.env.APP_URL || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const routesFile = cli.routesFile || process.env.ROUTES_JSON || process.env.ROUTES_FILE || '';

  const loginUrl = cli.loginUrl || process.env.LOGIN_PATH || '/login';
  const dashboardUrl = cli.dashboardUrl || process.env.DASHBOARD_PATH || '/dashboard';

  const email = cli.email || process.env.E2E_EMAIL || 'a@a.com';
  const password = cli.password || process.env.E2E_PASSWORD || 'password';

  const assumeAuthenticated = toBoolean(cli.assumeAuthenticated || process.env.ASSUME_AUTHENTICATED, false);
  const requireAuthConfirmation = toBoolean(cli.requireAuthConfirmation || process.env.REQUIRE_AUTH_CONFIRMATION, true);

  const maxLinksPerPage = Number(cli.maxLinksPerPage || process.env.MAX_LINKS_PER_PAGE || 250);

  let headless = (process.env.HEADLESS || 'true') !== 'false';
  if (cli.headless !== '') {
    headless = toBoolean(cli.headless, true);
  }
  if (cli.hasHeaded || toBoolean(process.env.HEADED, false)) {
    headless = false;
  }

  const singleRouteInput =
      cli.singleRoute ||
      process.env.SINGLE_ROUTE ||
      process.env.SINGLE_ROUTE_PATH ||
      process.env.ROUTE ||
      '';

  const singleRoute = resolveRouteUrl(baseUrl, singleRouteInput);

  const authProbeUrl = singleRoute || resolveRouteUrl(baseUrl, dashboardUrl) || baseUrl;

  if (!routesFile.trim()) {
    console.error('❌ Missing ROUTES_JSON / --routes');
    process.exit(1);
  }

  const logDir = path.resolve('storage/logs');
  const recordingsDir = path.resolve('recordings');
  const testsDir = path.resolve('tests-playwright');

  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(recordingsDir, { recursive: true });
  fs.mkdirSync(testsDir, { recursive: true });

  const logFile = path.join(logDir, 'e2e-recording.log');

  const log = (msg) => {
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${msg}\n`);
    console.log(msg);
  };

  const session = {
    metadata: {
      baseUrl,
      routesFile,
      mode: singleRoute ? 'single-route' : 'full'
    },
    routes: [],
    clicks: [],
    formData: [],
    problems: []
  };

  let browser;

  try {
    const discovery = new RouteDiscovery(baseUrl);
    const routes = discovery.loadLaravelRoutesFromJson(routesFile);

    const seeded = routes.map(r => normalizeUrl(r.url)).filter(Boolean);

    const initialRoutes = singleRoute ? [singleRoute] : seeded;

    const queue = [...new Set(initialRoutes)];
    const visited = new Set();

    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    // AUTH
    if (!assumeAuthenticated) {
      const bootstrapUrl = authProbeUrl;

      await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded' });

      if (page.url().includes(loginUrl)) {
        await page.fill('input[name="email"]', email);
        await page.fill('input[name="password"]', password);

        await Promise.all([
          page.waitForURL(u => !u.toString().includes(loginUrl)),
          page.click('button[type="submit"]')
        ]);
      }
    }

    // MAIN LOOP
    while (queue.length) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;

      visited.add(url);

      await page.goto(url, { waitUntil: 'domcontentloaded' });

      const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
      );

      for (const link of links.slice(0, maxLinksPerPage)) {
        const normalized = normalizeUrl(link);

        if (!normalized.startsWith(baseUrl)) continue;
        if (visited.has(normalized)) continue;

        queue.push(normalized);
      }

      session.routes.push(url);
    }

    const out = path.join(recordingsDir, `session-${Date.now()}.json`);
    fs.writeFileSync(out, JSON.stringify(session, null, 2));

    const testOut = path.join(testsDir, `generated-${Date.now()}.spec.js`);
    convertToPlaywright(out, testOut);

    log(`Done. Output: ${testOut}`);
  } catch (e) {
    log(`ERROR: ${e.message}`);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

if (require.main === module) {
  run();
}