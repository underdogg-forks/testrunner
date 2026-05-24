const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { RouteDiscovery } = require('./discover-routes');
const { convertToPlaywright } = require('./convert-to-playwright');
const { sortRoutes } = require('./utils');

const LOG_DIR = 'storage/logs';
const RECORDINGS_DIR = 'recordings';
const TESTS_DIR = 'tests-playwright';

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseArgs() {
  const raw = process.argv.slice(2);
  const parsed = {};

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (!arg.startsWith('--')) continue;

    const keyValue = arg.slice(2);
    const eqIndex = keyValue.indexOf('=');

    if (eqIndex >= 0) {
      const key = keyValue.slice(0, eqIndex);
      const value = keyValue.slice(eqIndex + 1);
      parsed[key] = value;
      continue;
    }

    const next = raw[i + 1];
    if (next && !next.startsWith('--')) {
      parsed[keyValue] = next;
      i += 1;
    } else {
      parsed[keyValue] = 'true';
    }
  }

  const get = (name) => parsed[name];
  const has = (name) => Object.prototype.hasOwnProperty.call(parsed, name);
  return { get, has };
}

function boolFrom(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function readFlag(get, has, key, envKey, fallback) {
  if (has(key) && get(key) === 'true') return true;
  if (has(key) && get(key) === 'false') return false;
  if (has(key)) return boolFrom(get(key), fallback);
  return boolFrom(process.env[envKey], fallback);
}

function resolveStopOnFailRoute(get, has) {
  if (has('stop-on-fail-route')) {
    return readFlag(get, has, 'stop-on-fail-route', 'STOP_ON_FAIL_ROUTE', false);
  }

  if (has('stop-on-failure')) {
    return readFlag(get, has, 'stop-on-failure', 'STOP_ON_FAILURE', false);
  }

  return boolFrom(process.env.STOP_ON_FAIL_ROUTE, false) || boolFrom(process.env.STOP_ON_FAILURE, false);
}

function normalizeUrl(url) {
  if (!url) return '';
  const clean = String(url).split('#')[0].split('?')[0];
  return clean.endsWith('/') && clean.length > 1 ? clean.slice(0, -1) : clean;
}

function toAbsoluteUrl(baseUrl, value) {
  if (!value) return '';
  try {
    return normalizeUrl(new URL(value, `${baseUrl}/`).toString());
  } catch {
    return '';
  }
}

function shouldSkipRoute(url) {
  const skipPatterns = [
    '/logout', '/register', '/password', '/storage/', '/horizon', '/telescope',
    '/livewire', '/_debugbar', '/_ignition', '/sanctum/csrf-cookie'
  ];
  return skipPatterns.some(pattern => url.includes(pattern));
}

function isParameterizedRoute(url) {
  return url.includes('{') || url.includes('}') || /\/:[^/]+/.test(url);
}

function sanitizeFilename(input) {
  return input.replace(/[^a-z0-9_-]/gi, '_').replace(/_+/g, '_').slice(0, 140);
}

function createLogger(logFile) {
  ensureDir(path.dirname(logFile));
  fs.writeFileSync(logFile, '');

  return (level, message, extra = null) => {
    const line = `[${new Date().toISOString()}] [${level}] ${message}`;
    const withExtra = extra ? `${line} ${JSON.stringify(extra)}` : line;
    fs.appendFileSync(logFile, `${withExtra}\n`);
    console.log(withExtra);
  };
}

function readJsonIfExists(filePath) {
  if (!filePath) return null;
  const absolute = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absolute)) return null;
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

function extractTodoRoutes(todoData, baseUrl) {
  if (!todoData) return [];

  const candidates = [];

  if (Array.isArray(todoData)) {
    candidates.push(...todoData);
  }

  if (Array.isArray(todoData.routes)) {
    candidates.push(...todoData.routes);
  }

  if (Array.isArray(todoData.nonScannedRoutes)) {
    candidates.push(...todoData.nonScannedRoutes);
  }

  if (Array.isArray(todoData.erroredRoutes)) {
    candidates.push(...todoData.erroredRoutes.map(item => item.url || item));
  }

  const unique = new Set();
  for (const route of candidates) {
    const routeUrl = typeof route === 'string' ? route : route?.url;
    const absolute = toAbsoluteUrl(baseUrl, routeUrl);
    if (absolute) unique.add(absolute);
  }

  return sortRoutes([...unique]);
}

