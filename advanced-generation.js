const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { RouteDiscovery } = require('./discover-routes');
const { convertToPlaywright } = require('./convert-to-playwright');
const { sortRoutes } = require('./utils');

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

function parseArgs() {
  const args = process.argv.slice(2);

  const get = (name) => {
    const prefix = `--${name}=`;
    const i = args.findIndex(a => a === `--${name}` || a.startsWith(prefix));

    if (i === -1) return '';
    if (args[i].startsWith(prefix)) return args[i].slice(prefix.length);
    if (args[i + 1] && !args[i + 1].startsWith('--')) return args[i + 1];

    return '';
  };

  return { get };
}

function resolveHeadless(get) {
  const raw = get('headless') || process.env.HEADLESS;

  if (raw === undefined || raw === '') return true;

  return String(raw).toLowerCase() !== 'false';
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
    '/storage/',
    '/horizon',
    '/telescope'
  ];

  return blocked.some(p => url.includes(p));
}

function isParamRoute(url) {
  return url.includes('{') || url.includes('}');
}

function resolve(base, route) {
  if (!route) return '';
  if (/^https?:\/\//.test(route)) return normalizeUrl(route);
  return normalizeUrl(`${base}${route.startsWith('/') ? route : `/${route}`}`);
}

function loadScan(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Scan file not found: ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function run() {
  const logger = createLogger();
  const { get } = parseArgs();

  const baseUrl = (get('baseUrl') || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const routesFile = get('routes') || process.env.ROUTES_JSON;

  const replayFile = get('replay');
  const replayOnlyFailed = String(get('replayOnlyFailed') || '').toLowerCase() === 'true';
  const replayRoute = get('replayRoute');

  const loginUrl = get('loginUrl') || process.env.LOGIN_PATH || '/login';
  const dashboardUrl = get('dashboardUrl') || process.env.DASHBOARD_PATH || '/dashboard';

  const email = get('email') || process.env.E2E_EMAIL;
  const password = get('password') || process.env.E2E_PASSWORD;

  const headless = resolveHeadless(get);

  logger.info(`browser mode: ${headless ? 'headless' : 'headed'}`);

  let routes = [];
  let phase = null;

  if (replayFile) {
    logger.info(`replay mode: ${replayFile}`);

    const replay = loadScan(replayFile);
    phase = replay;

    routes = replayOnlyFailed
        ? (replay.failed || []).map(f => f.url)
        : replay.scanned || [];

    if (replayRoute) {
      routes = routes.filter(r => r.includes(replayRoute));
    }

    routes = sortRoutes(routes);

  } else {
    const discovery = new RouteDiscovery(baseUrl, {
      loginUrl,
      email,
      password
    });

    const routesRaw = discovery.loadLaravelRoutesFromJson(routesFile);

    routes = sortRoutes(
        routesRaw.map(r => normalizeUrl(r.url))
    );

    phase = {
      scanned: [],
      visited: [],
      skipped: [],
      failed: [],
      startTime: new Date().toISOString()
    };
  }

  let browser;

  try {
    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    const bootstrap = resolve(baseUrl, dashboardUrl);

    logger.info(`boot -> ${bootstrap}`);
    await page.goto(bootstrap, { waitUntil: 'domcontentloaded' });

    if (page.url().includes(loginUrl)) {
      logger.info('auth required');

      await page.fill('input[name="email"]', email);
      await page.fill('input[name="password"]', password);

      await Promise.all([
        page.waitForURL(u => !u.toString().includes(loginUrl)),
        page.click('button[type="submit"]')
      ]);

      logger.info('auth complete');
    }

    await page.goto(bootstrap);

    const queue = [...routes];
    const visited = new Set();

    let i = 0;

    while (queue.length) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;

      visited.add(url);
      i++;

      if (shouldSkip(url) || isParamRoute(url)) {
        logger.info(`[SKIP] ${url}`);
        phase.skipped.push(url);
        continue;
      }

      logger.info(`[${i}] scanning ${url}`);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded' });

        phase.visited.push(url);

        const links = await page.evaluate(() =>
            Array.from(document.querySelectorAll('a[href]')).map(a => a.href)
        );

        for (const l of links) {
          const n = normalizeUrl(l);

          if (!n.startsWith(baseUrl)) continue;
          if (shouldSkip(n) || isParamRoute(n)) continue;

          if (!replayFile && !visited.has(n)) {
            queue.push(n);
          }
        }

      } catch (e) {
        logger.error('scan error', { url, message: e.message });
        phase.failed.push({ url, message: e.message });
      }
    }

    phase.scanned = sortRoutes(Array.from(visited));

    const scanFile = path.join('recordings', `scan-${Date.now()}.json`);
    fs.writeFileSync(scanFile, JSON.stringify(phase, null, 2));

    logger.info(`scan complete -> ${scanFile}`);

    const coverage = routes.length
        ? Math.round((phase.scanned.length / routes.length) * 100)
        : 0;

    logger.info(`coverage: ${coverage}%`);

    try {
      const specOut = path.join('tests-playwright', `generated-${Date.now()}.spec.js`);
      convertToPlaywright(scanFile, specOut);
      logger.info(`generated -> ${specOut}`);
    } catch (e) {
      logger.error('generation failed (scan preserved)', { message: e.message });
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