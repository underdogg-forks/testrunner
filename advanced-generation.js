const { chromium, errors } = require('playwright');
const fs = require('fs');
const path = require('path');
const { RouteDiscovery } = require('./discover-routes');
const { convertToPlaywright } = require('./convert-to-playwright');

function createTestRunnerLogger() {
  const dir = path.resolve('storage/logs');
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(
      dir,
      `testrunner-${new Date().toISOString().replace(/[:.]/g, '-')}.log`
  );

  const write = (level, message, extra = null) => {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...(extra ? { extra } : {})
    };

    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    console.log(`[${level}] ${message}`);
  };

  return {
    file,
    info: (m, e) => write('INFO', m, e),
    warn: (m, e) => write('WARN', m, e),
    error: (m, e) => write('ERROR', m, e),
    debug: (m, e) => write('DEBUG', m, e)
  };
}

function normalizeUrl(url) {
  if (!url) return '';
  const clean = url.split('#')[0].split('?')[0];
  return clean.endsWith('/') && clean.length > 1 ? clean.slice(0, -1) : clean;
}

function urlIncludes(url, expected) {
  return url && expected ? String(url).includes(expected) : false;
}

function toBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function resolveRouteUrl(baseUrl, route) {
  if (!route) return '';
  if (/^https?:\/\//i.test(route)) return normalizeUrl(route);
  return normalizeUrl(`${baseUrl}${route.startsWith('/') ? route : '/' + route}`);
}

function shouldSkipRoute(url) {
  const blocked = [
    '/logout',
    '/login',
    '/register',
    '/password',
    '/broadcasting/auth',
    '/storage/',
    '/horizon',
    '/telescope'
  ];
  return blocked.some((p) => url.includes(p));
}

function isParameterizedRoute(url) {
  return url.includes('{') || url.includes('}');
}

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const i = trimmed.indexOf('=');
    if (i === -1) continue;

    const key = trimmed.slice(0, i);
    let value = trimmed.slice(i + 1);

    if (!process.env[key]) {
      if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[key] = value;
    }
  }
}

function parseArgs() {
  const args = process.argv.slice(2);

  const getArg = (name) => {
    const p = `--${name}=`;
    const i = args.findIndex((a) => a === `--${name}` || a.startsWith(p));

    if (i === -1) return '';

    if (args[i].startsWith(p)) return args[i].slice(p.length);

    if (args[i + 1] && !args[i + 1].startsWith('--')) {
      return args[i + 1];
    }

    return '';
  };

  const hasFlag = (name) => args.includes(`--${name}`);

  return { getArg, hasFlag };
}

async function run() {
  loadDotEnv(path.resolve('.env'));

  const logger = createTestRunnerLogger();
  const { getArg, hasFlag } = parseArgs();

  const baseUrl = (
      getArg('baseUrl') ||
      process.env.APP_URL ||
      'http://localhost:3000'
  ).replace(/\/$/, '');

  const routesFile = getArg('routes') || process.env.ROUTES_JSON || '';

  if (!routesFile) {
    console.error('❌ Missing ROUTES_JSON / --routes');
    process.exit(1);
  }

  const loginUrl = getArg('loginUrl') || process.env.LOGIN_PATH || '/login';
  const dashboardUrl = getArg('dashboardUrl') || process.env.DASHBOARD_PATH || '/dashboard';

  const email = getArg('email') || process.env.E2E_EMAIL || 'a@a.com';
  const password = getArg('password') || process.env.E2E_PASSWORD || 'demo';

  const emailSelector = 'input[name="email"], input[id="email"]';
  const passwordSelector = 'input[name="password"], input[id="password"]';
  const submitSelector = 'button[type="submit"], input[type="submit"]';

  let headless = !(hasFlag('headed') || process.env.HEADED === 'true');

  const singleRouteInput =
      getArg('singleRoute') ||
      getArg('route') ||
      process.env.ROUTE ||
      '';

  const singleRoute = resolveRouteUrl(baseUrl, singleRouteInput);

  const discovery = new RouteDiscovery(baseUrl, {
    loginUrl,
    email,
    password,
    emailSelector,
    passwordSelector,
    submitSelector
  });

  const routes = discovery.loadLaravelRoutesFromJson(routesFile);
  const seeded = routes.map((r) => normalizeUrl(r.url)).filter(Boolean);

  const queue = singleRoute ? [singleRoute] : [...new Set(seeded)];
  const visited = new Set();

  const scanReport = {
    startTime: new Date().toISOString(),
    baseUrl,
    visited: [],
    skipped: [],
    failed: [],
    errors: []
  };

  let browser;

  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    const bootstrapUrl = singleRoute || resolveRouteUrl(baseUrl, dashboardUrl);

    await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded' });

    if (urlIncludes(page.url(), loginUrl)) {
      logger.warn('Login required');

      await page.fill(emailSelector, email);
      await page.fill(passwordSelector, password);

      await Promise.all([
        page.waitForURL((u) => !u.toString().includes(loginUrl)),
        page.click(submitSelector)
      ]);

      logger.info('Authenticated');
    }

    while (queue.length > 0) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;

      visited.add(url);
      scanReport.visited.push(url);

      process.stdout.write(
          `\rVisited: ${scanReport.visited.length} | Queue: ${queue.length} | Errors: ${scanReport.errors.length}`
      );

      if (shouldSkipRoute(url) || isParameterizedRoute(url)) {
        scanReport.skipped.push(url);
        logger.warn('Skipped route', { url });
        continue;
      }

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const links = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]')).map((a) => a.href)
        );

        for (const link of links) {
          const n = normalizeUrl(link);

          if (!n.startsWith(baseUrl)) continue;
          if (shouldSkipRoute(n) || isParameterizedRoute(n)) continue;
          if (!visited.has(n)) queue.push(n);
        }
      } catch (error) {
        scanReport.failed.push({ url, message: error.message });

        logger.error('Route failure', {
          url,
          message: error.message,
          stack: error.stack
        });
      }
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const output = path.join('recordings', `session-${timestamp}.json`);
    fs.writeFileSync(output, JSON.stringify(scanReport, null, 2));

    const specOut = path.join('tests-playwright', `generated-${timestamp}.spec.js`);
    convertToPlaywright(output, specOut);

    logger.info(`Generated: ${specOut}`);

    console.log('\n\n=== SCAN SUMMARY ===');
    console.log(`Visited: ${scanReport.visited.length}`);
    console.log(`Skipped: ${scanReport.skipped.length}`);
    console.log(`Failed: ${scanReport.failed.length}`);
    console.log(`Errors: ${scanReport.errors.length}`);
    console.log(`Log: ${logger.file}`);
  } catch (error) {
    logger.error('Fatal error', { message: error.message, stack: error.stack });
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

if (require.main === module) {
  run();
}