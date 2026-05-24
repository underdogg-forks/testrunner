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
    info: (msg, extra) => write('INFO', msg, extra),
    warn: (msg, extra) => write('WARN', msg, extra),
    error: (msg, extra) => write('ERROR', msg, extra),
    debug: (msg, extra) => write('DEBUG', msg, extra)
  };
}

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

  const logger = createTestRunnerLogger();

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

  const routes = discovery.loadLaravelRoutesFromJson(routesFile);

  const seeded = routes.map((r) => normalizeUrl(r.url)).filter(Boolean);

  const routeInventory = new Set(seeded);
  const matchedRoutes = new Set();
  const discoveredRoutes = new Set();

  const initialRoutes = singleRoute
      ? [singleRoute]
      : Array.from(routeInventory);

  const queue = [...initialRoutes];
  const visited = new Set();

  let browser;

  try {
    browser = await chromium.launch({ headless });

    const context = await browser.newContext();
    const page = await context.newPage();

    const bootstrapUrl =
        singleRoute || resolveRouteUrl(baseUrl, dashboardUrl);

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
      discoveredRoutes.add(url);

      if (shouldSkipRoute(url) || isParameterizedRoute(url)) {
        logger.warn('Skipped route', { url });
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

          if (routeInventory.has(normalized)) {
            matchedRoutes.add(normalized);
          }

          if (!visited.has(normalized)) {
            queue.push(normalized);
          }
        }
      } catch (error) {
        logger.error('Route failure', {
          url,
          message: error?.message,
          stack: error?.stack
        });
      }
    }

    const total = routeInventory.size;
    const matched = matchedRoutes.size;

    const coveragePercent =
        total === 0 ? 0 : Math.round((matched / total) * 10000) / 100;

    const untouchedRoutes = [...routeInventory].filter(
        (r) => !matchedRoutes.has(r)
    );

    const extraRoutes = [...discoveredRoutes].filter(
        (r) => !routeInventory.has(r)
    );

    const timestamp = new Date().toISOString().replace(/:/g, '-');

    const recordingFile = path.join(
        recordingsDir,
        `session-${timestamp}.json`
    );

    fs.writeFileSync(
        recordingFile,
        JSON.stringify(
            {
              visited: Array.from(visited),
              matched: Array.from(matchedRoutes),
              discovered: Array.from(discoveredRoutes)
            },
            null,
            2
        )
    );

    const specOut = path.join(
        testsDir,
        `generated-${timestamp}.spec.js`
    );

    convertToPlaywright(recordingFile, specOut);

    const coverageFile = path.join(
        logDir,
        `coverage-${timestamp}.json`
    );

    fs.writeFileSync(
        coverageFile,
        JSON.stringify(
            {
              coveragePercent,
              totalRoutes: total,
              matchedRoutes: matched,
              untouchedRoutes,
              extraRoutes
            },
            null,
            2
        )
    );

    log(`Generated: ${specOut}`);
    log(`Coverage: ${coveragePercent}% (${matched}/${total})`);

    console.log(
        `\n📊 Route Coverage: ${coveragePercent}% (${matched}/${total})\n`
    );
  } catch (error) {
    logger.error('Fatal error', {
      message: error?.message,
      stack: error?.stack
    });

    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

if (require.main === module) {
  run();
}