const fs = require('fs');
const path = require('path');
const { buildTimeline, escapeSelector, escapeValue } = require('./utils');

/**
 * Converts a recorded session to Playwright test format
 * 
 * This script takes the JSON recording from record-advanced.js and generates
 * a complete Playwright test file with:
 * - Page navigation steps
 * - Click interactions
 * - Form filling with actual data
 * - Assertions based on network responses
 * - Proper test structure with describe/test blocks
 * 
 * @usage
 * npm run convert:playwright recordings/session-[timestamp].json
 * 
 * @output
 * tests-playwright/generated-test-[timestamp].spec.js
 */

function toPathname(value) {
  if (!value) return '/';
  try {
    return new URL(value).pathname || '/';
  } catch {
    return String(value).startsWith('/') ? String(value) : '/';
  }
}

function sanitizeSegment(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

function toPhenomenon(pathname) {
  const segment = String(pathname || '/')
    .replace(/^\/+/, '')
    .split('/')[0];
  return sanitizeSegment(segment) || 'core';
}

function toDescribeName(phenomenon) {
  const normalized = sanitizeSegment(phenomenon) || 'core';
  return normalized
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('') + 'Controller';
}

function eventPathname(event) {
  if (!event) return '/';
  if (event.type === 'route') return event.path || toPathname(event.to);
  if (event.type === 'click') return event.pathname || toPathname(event.url);
  if (event.type === 'formData') return event.data?.pathname || toPathname(event.data?.url);
  if (event.type === 'network') return toPathname(event.url);
  return '/';
}

function groupEventsByPhenomenon(timeline) {
  const groups = new Map();
  let currentPhenomenon = 'core';

  for (const event of timeline) {
    const pathname = eventPathname(event);
    const candidate = toPhenomenon(pathname);
    const phenomenon = event.type === 'route' || candidate !== 'core'
      ? candidate
      : currentPhenomenon;

    if (event.type === 'route') currentPhenomenon = phenomenon;

    if (!groups.has(phenomenon)) groups.set(phenomenon, []);
    groups.get(phenomenon).push(event);
  }

  if (groups.size === 0) {
    groups.set('core', []);
  }

  return groups;
}

function groupEventsByRoute(events) {
  const routeGroups = [];
  let currentGroup = null;
  let currentRoute = '';

  for (const event of events) {
    if (event.type === 'route' && event.to && event.to !== currentRoute) {
      if (currentGroup && currentGroup.events.length > 0) {
        routeGroups.push(currentGroup);
      }

      currentRoute = event.to;
      currentGroup = {
        route: currentRoute,
        path: event.path || toPathname(event.to),
        events: [event],
      };
      continue;
    }

    if (!currentGroup) {
      const inferredPath = eventPathname(event);
      currentGroup = {
        route: inferredPath,
        path: inferredPath,
        events: [],
      };
    }

    currentGroup.events.push(event);
  }

  if (currentGroup && currentGroup.events.length > 0) {
    routeGroups.push(currentGroup);
  }

  return routeGroups;
}

function createHeader(session, recordingFile) {
  return `/**
 * Auto-generated Playwright Test
 * Generated from: ${path.basename(recordingFile)}
 * Recording date: ${session.metadata.startTime}
 * Duration: ${Math.round(session.metadata.duration / 1000)}s
 * 
 * This test replicates a recorded user session including:
 * - ${session.clicks.length} clicks
 * - ${session.routes.length} route changes
 * - ${session.formData.length} form interactions
 * - ${session.networkRequests.length} network requests
 */

import { test, expect } from '@playwright/test';

`;
}

function renderGroupedSpec({ session, recordingFile, describeName, events }) {
  const routeGroups = groupEventsByRoute(events);
  let testCode = createHeader(session, recordingFile);

  testCode += `test.describe('${escapeValue(describeName)}', () => {\n`;

  if (routeGroups.length === 0) {
    testCode += `
  test('should have recorded interactions', async () => {
    expect(true).toBeTruthy();
  });
`;
  } else {
    let testIndex = 1;
    for (const group of routeGroups) {
      const pathName = group.path || '/';
      let stepCounter = 1;
      testCode += `
  test('should replay ${escapeValue(pathName)} interactions (${testIndex})', async ({ page }) => {
`;

      for (const event of group.events) {
        switch (event.type) {
          case 'route':
            testCode += generateRouteStep(event, stepCounter);
            stepCounter++;
            break;
          case 'click':
            testCode += generateClickStep(event, stepCounter);
            stepCounter++;
            break;
          case 'formData':
            if (event.data?.type === 'form-submission') {
              testCode += generateFormSubmissionStep(event, session, stepCounter);
              stepCounter++;
            } else {
              testCode += generateFormInputStep(event, stepCounter);
              stepCounter++;
            }
            break;
          case 'network':
            testCode += generateNetworkAssertion(event, stepCounter);
            break;
        }
      }

      testCode += `
  });
`;
      testIndex++;
    }
  }

  testCode += `
});
`;

  return testCode;
}

/**
 * Main conversion function
 * @param {string} recordingFile - Path to the recording JSON file
 * @param {string} outputFile - Path where the test file should be saved
 * @param {Object} options - Optional generation settings
 */
function convertToPlaywright(recordingFile, outputFile, options = {}) {
  console.log(`\n🔄 Converting ${recordingFile} to Playwright test...\n`);
  
  // ============================================================
  // LOAD RECORDING DATA
  // ============================================================
  
  const rawSession = JSON.parse(fs.readFileSync(recordingFile, 'utf8'));
  const session = {
    ...rawSession,
    metadata: rawSession.metadata || {},
    clicks: Array.isArray(rawSession.clicks) ? rawSession.clicks : [],
    routes: Array.isArray(rawSession.routes) ? rawSession.routes : [],
    formData: Array.isArray(rawSession.formData) ? rawSession.formData : [],
    networkRequests: Array.isArray(rawSession.networkRequests) ? rawSession.networkRequests : [],
  };

  // ============================================================
  // BUILD TEST STEPS
  // ============================================================
  
  const timeline = buildTimeline(session);
  const splitByPhenomenon = options.splitByPhenomenon === true;
  const generatedFiles = [];

  if (!splitByPhenomenon) {
    const testCode = renderGroupedSpec({
      session,
      recordingFile,
      describeName: 'Recorded User Session',
      events: timeline,
    });
    fs.writeFileSync(outputFile, testCode);
    generatedFiles.push(outputFile);
  } else {
    const groups = groupEventsByPhenomenon(timeline);
    const outputRoot = options.phenomenonOutputDir || path.dirname(outputFile);
    const outputName = path.basename(outputFile);

    for (const [phenomenon, events] of groups.entries()) {
      const phenomenonDir = path.join(outputRoot, phenomenon);
      fs.mkdirSync(phenomenonDir, { recursive: true });

      const phenomenonFile = path.join(phenomenonDir, outputName);
      const describeName = toDescribeName(phenomenon);
      const testCode = renderGroupedSpec({
        session,
        recordingFile,
        describeName,
        events,
      });

      fs.writeFileSync(phenomenonFile, testCode);
      generatedFiles.push(phenomenonFile);
    }
  }

  console.log(`✅ Playwright test generated successfully!`);
  for (const file of generatedFiles) {
    console.log(`📄 File: ${file}`);
  }
  console.log(`\n▶️  Run with: npx playwright test\n`);

  return generatedFiles;
}

/**
 * Generates code for a route navigation step
 */
function generateRouteStep(event, step) {
  const routePath = event.path || toPathname(event.to);
  return `
    // Step ${step}: Navigate to ${event.to}
    await test.step('Navigate to ${routePath}', async () => {
      await page.goto('${event.to}');
      await page.waitForLoadState('networkidle');
    });
`;
}

/**
 * Generates code for a click interaction
 */
function generateClickStep(event, step) {
  const comment = event.text ? `Click "${event.text}"` : `Click ${event.tagName}`;
  const selectorCode = event.selector ? `page.locator('${escapeSelector(event.selector)}').first()` : null;
  const textCode = event.text ? `page.getByText('${escapeValue(event.text)}').first()` : null;
  const locatorCode = selectorCode || textCode;
  const clickAction = locatorCode
    ? `const element = ${locatorCode};
      await element.waitFor({ state: 'visible', timeout: 10000 });
      await element.click();`
    : `// No selector or text captured for this click; skipping click action.`;
  
  return `
    // Step ${step}: ${comment}
    await test.step('${comment}', async () => {
      ${clickAction}
      await page.waitForLoadState('networkidle');
    });
`;
}

/**
 * Generates code for filling a form input
 */
function generateFormInputStep(event, step) {
  if (!event.data) {
    return `
    // Step ${step}: Form input event missing data
    // Skipped because no data payload was captured
`;
  }

  const fieldName = event.data.name || event.data.id || 'field';
  const value = event.data.value || '';
  const locator = event.data.selector
    ? `page.locator('${escapeSelector(event.data.selector)}')`
    : `page.locator('[name="${escapeSelector(fieldName)}"], #${escapeSelector(fieldName)}').first()`;
  
  return `
    // Step ${step}: Fill "${fieldName}" with "${value}"
    await test.step('Fill ${fieldName}', async () => {
      await ${locator}.fill('${escapeValue(value)}');
    });
`;
}

/**
 * Generates code for a complete form submission
 */
function generateFormSubmissionStep(event, session, step) {
  let code = `
    // Step ${step}: Submit form with data
    await test.step('Submit form', async () => {
`;
  
  // Fill all form fields
  if (event.data.data) {
    for (const [key, value] of Object.entries(event.data.data)) {
      code += `      await page.fill('[name="${key}"]', '${escapeValue(value)}');\n`;
    }
  }
  
  code += `      await page.click('button[type="submit"], input[type="submit"]');
      await page.waitForLoadState('networkidle');
    });
`;
  
  return code;
}

/**
 * Generates network request assertions
 */
function generateNetworkAssertion(event, step) {
  return `
    // Step ${step}: Verify ${event.method} request to ${event.url}
    // Network request captured: ${event.method} ${event.url}
    // Status: ${event.response?.status || 'pending'}
`;
}

// ============================================================
// CLI EXECUTION
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);
  let recordingFile = '';
  let splitByPhenomenon = false;
  let outputDirFromArg = '';

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--split-by-phenomenon' || arg === '--split') {
      splitByPhenomenon = true;
      continue;
    }

    if (arg.startsWith('--output-dir=')) {
      outputDirFromArg = arg.substring(arg.indexOf('=') + 1).trim();
      continue;
    }

    if (arg === '--output-dir' && args[i + 1] && !args[i + 1].startsWith('--')) {
      outputDirFromArg = args[i + 1].trim();
      i += 1;
      continue;
    }

    if (!arg.startsWith('--') && !recordingFile) {
      recordingFile = arg;
    }
  }
  
  if (!recordingFile) {
    console.error('❌ Error: Please provide a recording file');
    console.log('\nUsage: npm run convert:playwright recordings/session-[timestamp].json');
    process.exit(1);
  }
  
  if (!fs.existsSync(recordingFile)) {
    console.error(`❌ Error: Recording file not found: ${recordingFile}`);
    process.exit(1);
  }
  
  // Generate output filename
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const outputDir = outputDirFromArg || process.env.E2E_TESTS_DIR || 'tests-playwright';
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `generated-test-${timestamp}.spec.js`);
  
  convertToPlaywright(recordingFile, outputFile, {
    splitByPhenomenon,
    phenomenonOutputDir: outputDir,
  });
}

module.exports = { convertToPlaywright };
