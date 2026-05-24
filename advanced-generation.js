const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { RouteDiscovery } = require('./discover-routes');
const { convertToPlaywright } = require('./convert-to-playwright');

function createLogger() {
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
      extra
    };

    fs.appendFileSync(file, JSON.stringify(entry) + '\n');
    console.log(`[${level}] ${message}`);
  };

  return {
    file,
    info: (m, e) => write('INFO', m, e),
    warn: (m, e) => write('WARN', m, e),
    error: (m, e) => write('ERROR', m, e)
  };
}

function normalizeUrl(url) {
  if (!url) return '';
  const clean = url.split('#')[0].split('?')[0];
  return clean.endsWith('/') && clean.length > 1 ? clean.slice(0, -1) : clean;
}

function shouldSkip(url) {
  const blocked = [
    '/logout',
    '/register',
    '/password',
    '/broadcasting/auth',
    '/storage/',
    '/horizon',
    '/telescope'
  ];
  return blocked.some((p) => url.includes(p));
}

function isParamRoute(url) {
  return url.includes('{') || url.includes('}');
}

function toBool(v, def = false) {
  if (v === undefined || v === null || v === '') return def;
  return String(v).toLowerCase() === 'true';
}

function resolve(base, route) {
  if (!route) return '';
  if (/^https?:\/\//.test(route)) return normalizeUrl(route);
  return normalizeUrl(`${base}${route.startsWith('/') ? route : `/${route}`}`);
}

function parseArgs() {
  const args = process.argv.slice(2);

  const get = (name) => {
    const p = `--${name}=`;
    const i = args.findIndex((a) => a === `--${name}` || a.startsWith(p));
    if (i === -1) return '';
    if (args[i].startsWith(p)) return args[i].slice(p.length);
    if (args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];
    return '';
  };

  const has = (f) => args.includes(`--${f}`);

  return { get, has };
}

async function run() {
  const logger = createLogger();
  const { get, has } = parseArgs();

  const baseUrl = (get('baseUrl') || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const routesFile = get('routes') || process.env.ROUTES_JSON;

  if (!routesFile) {
    console.error('Missing ROUTES_JSON / --routes');
    process.exit(1);
  }

  const loginUrl = get('loginUrl') || process.env.LOGIN_PATH || '/login';
  const dashboardUrl = get('dashboardUrl') || process.env.DASHBOARD_PATH || '/dashboard';

  const email = get('email') || process.env.E2E_EMAIL;
  const password = get('password') || process.env.E2E_PASSWORD;

  const headless = !has('headed');

  const screenshotOnError = toBool(get('screenshotOnError') || process.env.SCREENSHOT_ON_ERROR, true);

  const logDir = path.resolve('storage/logs');
  const recordingsDir = path.resolve('recordings');
  const testsDir = path.resolve('tests-playwright');

  fs.mkdirSync(logDir, { recursive: true });
  fs.mkdirSync(recordingsDir, { recursive: true });
  fs.mkdirSync(testsDir, { recursive: true });

  const discovery = new RouteDiscovery(baseUrl, {
    loginUrl,
    email,
    password
  });

  const routesRaw = discovery.loadLaravelRoutesFromJson(routesFile);
  const routes = routesRaw.map((r) => normalizeUrl(r.url)).filter(Boolean);

  const phase = {
    scanned: [],
    visited: [],
    skipped: [],
    failed: [],
    links: [],
    startTime: new Date().toISOString()
  };

  let browser;

  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext({
      screenshot: screenshotOnError ? 'only-on-failure' : 'off'
    });

    const page = await context.newPage();

    const bootstrap = resolve(baseUrl, dashboardUrl);

    await page.goto(bootstrap, { waitUntil: 'domcontentloaded' });

    if (page.url().includes(loginUrl)) {
      logger.info('auth required');

      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', password);

      await Promise.all([
        page.waitForURL((u) => !u.toString().includes(loginUrl)),
        page.click('button[type="submit"]')
      ]);
    }

    await page.goto(bootstrap);

    const queue = [...routes];
    const visited = new Set();

    while (queue.length) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;

      visited.add(url);

      if (shouldSkip(url) || isParamRoute(url)) {
        phase.skipped.push(url);
        continue;
      }

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        phase.visited.push(url);

        const links = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]')).map((a) => a.href)
        );

        for (const l of links) {
          const n = normalizeUrl(l);

          if (!n.startsWith(baseUrl)) continue;
          if (shouldSkip(n) || isParamRoute(n)) continue;

          if (!visited.has(n)) queue.push(n);

          phase.links.push(n);
        }
      } catch (e) {
        logger.error('scan error', { url, message: e.message });

        phase.failed.push({ url, message: e.message });

        if (screenshotOnError) {
          try {
            await page.screenshot({
              path: path.join(logDir, `error-${Date.now()}.png`)
            });
          } catch {}
        }
      }
    }

    phase.scanned = Array.from(visited);

    const scanFile = path.join(recordingsDir, `scan-${Date.now()}.json`);
    fs.writeFileSync(scanFile, JSON.stringify(phase, null, 2));

    logger.info(`scan complete -> ${scanFile}`);

    // =========================
    // PHASE 2: ANALYZE
    // =========================

    const matched = new Set(routes.filter((r) => phase.scanned.includes(r)));

    const coverage = routes.length
        ? Math.round((matched.size / routes.length) * 100)
        : 0;

    const todo = [
      `# Coverage: ${coverage}%`,
      '',
      '# Untouched routes',
      ...routes.filter((r) => !matched.has(r)).map((r) => `- [ ] ${r}`),
      '',
      '# Failed routes',
      ...phase.failed.map((f) => `- [ ] ${f.url} (${f.message})`)
    ].join('\n');

    fs.writeFileSync('todo.txt', todo);

    logger.info(`coverage: ${coverage}%`);

    // =========================
    // PHASE 3: GENERATE
    // =========================

    try {
      const specOut = path.join(testsDir, `generated-${Date.now()}.spec.js`);
      convertToPlaywright(scanFile, specOut);
      logger.info(`generated -> ${specOut}`);
    } catch (e) {
      logger.error('generation failed (scan preserved)', {
        message: e.message
      });
    }
  } catch (e) {
    logger.error('fatal', { message: e.message });
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

if (require.main === module) {
  run();
}