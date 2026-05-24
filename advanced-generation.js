const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { RouteDiscovery } = require('./discover-routes');
const { convertToPlaywright } = require('./convert-to-playwright');
const { sortRoutes } = require('./utils');

function log(level, message, extra = null) {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  console.log(line);
  return line;
}

function parseArgs() {
  const args = process.argv.slice(2);

  const get = (name) => {
    const prefix = `--${name}=`;
    const found = args.find(a => a.startsWith(prefix));
    return found ? found.slice(prefix.length) : '';
  };

  const has = (f) => args.includes(`--${f}`);

  return { get, has };
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
  return ['/logout', '/register', '/password', '/storage/', '/horizon', '/telescope']
      .some(p => url.includes(p));
}

function isParamRoute(url) {
  return url.includes('{') || url.includes('}');
}

/**
 * PHASE 1 — SCAN (deterministic order, verbose CLI)
 */
async function scan({ browser, baseUrl, routes, loginUrl, dashboardUrl, email, password }) {
  const page = await browser.newPage();

  const bootstrap = `${baseUrl}${dashboardUrl}`;
  log('INFO', `boot -> ${bootstrap}`);

  await page.goto(bootstrap, { waitUntil: 'domcontentloaded' });

  if (page.url().includes(loginUrl)) {
    log('INFO', 'auth required');

    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);

    await Promise.all([
      page.waitForURL(u => !u.toString().includes(loginUrl)),
      page.click('button[type="submit"]')
    ]);

    log('INFO', 'auth complete');
  }

  await page.goto(bootstrap);

  const queue = [...routes];
  const visited = new Set();
  const phase = {
    scanned: [],
    visited: [],
    skipped: [],
    failed: [],
    startTime: new Date().toISOString()
  };

  let i = 0;

  while (queue.length) {
    const url = queue.shift();
    if (!url || visited.has(url)) continue;

    visited.add(url);
    i++;

    if (shouldSkip(url) || isParamRoute(url)) {
      log('INFO', `[SKIP] ${url}`);
      phase.skipped.push(url);
      continue;
    }

    log('INFO', `[${i}] scanning ${url}`);

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
        if (!visited.has(n)) queue.push(n);
      }

    } catch (e) {
      log('ERROR', `scan error ${url}`, e.message);
      phase.failed.push({ url, message: e.message });
    }
  }

  phase.scanned = sortRoutes([...visited]);

  return phase;
}

/**
 * PHASE 2 — ANALYZE (pure function, no side effects)
 */
function analyze(routes, phase) {
  const matched = new Set(phase.scanned);

  const coverage = routes.length
      ? Math.round((matched.size / routes.length) * 100)
      : 0;

  const todo = [
    `# Coverage: ${coverage}%`,
    '',
    '# Unvisited routes',
    ...routes.filter(r => !matched.has(r)).map(r => `- [ ] ${r}`),
    '',
    '# Failed routes',
    ...phase.failed.map(f => `- [ ] ${f.url} (${f.message})`)
  ].join('\n');

  fs.writeFileSync('todo.txt', todo);

  return { coverage, todo };
}

/**
 * PHASE 3 — GENERATE
 */
function generate(scanFile) {
  const out = path.join('tests-playwright', `generated-${Date.now()}.spec.js`);
  convertToPlaywright(scanFile, out);
  return out;
}

/**
 * MAIN
 */
async function run() {
  const { get } = parseArgs();

  const baseUrl = (get('baseUrl') || process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
  const routesFile = get('routes') || process.env.ROUTES_JSON;

  if (!routesFile) {
    console.error('Missing ROUTES_JSON');
    process.exit(1);
  }

  const loginUrl = get('loginUrl') || process.env.LOGIN_PATH || '/login';
  const dashboardUrl = get('dashboardUrl') || process.env.DASHBOARD_PATH || '/dashboard';
  const email = get('email') || process.env.E2E_EMAIL;
  const password = get('password') || process.env.E2E_PASSWORD;

  const headless = resolveHeadless(get);

  log('INFO', `browser mode: ${headless ? 'headless' : 'headed'}`);

  const discovery = new RouteDiscovery(baseUrl, { loginUrl, email, password });
  const routesRaw = discovery.loadLaravelRoutesFromJson(routesFile);

  const routes = sortRoutes(
      routesRaw.map(r => normalizeUrl(r.url))
  );

  const browser = await chromium.launch({ headless });

  try {
    // PHASE 1
    const phase = await scan({
      browser,
      baseUrl,
      routes,
      loginUrl,
      dashboardUrl,
      email,
      password
    });

    const scanFile = path.join('recordings', `scan-${Date.now()}.json`);
    fs.writeFileSync(scanFile, JSON.stringify(phase, null, 2));

    log('INFO', `scan complete -> ${scanFile}`);

    // PHASE 2
    const { coverage } = analyze(routes, phase);
    log('INFO', `coverage: ${coverage}%`);

    // PHASE 3 (isolated failure)
    try {
      const out = generate(scanFile);
      log('INFO', `generated -> ${out}`);
    } catch (e) {
      log('ERROR', 'generation failed (scan preserved)', e.message);
    }

  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  run();
}