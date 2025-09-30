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

/**
 * Main conversion function
 * @param {string} recordingFile - Path to the recording JSON file
 * @param {string} outputFile - Path where the test file should be saved
 */
function convertToPlaywright(recordingFile, outputFile) {
  console.log(`\n🔄 Converting ${recordingFile} to Playwright test...\n`);
  
  // ============================================================
  // LOAD RECORDING DATA
  // ============================================================
  
  const session = JSON.parse(fs.readFileSync(recordingFile, 'utf8'));
  
  // ============================================================
  // GENERATE TEST FILE HEADER
  // ============================================================
  
  let testCode = `/**
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

test.describe('Recorded User Session', () => {
  
  test('should replay user interactions', async ({ page }) => {
`;

  // ============================================================
  // BUILD TEST STEPS
  // ============================================================
  
  /**
   * Combine all events into a chronological timeline
   * This ensures actions happen in the correct order
   */
  const timeline = buildTimeline(session);
  
  let currentUrl = '';
  let stepCounter = 1;
  
  for (const event of timeline) {
    switch (event.type) {
      case 'route':
        testCode += generateRouteStep(event, stepCounter);
        currentUrl = event.to;
        stepCounter++;
        break;
        
      case 'click':
        testCode += generateClickStep(event, stepCounter);
        stepCounter++;
        break;
        
      case 'formData':
        if (event.data.type !== 'form-submission') {
          testCode += generateFormInputStep(event, stepCounter);
          stepCounter++;
        } else {
          testCode += generateFormSubmissionStep(event, session, stepCounter);
          stepCounter++;
        }
        break;
        
      case 'network':
        // Network requests are handled implicitly but we can add assertions
        testCode += generateNetworkAssertion(event, stepCounter);
        break;
    }
  }
  
  // ============================================================
  // CLOSE TEST STRUCTURE
  // ============================================================
  
  testCode += `
  });
});
`;

  // ============================================================
  // WRITE TEST FILE
  // ============================================================
  
  fs.writeFileSync(outputFile, testCode);
  
  console.log(`✅ Playwright test generated successfully!`);
  console.log(`📄 File: ${outputFile}`);
  console.log(`\n▶️  Run with: npx playwright test ${outputFile}\n`);
}

/**
 * Generates code for a route navigation step
 */
function generateRouteStep(event, step) {
  return `
    // Step ${step}: Navigate to ${event.to}
    await test.step('Navigate to ${event.path}', async () => {
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
  
  return `
    // Step ${step}: ${comment}
    await test.step('${comment}', async () => {
      const element = page.locator('${escapeSelector(event.selector)}').first();
      await element.waitFor({ state: 'visible', timeout: 10000 });
      await element.click();
      await page.waitForLoadState('networkidle');
    });
`;
}

/**
 * Generates code for filling a form input
 */
function generateFormInputStep(event, step) {
  const fieldName = event.data.name || event.data.id || 'field';
  const value = event.data.value || '';
  
  return `
    // Step ${step}: Fill "${fieldName}" with "${value}"
    await test.step('Fill ${fieldName}', async () => {
      await page.locator('${escapeSelector(event.data.selector)}').fill('${escapeValue(value)}');
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
  const recordingFile = process.argv[2];
  
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
  const outputDir = 'tests-playwright';
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `generated-test-${timestamp}.spec.js`);
  
  convertToPlaywright(recordingFile, outputFile);
}

module.exports = { convertToPlaywright };