function extractSkippedRoutes(skippedData, baseUrl) {
  if (!skippedData) return [];

  const candidates = [];

  if (Array.isArray(skippedData)) {
    candidates.push(...skippedData);
  }

  if (Array.isArray(skippedData.routes)) {
    candidates.push(...skippedData.routes);
  }

  if (Array.isArray(skippedData.skippedRoutes)) {
    candidates.push(...skippedData.skippedRoutes);
  }

  if (Array.isArray(skippedData.erroredRoutes)) {
    candidates.push(...skippedData.erroredRoutes.map(item => item.url || item));
  }

  const unique = new Set();
  for (const route of candidates) {
    const routeUrl = typeof route === 'string' ? route : route?.url;
    const absolute = toAbsoluteUrl(baseUrl, routeUrl);
    if (absolute) unique.add(absolute);
  }

  return sortRoutes([...unique]);
}

function writeSkippedRoutesFile(skippedFile, routes, log) {
  const absolute = path.isAbsolute(skippedFile) ? skippedFile : path.resolve(process.cwd(), skippedFile);
  const dedupedRoutes = sortRoutes([
    ...new Set(routes.map(normalizeUrl).filter(Boolean)),
  ]);

  ensureDir(path.dirname(absolute));
  fs.writeFileSync(absolute, JSON.stringify({
    updatedAt: new Date().toISOString(),
    routes: dedupedRoutes,
  }, null, 2));

  log('INFO', `skipped routes -> ${absolute} (${dedupedRoutes.length})`);
  return absolute;
}

function createRunModel(config) {
  return {
    metadata: {
      startedAt: new Date().toISOString(),
      mode: config.mode,
      baseUrl: config.baseUrl,
      routesFile: config.routesFile || null,
      todoFile: config.todoFile || null,
      skippedFile: config.skippedFile || null,
      ci: !!process.env.CI,
      flags: {
        stopOnError: config.stopOnError,
        stopOnFailRoute: config.stopOnFailRoute,
        screenshotOnError: config.screenshotOnError,
        trace: config.traceEnabled,
      },
    },
    scannedRoutes: [],
    erroredRoutes: [],
    skippedRoutes: [],
    nonScannedRoutes: [],
    discoveredRoutes: [],
    artifacts: [],
    summary: {
      scanned: 0,
      errored: 0,
      skipped: 0,
      nonScanned: 0,
      discovered: 0,
      coverage: 0,
    },
  };
}

async function maybeLogin(page, config, log, runModel) {
  const loginAbsolute = toAbsoluteUrl(config.baseUrl, config.loginUrl);
  if (!loginAbsolute) return;

  if (!page.url().includes(normalizeUrl(loginAbsolute))) {
    return;
  }

  if (config.assumeAuthenticated) {
    log('WARN', 'assume-authenticated is true but browser is currently on login page');
    return;
  }

  if (!config.email || !config.password) {
    const message = 'Missing E2E_EMAIL or E2E_PASSWORD for login-required route';
    runModel.erroredRoutes.push({
      url: page.url(),
      reason: 'auth_missing_credentials',
      message,
      artifacts: [],
      timestamp: new Date().toISOString(),
    });
    throw new Error(message);
  }

  log('INFO', `auth required at ${page.url()}`);

  await page.fill('input[name="email"], input[type="email"], input#email', config.email);
  await page.fill('input[name="password"], input[type="password"], input#password', config.password);

  await Promise.all([
    page.waitForURL(url => !String(url).includes(config.loginUrl), { timeout: 30000 }),
    page.click('button[type="submit"], input[type="submit"], button:has-text("Login")'),
  ]);

  if (config.requireAuthConfirmation && page.url().includes(config.loginUrl)) {
    throw new Error('Authentication did not exit login route');
  }

  log('INFO', 'auth complete');
}

