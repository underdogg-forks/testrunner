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

function selectorFor(elementHandle, fallback = '') {
  return elementHandle
    .evaluate((el) => {
      if (el.id) return `#${el.id}`;
      if (el.name) return `[name="${el.name}"]`;
      if (el.getAttribute('data-testid')) return `[data-testid="${el.getAttribute('data-testid')}"]`;
      if (el.className && typeof el.className === 'string') {
        const className = el.className.trim().split(/\s+/).filter(Boolean).join('.');
        if (className) return `${el.tagName.toLowerCase()}.${className}`;
      }
      return el.tagName.toLowerCase();
    })
    .catch(() => fallback || 'unknown');
}

async function run() {
  const args = process.argv.slice(2);
  const getArg = (name) => {
    const exact = `--${name}`;
    const prefixed = `--${name}=`;
    const keyIndex = args.findIndex((a) => a === exact || a.startsWith(prefixed));
    if (keyIndex === -1) return '';
    if (args[keyIndex].startsWith(prefixed)) return args[keyIndex].slice(prefixed.length).trim();
    if (args[keyIndex + 1] && !args[keyIndex + 1].startsWith('--')) return args[keyIndex + 1].trim();
    return '';
  };

  const baseUrl = (getArg('baseUrl') || process.env.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
  const routesFile = getArg('routes') || process.env.ROUTES_FILE || '';
  const loginUrl = getArg('loginUrl') || process.env.LOGIN_URL || '/login';
  const dashboardUrl = getArg('dashboardUrl') || process.env.DASHBOARD_URL || '/dashboard';
  const email = getArg('email') || process.env.TEST_EMAIL || 'a@a.com';
  const password = getArg('password') || process.env.TEST_PASSWORD || 'demopassword';
  const emailSelector = getArg('emailSelector') || process.env.EMAIL_SELECTOR || 'input[name="email"], input[id="email"]';
  const passwordSelector = getArg('passwordSelector') || process.env.PASSWORD_SELECTOR || 'input[name="password"], input[id="password"]';
  const submitSelector = getArg('submitSelector') || process.env.SUBMIT_SELECTOR || 'button[type="submit"], input[type="submit"]';
  const headless = (process.env.HEADLESS || 'true') !== 'false';

  if (!routesFile.trim()) {
    console.error('❌ Error: Provide routes inventory using ROUTES_FILE or --routes.');
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
      startUrl: baseUrl,
      baseUrl,
      routesFile,
      dashboardUrl,
      mode: 'advanced-generation'
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
    const message = error instanceof Error ? error.message : String(error);
    session.problems.push({
      timestamp: new Date().toISOString(),
      scope,
      message
    });
    log(`${scope}: ${message}`, 'ERROR');
  };

  try {
    const discovery = new RouteDiscovery(baseUrl, { loginUrl, email, password, emailSelector, passwordSelector, submitSelector });
    const routes = discovery.loadLaravelRoutesFromJson(routesFile);
    const seeded = routes.map((r) => normalizeUrl(r.url)).filter(Boolean);
    const routeChecklist = new Set(seeded);
    const touchedRouteChecklist = new Set();
    const queue = Array.from(new Set(seeded));
    const visited = new Set();
    const queued = new Set(queue);

    log(`Loaded ${queue.length} routes from ${routesFile}`);

    browser = await chromium.launch({ headless });
    const context = await browser.newContext();
    const page = await context.newPage();
    session.metadata.userAgent = await page.evaluate(() => navigator.userAgent);
    session.metadata.viewport = page.viewportSize();

    page.on('request', (request) => {
      const method = request.method();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
      session.networkRequests.push({
        step,
        timestamp: new Date().toISOString(),
        method,
        url: request.url(),
        headers: request.headers(),
        postData: request.postData(),
        resourceType: request.resourceType()
      });
    });

    page.on('response', async (response) => {
      const request = response.request();
      const method = request.method();
      if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return;
      const index = session.networkRequests.findIndex((r) => r.url === request.url() && r.method === method && !r.response);
      if (index === -1) return;
      session.networkRequests[index].response = {
        status: response.status(),
        statusText: response.statusText()
      };
    });

    // Login once before route traversal
    try {
      await page.goto(`${baseUrl}${loginUrl}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.fill(emailSelector, email);
      await page.fill(passwordSelector, password);
      await Promise.all([
        page.waitForURL((url) => !url.includes(loginUrl), { timeout: 15000 }),
        page.click(submitSelector)
      ]);
      log(`Authenticated using ${loginUrl}`);
      try {
        await page.goto(`${baseUrl}${dashboardUrl}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        log(`Reached dashboard at ${dashboardUrl}`);
      } catch (error) {
        recordProblem('dashboard', error);
      }
    } catch (error) {
      recordProblem('login', error);
      log('Continuing without confirmed authenticated state');
    }

    const collectInternalLinks = async () => {
      const urls = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('a[href]')).map((a) => ({
          href: a.href,
          text: (a.innerText || a.textContent || '').trim().slice(0, 160),
          id: a.id || '',
          className: typeof a.className === 'string' ? a.className : ''
        }));
      });

      const unique = new Set();
      const internalLinks = [];
      for (const entry of urls) {
        const normalized = normalizeUrl(entry.href);
        if (!normalized || unique.has(normalized)) continue;
        unique.add(normalized);
        if (!normalized.startsWith(baseUrl)) continue;
        internalLinks.push({ ...entry, href: normalized });
      }

      for (const found of internalLinks) {
        const normalized = found.href;
        if (!normalized || queued.has(normalized) || visited.has(normalized)) continue;
        queued.add(normalized);
        queue.push(normalized);
      }

      return internalLinks;
    };

    const fillFormsAndSubmit = async (currentUrl) => {
      const forms = await page.locator('form').all();
      for (const form of forms) {
        const fields = await form.locator('input:not([type="hidden"]):not([readonly]):not([disabled]), textarea:not([readonly]):not([disabled]), select:not([disabled])').all();
        const submittedData = {};
        for (const field of fields) {
          const fieldType = ((await field.getAttribute('type')) || '').toLowerCase();
          const tagName = ((await field.evaluate((el) => el.tagName)) || '').toLowerCase();
          const name = (await field.getAttribute('name')) || (await field.getAttribute('id')) || '';
          const selector = await selectorFor(field, name ? `[name="${name}"]` : tagName);

          try {
            if (tagName === 'select') {
              const optionValue = await field.evaluate((el) => {
                const select = el;
                const opt = Array.from(select.options).find((o) => !o.disabled && o.value !== '');
                return opt ? opt.value : '';
              });
              if (optionValue) {
                await field.selectOption(optionValue);
                submittedData[name || selector] = optionValue;
              }
            } else if (fieldType === 'checkbox' || fieldType === 'radio') {
              await field.check({ force: true }).catch(() => {});
              submittedData[name || selector] = true;
            } else if (fieldType === 'file') {
              continue;
            } else {
              const dummyValue = (() => {
                if (name.includes('email') || fieldType === 'email') return `dummy.${Date.now()}@example.test`;
                if (name.includes('password') || fieldType === 'password') return 'Password123!';
                if (fieldType === 'number') return '1';
                if (fieldType === 'date') return '2024-01-01';
                if (fieldType === 'datetime-local') return '2024-01-01T12:00';
                if (fieldType === 'tel') return '1234567890';
                if (fieldType === 'url') return 'https://example.test';
                return `Dummy ${name || 'value'} ${Date.now()}`;
              })();
              await field.fill(dummyValue);
              submittedData[name || selector] = dummyValue;
            }

            session.formData.push({
              step,
              timestamp: new Date().toISOString(),
              selector,
              name,
              type: fieldType || tagName,
              value: submittedData[name || selector] ?? ''
            });
            step += 1;
          } catch (error) {
            recordProblem(`form-field:${currentUrl}`, error);
          }
        }

        if (Object.keys(submittedData).length > 0) {
          session.formData.push({
            step,
            timestamp: new Date().toISOString(),
            type: 'form-submission',
            selector: await selectorFor(form, 'form'),
            method: (await form.getAttribute('method')) || 'post',
            action: (await form.getAttribute('action')) || currentUrl,
            data: submittedData,
            url: currentUrl,
            pathname: new URL(currentUrl).pathname
          });
          step += 1;

          try {
            const submitButton = form.locator('button[type="submit"], input[type="submit"]').first();
            if (await submitButton.count()) {
              await Promise.race([
                page.waitForLoadState('networkidle', { timeout: 5000 }),
                submitButton.click({ timeout: 5000 })
              ]);
            }
          } catch (error) {
            recordProblem(`form-submit:${currentUrl}`, error);
          }
        }
      }
    };

    while (queue.length > 0) {
      const url = queue.shift();
      if (!url || visited.has(url)) continue;
      visited.add(url);

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
        const currentUrl = normalizeUrl(page.url());
        const routePath = (() => {
          try {
            return new URL(currentUrl).pathname;
          } catch {
            return '/';
          }
        })();

        session.routes.push({
          step,
          timestamp: new Date().toISOString(),
          from: session.routes.length ? session.routes[session.routes.length - 1].to : 'initial',
          to: currentUrl,
          path: routePath
        });
        step += 1;

        if (routeChecklist.has(currentUrl)) {
          touchedRouteChecklist.add(currentUrl);
        }

        await fillFormsAndSubmit(currentUrl);

        const discoveredLinks = await collectInternalLinks();
        for (const link of discoveredLinks) {
          const safeHref = link.href.replace(/"/g, '\\"');
          session.clicks.push({
            step,
            timestamp: new Date().toISOString(),
            selector: link.id ? `#${link.id}` : `a[href="${safeHref}"]`,
            text: link.text,
            tagName: 'A',
            href: link.href,
            url: currentUrl,
            pathname: routePath
          });
          step += 1;
        }

      } catch (error) {
        if (!(error instanceof errors.TimeoutError)) {
          recordProblem(`navigate:${url}`, error);
        } else {
          recordProblem(`navigate-timeout:${url}`, error);
        }
      }
    }

    const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
    session.metadata.endTime = new Date().toISOString();
    session.metadata.duration = Date.now() - new Date(session.metadata.startTime).getTime();
    session.metadata.visitedRoutes = session.routes.length;
    session.metadata.discoveredProblems = session.problems.length;
    session.metadata.routeInventoryTotal = routeChecklist.size;
    session.metadata.routeInventoryTouched = touchedRouteChecklist.size;
    session.metadata.routeInventoryUntouched = routeChecklist.size - touchedRouteChecklist.size;

    const recordingFile = path.join(recordingsDir, `e2e-session-${timestamp}.json`);
    fs.writeFileSync(recordingFile, JSON.stringify(session, null, 2));
    log(`Saved recording to ${recordingFile}`);

    const outputFile = path.join(testsDir, `advanced-generated-${timestamp}.spec.js`);
    convertToPlaywright(recordingFile, outputFile);
    log(`Generated Playwright test at ${outputFile}`);

    const untouchedRoutes = Array.from(routeChecklist).filter((route) => !touchedRouteChecklist.has(route));
    const todoFile = path.resolve('todo.txt');
    const todoContent = [
      '# Untouched routes from routes.json',
      '',
      ...(untouchedRoutes.length
        ? untouchedRoutes.map((route) => `- [ ] ${route}`)
        : ['All routes from routes.json were touched.'])
    ].join('\n');
    fs.writeFileSync(todoFile, todoContent);
    log(`Wrote untouched-route checklist to ${todoFile}`);

    log(`Finished with ${session.problems.length} problem(s). See ${logFile}`);
  } catch (error) {
    recordProblem('fatal', error);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
  }
}

if (require.main === module) {
  run();
}
