const { chromium, errors } = require('playwright');
const fs = require('fs');
const path = require('path');
const { RouteDiscovery } = require('./discover-routes');
const { convertToPlaywright } = require('./convert-to-playwright');

function normalizeUrl(url) {
  if (!url) return '';
  const noHash = url.split('#')[0];
  const noQuery = noHash.split('?')[0];

  return noQuery.endsWith('/') && noQuery.length > 1
      ? noQuery.slice(0, -1)
      : noQuery;
}

function urlIncludes(url, expected) {
  if (!url || !expected) return false;
  return String(url).includes(expected);
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

function shouldSkipRoute(url) {
  const blockedPatterns = [
    '/logout',
    '/login',
    '/register',
    '/password',
    '/broadcasting/auth',
    '/storage/',
    '/horizon',
    '/telescope'
  ];

  return blockedPatterns.some((pattern) => url.includes(pattern));
}

function isParameterizedRoute(url) {
  return url.includes('{') || url.includes('}');
}

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) return;

  const content = fs.readFileSync(dotEnvPath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const index = line.indexOf('=');
    if (index === -1) continue;

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();

    if (!key || process.env[key] !== undefined) continue;

    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    process.env[key] = value;
  }
}

function parseArgs() {
  const args = process.argv.slice(2);

  const getArg = (name) => {
    const prefix = `--${name}=`;
    const exact = `--${name}`;

    const index = args.findIndex((a) => a === exact || a.startsWith(prefix));
    if (index === -1) return '';

    const value = args[index];

    if (value.startsWith(prefix)) {
      return value.slice(prefix.length).trim();
    }

    if (args[index + 1] && !args[index + 1].startsWith('--')) {
      return args[index + 1].trim();
    }

    return '';
  };

  const hasFlag = (name) => args.includes(`--${name}`);

  return { getArg, hasFlag };
}

async function run() {
  loadDotEnv(path.resolve('.env'));

  const { getArg, hasFlag } = parseArgs();

  const baseUrl = (
      getArg('baseUrl') ||
      process.env.APP_URL ||
      process.env.BASE_URL ||
      'http://localhost:3000'
  ).replace(/\/$/, '');

  const routesFile =
      getArg('routes') ||
      process.env.ROUTES_JSON ||
      process.env.ROUTES_FILE ||
      '';

  const loginUrl =
      getArg('loginUrl') ||
      process.env.LOGIN_PATH ||
      '/login';

  const dashboardUrl =
      getArg('dashboardUrl') ||
      process.env.DASHBOARD_PATH ||
      '/dashboard';

  const email =
      getArg('email') ||
      process.env.E2E_EMAIL ||
      'a@a.com';

  const password =
      getArg('password') ||
      process.env.E2E_PASSWORD ||
      'demopassword';

  const emailSelector =
      getArg('emailSelector') ||
      'input[name="email"], input[id="email"]';

  const passwordSelector =
      getArg('passwordSelector') ||
      'input[name="password"], input[id="password"]';

  const submitSelector =
      getArg('submitSelector') ||
      'button[type="submit"], input[type="submit"]';

  let headless = (process.env.HEADLESS || 'true') !== 'false';

  if (toBoolean(getArg('headless'), headless)) {
    headless = true;
  }

  if (hasFlag('headed') || toBoolean(process.env.HEADED, false)) {
    headless = false;
  }

  const maxLinksPerPage = Number(process.env.MAX_LINKS_PER_PAGE || 250);

  const singleRouteInput =
      getArg('singleRoute') ||
      getArg('route') ||
      process.env.ROUTE ||
      process.env.SINGLE_ROUTE ||
      '';

  const singleRoute = resolveRouteUrl(baseUrl, singleRouteInput);

  const assumeAuthenticated = toBoolean(
      getArg('assumeAuthenticated') ||
      process.env.ASSUME_AUTHENTICATED,
      false
  );

  const requireAuthConfirmation = toBoolean(
      getArg('requireAuthConfirmation') ||
      process.env.REQUIRE_AUTH_CONFIRMATION,
      true
  );

  const routesFileFinal = routesFile;

  if (!routesFileFinal.trim()) {
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
  fs.writeFileSync(logFile, '');

  const log = (message, level = 'INFO') => {
    const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
    fs.appendFileSync(logFile, line);
    console.log(`[${level}] ${message}`);
  };

  const discovery = new RouteDiscovery(baseUrl, {
    loginUrl,
    email,
    password,
    emailSelector,
    passwordSelector,
    submitSelector
  });

  const routes = discovery.loadLaravelRoutesFromJson(routesFileFinal);

  const seeded = routes.map((r) => normalizeUrl(r.url)).filter(Boolean);

  const initialRoutes = singleRoute
      ? [singleRoute]
      : Array.from(new Set(seeded));

  const routeChecklist = new Set(seeded);
  const queue = [...initialRoutes];
  const visited = new Set();

  let browser;

  try {
    browser = await chromium.launch({ headless });

    const context = await browser.newContext();
    const page = await context.newPage();

    const bootstrapUrl = singleRoute || resolveRouteUrl(baseUrl, dashboardUrl);

    await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded' });

    if (urlIncludes(page.url(), loginUrl)) {
      log('Redirected to login, authenticating');

      await page.fill(emailSelector, email);
      await page.fill(passwordSelector, password);

      await Promise.all([
        page.waitForURL((url) => !url.toString().includes(loginUrl)),
        page.click(submitSelector)
      ]);

      log('Authentication complete');
    }

    await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded' });

    while (queue.length > 0) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;
      visited.add(url);

      if (shouldSkipRoute(url) || isParameterizedRoute(url)) {
        continue;
      }

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const links = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]')).map((a) => a.href)
        );

        for (const link of links) {
          const normalized = normalizeUrl(link);

          if (!normalized.startsWith(baseUrl)) continue;
          if (shouldSkipRoute(normalized)) continue;
          if (isParameterizedRoute(normalized)) continue;

          if (!visited.has(normalized)) {
            queue.push(normalized);
          }
        }
      } catch (error) {
        console.error(error);
      }
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-');

    const output = path.join(recordingsDir, `session-${timestamp}.json`);

    fs.writeFileSync(output, JSON.stringify({ visited: Array.from(visited) }, null, 2));

    const specOut = path.join(testsDir, `generated-${timestamp}.spec.js`);

    convertToPlaywright(output, specOut);

    log(`Generated: ${specOut}`);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

if (require.main === module) {
  run();
}