async function captureFailureArtifacts({ page, context, routeUrl, config, traceChunkOpen, log }) {
  const artifacts = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const routeToken = sanitizeFilename(routeUrl.replace(config.baseUrl, '') || 'root');
  const artifactBase = `${stamp}-${routeToken}`;

  if (config.traceEnabled && traceChunkOpen.value) {
    const tracePath = path.join(LOG_DIR, 'traces', `${artifactBase}.zip`);
    ensureDir(path.dirname(tracePath));
    try {
      await context.tracing.stopChunk({ path: tracePath });
      artifacts.push({ type: 'trace', path: tracePath });
    } catch (error) {
      log('WARN', 'failed to write trace artifact', { routeUrl, error: error.message });
    }
    traceChunkOpen.value = false;
  }

  if (config.screenshotOnError) {
    const screenshotPath = path.join(LOG_DIR, 'screenshots', `${artifactBase}.png`);
    ensureDir(path.dirname(screenshotPath));
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
      artifacts.push({ type: 'screenshot', path: screenshotPath });
    } catch (error) {
      log('WARN', 'failed to write screenshot artifact', { routeUrl, error: error.message });
    }
  }

  return artifacts;
}

function toScanSession(runModel) {
  const started = runModel.metadata.startedAt;
  const routeEvents = runModel.scannedRoutes.map((route, index) => ({
    step: index + 1,
    timestamp: route.timestamp,
    from: index === 0 ? runModel.metadata.baseUrl : runModel.scannedRoutes[index - 1].url,
    to: route.url,
    path: (() => {
      try {
        return new URL(route.url).pathname;
      } catch {
        return route.url;
      }
    })(),
  }));

  return {
    metadata: {
      startTime: started,
      endTime: new Date().toISOString(),
      duration: Date.now() - new Date(started).getTime(),
      startUrl: runModel.metadata.baseUrl,
      mode: runModel.metadata.mode,
    },
    clicks: [],
    routes: routeEvents,
    formData: [],
    networkRequests: [],
    screenshots: runModel.artifacts.filter(a => a.type === 'screenshot').map(a => a.path),
  };
}

function writeRunOutputs(runModel, log) {
  ensureDir(LOG_DIR);
  ensureDir(RECORDINGS_DIR);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportFile = path.join(LOG_DIR, `run-report-${stamp}.json`);
  const latestReportFile = path.join(LOG_DIR, 'run-report.json');
  const todoFile = path.join(process.cwd(), 'todo.json');

  const todoRoutes = sortRoutes([
    ...new Set([
      ...runModel.nonScannedRoutes.map(route => normalizeUrl(route.url)),
      ...runModel.erroredRoutes.map(route => normalizeUrl(route.url)),
    ].filter(Boolean)),
  ]);

  const todoPayload = {
    generatedAt: new Date().toISOString(),
    report: reportFile,
    routes: todoRoutes,
    nonScannedRoutes: runModel.nonScannedRoutes,
    erroredRoutes: runModel.erroredRoutes,
    skippedRoutes: runModel.skippedRoutes,
  };

  fs.writeFileSync(reportFile, JSON.stringify(runModel, null, 2));
  fs.writeFileSync(latestReportFile, JSON.stringify(runModel, null, 2));
  fs.writeFileSync(todoFile, JSON.stringify(todoPayload, null, 2));

  const todoText = [
    `# Coverage: ${runModel.summary.coverage}%`,
    '',
    '# Non-scanned routes',
    ...runModel.nonScannedRoutes.map(route => `- [ ] ${route.url} (${route.reason})`),
    '',
    '# Errored routes',
    ...runModel.erroredRoutes.map(route => `- [ ] ${route.url} (${route.message})`),
  ].join('\n');
  fs.writeFileSync(path.join(process.cwd(), 'todo.txt'), todoText);

  const scanSession = toScanSession(runModel);
  const scanSessionFile = path.join(RECORDINGS_DIR, `scan-${stamp}.json`);
  const generatedSpecFile = path.join(TESTS_DIR, `generated-${stamp}.spec.js`);

  fs.writeFileSync(scanSessionFile, JSON.stringify(scanSession, null, 2));

  ensureDir(TESTS_DIR);
  try {
    convertToPlaywright(scanSessionFile, generatedSpecFile);
    log('INFO', `generated playwright spec -> ${generatedSpecFile}`);
  } catch (error) {
    log('ERROR', 'playwright generation failed (scan report preserved)', { message: error.message });
  }

  return { reportFile, latestReportFile, todoFile, scanSessionFile, generatedSpecFile };
}

