const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const { RouteDiscovery } = require('./discover-routes');
const { convertToPlaywright } = require('./convert-to-playwright');

function now() {
  return new Date().toISOString();
}

function timestampFile() {
  return now().replace(/[:.]/g, '-');
}

function createLogger() {
  const dir = path.resolve('storage/logs');
  fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, `testrunner-${timestampFile()}.log`);

  function write(level, message, extra = null) {
    const entry = {
      timestamp: now(),
      level,
      message,
      extra
    };

    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    console.log(`[${level}] ${message}`);
  }

  return {
    file,
    info: (m, e) => write('INFO', m, e),
    warn: (m, e) => write('WARN', m, e),
    error: (m, e) => write('ERROR', m, e)
  };
}

function parseArgs() {
  const args = process.argv.slice(2);

  const get = (key) => {
    const eq = `--${key}=`;
    const i = args.findIndex(a => a === `--${key}` || a.startsWith(eq));
    if (i === -1) return null;

    const v = args[i];
    if (v.startsWith(eq)) return v.slice(eq.length);

    if (args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];

    return true;
  };

  const has = (k) => args.includes(`--${k}`);

  return { get, has };
}

function normalize(url) {
  if (!url) return '';
  const clean = url.split('#')[0].split('?')[0];
  return clean.endsWith('/') && clean.length > 1 ? clean.slice(0, -1) : clean;
}

function isSkipped(url) {
  return [
    '/logout',
    '/login',
    '/register',
    '/password',
    '/broadcasting/auth',
    '/storage/',
    '/horizon',
    '/telescope'
  ].some(p => url.includes(p));
}

function isParam(url) {
  return url.includes('{') || url.includes('}');
}

function resolve(base, route) {
  if (!route) return '';
  if (/^https?:\/\//.test(route)) return normalize(route);

  return normalize(`${base}${route.startsWith('/') ? route : '/' + route}`);
}

/**
 * PHASE 1 → SCAN ONLY
 */
async function scanPhase({ browser, baseUrl, routes, bootstrapUrl, login }) {
  const page = await browser.newPage();

  const visited = new Set();
  const queue = [...routes];

  const result = {
    startTime: now(),
    baseUrl,
    bootstrapUrl,
    visited: [],
    skipped: [],
    failed: [],
    links: []
  };

  await page.goto(bootstrapUrl, { waitUntil: 'domcontentloaded' });

  if (page.url().includes(login.path)) {
    login.logger.info('auth required');

    await page.fill(login.emailSelector, login.email);
    await page.fill(login.passwordSelector, login.password);

    await Promise.all([
      page.waitForURL(u => !u.toString().includes(login.path)),
      page.click(login.submitSelector)
    ]);
  }

  await page.goto(bootstrapUrl);

  while (queue.length) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;

    visited.add(url);

    if (isSkipped(url) || isParam(url)) {
      result.skipped.push(url);
      continue;
    }

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });

      result.visited.push(url);

      const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
      );

      for (const l of links) {
        const n = normalize(l);

        if (!n.startsWith(baseUrl)) continue;
        if (isSkipped(n) || isParam(n)) continue;

        if (!visited.has(n)) queue.push(n);

        result.links.push(n);
      }

    } catch (e) {
      result.failed.push({
        url,
        message: e.message,
        stack: e.stack
      });
    }
  }

  result.endTime = now();
  result.visited = Array.from(visited);

  await page.close();

  return result;
}

/**
 * PHASE 2 → ANALYZE ONLY
 */
function analyzePhase(routes, scan) {
  const matched = new Set(scan.visited);

  const coverage = routes.length
      ? Math.round((matched.size / routes.length) * 100)
      : 0;

  const todo = [
    `# Coverage: ${coverage}%`,
    '',
    '# Missing routes',
    ...routes.filter(r => !matched.has(r)).map(r => `- [ ] ${r}`),
    '',
    '# Failed routes',
    ...scan.failed.map(f => `- [ ] ${f.url} (${f.message})`)
  ].join('\n');

  fs.writeFileSync('todo.txt', todo);

  return {
    coverage,
    matched: Array.from(matched),
    todoFile: 'todo.txt'
  };
}

/**
 * PHASE 3 → GENERATE ONLY (SAFE)
 */
function generatePhase(scanFile, logger) {
  try {
    const out = path.join('tests-playwright', `generated-${Date.now()}.spec.js`);
    convertToPlaywright(scanFile, out);
    logger.info('generation complete', { out });
    return { success: true, out };
  } catch (e) {
    logger.error('generation failed (scan preserved)', {
      message: e.message,
      stack: e.stack
    });

    return { success: false, error: e.message };
  }
}

async function run() {
  const logger = createLogger();
  const { get, has } = parseArgs();

  const baseUrl =
      (get('baseUrl') || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');

  const routesFile =
      get('routes') || process.env.ROUTES_JSON;

  if (!routesFile) {
    console.error('Missing ROUTES_JSON / --routes');
    process.exit(1);
  }

  const mode = get('mode') || 'full';
  const singleRoute = get('route');

  const routesRaw = new RouteDiscovery(baseUrl).loadLaravelRoutesFromJson(routesFile);
  const routes = routesRaw.map(r => normalize(r.url)).filter(Boolean);

  const bootstrapUrl = singleRoute
      ? resolve(baseUrl, singleRoute)
      : resolve(baseUrl, process.env.DASHBOARD_PATH || '/dashboard');

  const browser = await chromium.launch({
    headless: !has('headed')
  });

  try {
    const scan = await scanPhase({
      browser,
      baseUrl,
      routes,
      bootstrapUrl,
      login: {
        path: process.env.LOGIN_PATH || '/login',
        email: process.env.E2E_EMAIL,
        password: process.env.E2E_PASSWORD,
        emailSelector: 'input[name="email"]',
        passwordSelector: 'input[name="password"]',
        submitSelector: 'button[type="submit"]',
        logger
      }
    });

    const scanFile = path.join(
        'recordings',
        `scan-${Date.now()}.json`
    );

    fs.writeFileSync(scanFile, JSON.stringify(scan, null, 2));

    logger.info(`scan complete -> ${scanFile}`);

    const analysis = analyzePhase(routes, scan);

    logger.info(`coverage: ${analysis.coverage}%`);

    if (mode === 'scan') {
      return;
    }

    const gen = generatePhase(scanFile, logger);

    if (!gen.success) {
      logger.error('generation failed (scan preserved)');
    }

  } catch (e) {
    logger.error('fatal', { message: e.message, stack: e.stack });
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  run();
}