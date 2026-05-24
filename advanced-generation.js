const { chromium, errors } = require('playwright');
const fs = require('fs');
const path = require('path');
const { RouteDiscovery } = require('./discover-routes');
const { convertToPlaywright } = require('./convert-to-playwright');

function normalizeUrl(url) {
  if (!url) return '';
  const noHash = url.split('#')[0];
  const noQuery = noHash.split('?')[0];

  if (noQuery.endsWith('/') && !/^https?:\/\/[^/]+\/$/.test(noQuery)) {
    return noQuery.slice(0, -1);
  }

  return noQuery;
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

  const normalizedPath = routeValue.startsWith('/') ? routeValue : `/${routeValue}`;
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
    '/telescope',
  ];

  return blockedPatterns.some((pattern) => url.includes(pattern));
}

function isParameterizedRoute(url) {
  return url.includes('{') || url.includes('}');
}

function escapeCssAttributeValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeCssId(value) {
  return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
}

function loadDotEnv(dotEnvPath) {
  if (!fs.existsSync(dotEnvPath)) return;

  const content = fs.readFileSync(dotEnvPath, 'utf8');

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const equalIndex = line.indexOf('=');
    if (equalIndex === -1) continue;

    const key = line.slice(0, equalIndex).trim();
    let value = line.slice(equalIndex + 1).trim();

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

async function run() {
  loadDotEnv(path.resolve('.env'));

  const args = process.argv.slice(2);

  const getArg = (name) => {
    const exact = `--${name}`;
    const prefixed = `--${name}=`;

    const index = args.findIndex((a) => a === exact || a.startsWith(prefixed));
    if (index === -1) return '';

    if (args[index].startsWith(prefixed)) {
      return args[index].slice(prefixed.length).trim();
    }

    if (args[index + 1] && !args[index + 1].startsWith('--')) {
      return args[index + 1].trim();
    }

    return '';
  };

  const hasFlag = (name) => args.includes(`--${name}`);

  const baseUrl = (
      getArg('baseUrl') ||
      process.env.APP_URL ||
      process.env.BASE_URL ||
      'http://localhost:3000'
  ).replace(/\/$/, '');

  const routesFile = getArg('routes') || process.env.ROUTES_JSON || process.env.ROUTES_FILE || '';
  const loginUrl = getArg('loginUrl') || process.env.LOGIN_PATH || process.env.LOGIN_URL || '/login';
  const dashboardUrl =
      getArg('dashboardUrl') || process.env.DASHBOARD_PATH || process.env.DASHBOARD_URL || '/dashboard';

  const email = getArg('email') || process.env.E2E_EMAIL || process.env.TEST_EMAIL || 'a@a.com';
  const password =
      getArg('password') || process.env.E2E_PASSWORD || process.env.TEST_PASSWORD || 'demopassword';

  const emailSelector = getArg('emailSelector') || process.env.EMAIL_SELECTOR || 'input[name="email"], input[id="email"]';
  const passwordSelector =
      getArg('passwordSelector') || process.env.PASSWORD_SELECTOR || 'input[name="password"], input[id="password"]';
  const submitSelector =
      getArg('submitSelector') || process.env.SUBMIT_SELECTOR || 'button[type="submit"], input[type="submit"]';

  let headless = (process.env.HEADLESS || 'true') !== 'false';

  const headlessArg = getArg('headless');
  if (headlessArg !== '') headless = toBoolean(headlessArg, true);

  if (toBoolean(process.env.HEADED, false) || hasFlag('headed')) {
    headless = false;
  }

  const maxLinksPerPage = Number(getArg('maxLinksPerPage') || process.env.MAX_LINKS_PER_PAGE || 250);

  const singleRouteInput =
      getArg('route') ||
      getArg('singleRoute') ||
      process.env.SINGLE_ROUTE_PATH ||
      process.env.SINGLE_ROUTE ||
      process.env.ROUTE ||
      '';

  const singleRoute = resolveRouteUrl(baseUrl, singleRouteInput);

  const assumeAuthenticated = toBoolean(getArg('assumeAuthenticated') || process.env.ASSUME_AUTHENTICATED, false);

  const requireAuthConfirmation = toBoolean(
      getArg('requireAuthConfirmation') || process.env.REQUIRE_AUTH_CONFIRMATION,
      true
  );

  if (!routesFile.trim()) {
    console.error('❌ Error: Provide routes inventory using ROUTES_JSON, ROUTES_FILE, or --routes.');
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

  const session = {
    metadata: {
      startTime: new Date().toISOString(),
      baseUrl,
      routesFile,
      dashboardUrl,
    },
    clicks: [],
    routes: [],
    formData: [],
    networkRequests: [],
    problems: []
  };

  let step = 1;
  let browser;

  const recordProblem = (scope, error) => {
    session.problems.push({
      timestamp: new Date().toISOString(),
      scope,
      message: error instanceof Error ? error.message : String(error)
    });

    log(`${scope}: ${error}`, 'ERROR');
  };

  const generatePerLinkSpec = (touchedRoutes, outputFile) => {
    const literal = (v) => JSON.stringify(String(v));

    const tests = touchedRoutes.map((route) => `
  test(${literal(`should load ${route}`)}, async ({ page }) => {
    await login(page);
    await page.goto(${literal(route)}, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('networkidle');
  });`).join('\n');

    const spec = `
import { test } from '@playwright/test';

const BASE_URL = process.env.APP_URL || ${literal(baseUrl)};
const LOGIN_URL = ${literal(loginUrl)};
const EMAIL = ${literal(email)};
const PASSWORD = ${literal(password)};
const EMAIL_SELECTOR = ${literal(emailSelector)};
const PASSWORD_SELECTOR = ${literal(passwordSelector)};
const SUBMIT_SELECTOR = ${literal(submitSelector)};

async function login(page) {
  await page.goto(\`\${BASE_URL}\${LOGIN_URL}\`);
  await page.fill(EMAIL_SELECTOR, EMAIL);
  await page.fill(PASSWORD_SELECTOR, PASSWORD);

  await Promise.all([
    page.waitForURL((url) => !url.toString().includes(LOGIN_URL)),
    page.click(SUBMIT_SELECTOR)
  ]);
}

test.describe('Generated routes', () => {${tests}
});
`;

    fs.writeFileSync(outputFile, spec);
  };

  try {
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

    const initialRoutes = singleRoute ? [singleRoute] : Array.from(new Set(seeded));
    const routeChecklist = new Set(seeded);

    const queue = [...initialRoutes];
    const visited = new Set();
    const queued = new Set(queue);

    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    const login = async () => {
      const target = singleRoute || resolveRouteUrl(baseUrl, dashboardUrl);

      await page.goto(target, { waitUntil: 'domcontentloaded' });

      if (page.url().includes(loginUrl)) {
        await page.fill(emailSelector, email);
        await page.fill(passwordSelector, password);

        await Promise.all([
          page.waitForURL((url) => !url.toString().includes(loginUrl)),
          page.click(submitSelector)
        ]);
      }
    };

    if (!assumeAuthenticated) {
      await login();
    }

    const collectLinks = async () => {
      const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
      );

      return links
          .map(normalizeUrl)
          .filter(Boolean)
          .filter((url) => url.startsWith(baseUrl));
    };

    while (queue.length) {
      const url = queue.shift();

      if (!url || visited.has(url)) continue;
      if (shouldSkipRoute(url)) continue;
      if (isParameterizedRoute(url)) continue;

      visited.add(url);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        const links = await collectLinks();

        for (const link of links) {
          if (queued.has(link) || visited.has(link)) continue;
          if (shouldSkipRoute(link)) continue;
          if (isParameterizedRoute(link)) continue;

          queued.add(link);
          queue.push(link);
        }

      } catch (e) {
        recordProblem(`navigate:${url}`, e);
      }
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-');

    const recordingFile = path.join(recordingsDir, `session-${timestamp}.json`);
    fs.writeFileSync(recordingFile, JSON.stringify(session, null, 2));

    const specFile = path.join(testsDir, `generated-${timestamp}.spec.js`);
    convertToPlaywright(recordingFile, specFile);

    const perLinkFile = path.join(testsDir, `per-link-${timestamp}.spec.js`);
    generatePerLinkSpec(Array.from(visited), perLinkFile);

    log(`Done`);
  } catch (e) {
    recordProblem('fatal', e);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

if (require.main === module) {
  run();
}