function dedupeUrls(urls) {
  const seen = new Set();
  const out = [];
  for (const url of urls) {
    const normalized = normalizeUrl(url);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return sortRoutes(out);
}

async function run() {
  const { get, has } = parseArgs();

  const baseUrl = normalizeUrl(get('baseUrl') || process.env.APP_URL || 'http://localhost:3000');
  const routesFile = get('routes') || process.env.ROUTES_JSON || '';
  const routeOverride = get('route') || process.env.ROUTE || '';
  const todoFile = get('todo') || process.env.TODO_JSON || '';
  const skippedFile = get('skipped') || process.env.SKIPPED_JSON || 'skipped.json';
  const loginUrl = get('loginUrl') || process.env.LOGIN_PATH || '/login';
  const dashboardUrl = get('dashboardUrl') || process.env.DASHBOARD_PATH || '/dashboard';
  const email = get('email') || process.env.E2E_EMAIL || '';
  const password = get('password') || process.env.E2E_PASSWORD || '';

  const headless = readFlag(get, has, 'headless', 'HEADLESS', true);
  const stopOnError = readFlag(get, has, 'stop-on-error', 'STOP_ON_ERROR', false);
  const stopOnFailRoute = resolveStopOnFailRoute(get, has);
  const screenshotOnError = readFlag(get, has, 'screenshot-on-error', 'SCREENSHOT_ON_ERROR', true);
  const traceEnabled = readFlag(get, has, 'trace', 'TRACE', !!process.env.CI);
  const assumeAuthenticated = readFlag(get, has, 'assume-authenticated', 'ASSUME_AUTHENTICATED', false);
  const requireAuthConfirmation = readFlag(get, has, 'require-auth-confirmation', 'REQUIRE_AUTH_CONFIRMATION', true);

  ensureDir(LOG_DIR);
  const log = createLogger(path.join(LOG_DIR, 'testrunner.log'));

  const mode = routeOverride
    ? 'single-route'
    : todoFile
      ? 'todo-routes'
      : routesFile
        ? 'inventory-routes'
        : 'seed-only';

  const config = {
    mode,
    baseUrl,
    routesFile,
    routeOverride,
    todoFile,
    skippedFile,
    loginUrl,
    dashboardUrl,
    email,
    password,
    headless,
    stopOnError,
    stopOnFailRoute,
    screenshotOnError,
    traceEnabled,
    assumeAuthenticated,
    requireAuthConfirmation,
  };

  const runModel = createRunModel(config);
  let abortRun = false;

  log('INFO', `run mode: ${mode}`);
  log('INFO', `browser mode: ${headless ? 'headless' : 'headed'}`);

  const discovery = new RouteDiscovery(baseUrl, { loginUrl, email, password });

  let inventoryRoutes = [];
  if (routesFile) {
    try {
      inventoryRoutes = discovery.loadLaravelRoutesFromJson(routesFile).map(route => normalizeUrl(route.url));
      log('INFO', `loaded route inventory (${inventoryRoutes.length}) from ${routesFile}`);
    } catch (error) {
      log('WARN', `failed loading inventory (${routesFile}); continuing with dynamic scan`, { message: error.message });
      if (stopOnError) {
        abortRun = true;
        runModel.erroredRoutes.push({
          url: routesFile,
          source: 'inventory',
          message: error.message,
          reason: 'inventory_error',
          artifacts: [],
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  let todoRoutes = [];
  if (todoFile) {
    try {
      const todoData = readJsonIfExists(todoFile);
      todoRoutes = extractTodoRoutes(todoData, baseUrl);
      log('INFO', `loaded todo routes (${todoRoutes.length}) from ${todoFile}`);
    } catch (error) {
      log('WARN', `failed reading todo file (${todoFile})`, { message: error.message });
      if (stopOnError) {
        abortRun = true;
        runModel.erroredRoutes.push({
          url: todoFile,
          source: 'todo',
          message: error.message,
          reason: 'todo_error',
          artifacts: [],
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  let persistedSkippedRoutes = [];
  if (skippedFile) {
    try {
      const skippedData = readJsonIfExists(skippedFile);
      persistedSkippedRoutes = extractSkippedRoutes(skippedData, baseUrl);
      log('INFO', `loaded skipped routes (${persistedSkippedRoutes.length}) from ${skippedFile}`);
    } catch (error) {
      log('WARN', `failed reading skipped file (${skippedFile})`, { message: error.message });
      if (stopOnError) {
        abortRun = true;
        runModel.erroredRoutes.push({
          url: skippedFile,
          source: 'skipped',
          message: error.message,
          reason: 'skipped_file_error',
          artifacts: [],
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  const absoluteRouteOverride = toAbsoluteUrl(baseUrl, routeOverride);
  const dashboardSeed = toAbsoluteUrl(baseUrl, dashboardUrl) || `${baseUrl}/`;

  let seedRoutes = [];
  if (absoluteRouteOverride) {
    seedRoutes = [absoluteRouteOverride];
  } else if (todoRoutes.length > 0) {
    seedRoutes = [...todoRoutes];
  } else if (inventoryRoutes.length > 0) {
    seedRoutes = [dashboardSeed, ...inventoryRoutes, `${baseUrl}/`];
  } else {
    seedRoutes = [dashboardSeed, `${baseUrl}/`];
  }

  seedRoutes = dedupeUrls(seedRoutes);
  if (seedRoutes.length === 0) {
    seedRoutes = [`${baseUrl}/`];
  }

  const queue = seedRoutes.map(url => ({ url, source: 'seed' }));
  const queuedSet = new Set(seedRoutes);
  const scannedSet = new Set();
  const skippedSet = new Set(persistedSkippedRoutes);
  const persistedSkippedSet = new Set(persistedSkippedRoutes);
  const erroredSet = new Set();
  const discoveredSet = new Set();
  runModel.skippedRoutes.push(...persistedSkippedRoutes.map(url => ({
    url,
    reason: 'persisted_skip',
    source: 'skipped_file',
    timestamp: new Date().toISOString(),
  })));

  if (!abortRun) {
    const browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();

    if (traceEnabled) {
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
    }

    try {
      const bootstrap = seedRoutes.find(url => !skippedSet.has(url)) || dashboardSeed;
      log('INFO', `bootstrapping -> ${bootstrap}`);

      await page.goto(bootstrap, { waitUntil: 'domcontentloaded' });
      await maybeLogin(page, config, log, runModel);

      while (queue.length > 0) {
      const { url, source } = queue.shift();
      const routeUrl = normalizeUrl(url);

      if (!routeUrl || scannedSet.has(routeUrl) || skippedSet.has(routeUrl) || erroredSet.has(routeUrl)) {
        continue;
      }

      if (shouldSkipRoute(routeUrl)) {
        skippedSet.add(routeUrl);
        runModel.skippedRoutes.push({
          url: routeUrl,
          reason: 'excluded_pattern',
          source,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      if (isParameterizedRoute(routeUrl)) {
        skippedSet.add(routeUrl);
        runModel.skippedRoutes.push({
          url: routeUrl,
          reason: 'parameterized_route',
          source,
          timestamp: new Date().toISOString(),
        });
        continue;
      }

      const started = Date.now();
      const traceChunkOpen = { value: false };

      if (traceEnabled) {
        await context.tracing.startChunk({ title: `scan:${routeUrl}` });
        traceChunkOpen.value = true;
      }

      try {
        const response = await page.goto(routeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const status = response ? response.status() : null;

        if (status !== null && status >= 400 && status < 600) {
          const errorType = status >= 500 ? 'Server error' : 'Client error';
          throw new Error(`${errorType} (HTTP ${status}) while scanning ${routeUrl}`);
        }

        scannedSet.add(routeUrl);
        discoveredSet.add(routeUrl);

        const links = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map(anchor => anchor.href)
        );

        const newlyQueued = [];
        for (const link of links) {
          const normalized = normalizeUrl(link);
          if (!normalized || !normalized.startsWith(baseUrl)) {
            continue;
          }

          discoveredSet.add(normalized);

          if (shouldSkipRoute(normalized) || isParameterizedRoute(normalized)) {
            continue;
          }

          if (skippedSet.has(normalized) || persistedSkippedSet.has(normalized)) {
            continue;
          }

          if (!queuedSet.has(normalized) && !scannedSet.has(normalized)) {
            queuedSet.add(normalized);
            queue.push({ url: normalized, source: 'discovered' });
            newlyQueued.push(normalized);
          }
        }

        runModel.scannedRoutes.push({
          url: routeUrl,
          source,
          status,
          durationMs: Date.now() - started,
          discoveredLinks: newlyQueued.length,
          timestamp: new Date().toISOString(),
        });

        if (traceEnabled && traceChunkOpen.value) {
          await context.tracing.stopChunk();
          traceChunkOpen.value = false;
        }
      } catch (error) {
        erroredSet.add(routeUrl);
        persistedSkippedSet.add(routeUrl);
        const artifacts = await captureFailureArtifacts({
          page,
          context,
          routeUrl,
          config,
          traceChunkOpen,
          log,
        });

        runModel.artifacts.push(...artifacts.map(artifact => ({ ...artifact, route: routeUrl })));
        runModel.erroredRoutes.push({
          url: routeUrl,
          source,
          message: error.message,
          reason: 'scan_error',
          durationMs: Date.now() - started,
          artifacts,
          timestamp: new Date().toISOString(),
        });

        log('ERROR', `scan error ${routeUrl}`, { message: error.message, artifacts });

        if (stopOnFailRoute || stopOnError) {
          break;
        }
      }
      }
    } catch (error) {
      const artifacts = await captureFailureArtifacts({
        page,
        context,
        routeUrl: page.url() || baseUrl,
        config,
        traceChunkOpen: { value: false },
        log,
      });

      runModel.artifacts.push(...artifacts.map(artifact => ({ ...artifact, route: page.url() || baseUrl })));
      runModel.erroredRoutes.push({
        url: page.url() || baseUrl,
        source: 'runtime',
        message: error.message,
        reason: 'runtime_error',
        artifacts,
        timestamp: new Date().toISOString(),
      });

      log('ERROR', 'runtime error', { message: error.message });
      abortRun = abortRun || stopOnError;
    } finally {
      if (traceEnabled) {
        try {
          const fullTrace = path.join(LOG_DIR, 'traces', `full-run-${Date.now()}.zip`);
          ensureDir(path.dirname(fullTrace));
          await context.tracing.stop({ path: fullTrace });
          runModel.artifacts.push({ type: 'trace', path: fullTrace, route: 'full-run' });
        } catch (error) {
          log('WARN', 'failed to close global trace', { message: error.message });
        }
      }

      await browser.close();
    }
  } else {
    log('WARN', 'scan aborted before browser launch due to stop-on-error preflight failure');
  }

  const inventorySet = new Set(inventoryRoutes.map(normalizeUrl));
  const completed = new Set([
    ...runModel.scannedRoutes.map(route => normalizeUrl(route.url)),
    ...runModel.skippedRoutes.map(route => normalizeUrl(route.url)),
  ]);

  const nonScanned = inventoryRoutes
    .map(normalizeUrl)
    .filter(route => route && !completed.has(route));

  runModel.nonScannedRoutes = sortRoutes(nonScanned).map(route => ({
    url: route,
    reason: stopOnFailRoute || stopOnError ? 'stopped_early' : 'not_reached',
    timestamp: new Date().toISOString(),
  }));

  runModel.discoveredRoutes = sortRoutes([...discoveredSet]);

  runModel.summary.scanned = runModel.scannedRoutes.length;
  runModel.summary.errored = runModel.erroredRoutes.length;
  runModel.summary.skipped = runModel.skippedRoutes.length;
  runModel.summary.nonScanned = runModel.nonScannedRoutes.length;
  runModel.summary.discovered = runModel.discoveredRoutes.length;
  runModel.summary.coverage = inventorySet.size === 0
    ? 100
    : Math.round(((inventorySet.size - runModel.summary.nonScanned) / inventorySet.size) * 100);

  runModel.metadata.endedAt = new Date().toISOString();
  runModel.metadata.durationMs = Date.now() - new Date(runModel.metadata.startedAt).getTime();
  const skippedRoutesFile = writeSkippedRoutesFile(skippedFile, [...persistedSkippedSet], log);

  const outputs = writeRunOutputs(runModel, log);

  log('INFO', 'scan summary', runModel.summary);
  log('INFO', `report -> ${outputs.reportFile}`);
  log('INFO', `todo -> ${outputs.todoFile}`);
  log('INFO', `skipped -> ${skippedRoutesFile}`);

  if (runModel.summary.errored > 0 && (stopOnFailRoute || stopOnError)) {
    process.exitCode = 1;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`[${new Date().toISOString()}] [FATAL]`, error.message);
    process.exit(1);
  });
}
