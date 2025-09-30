const fs = require('fs');
const path = require('path');

/**
 * Converts a recorded session to PHPUnit test format
 * 
 * This script takes the JSON recording from advanced-recording.js and generates
 * PHPUnit Feature tests with:
 * - HTTP requests for navigation
 * - Form submissions with actual data
 * - Response assertions
 * - Proper test structure with test methods
 * 
 * @usage
 * npm run convert:phpunit recordings/session-[timestamp].json
 * 
 * @output
 * tests/Feature/GeneratedTest[timestamp].php
 */

/**
 * Main conversion function
 * @param {string} recordingFile - Path to the recording JSON file
 * @param {string} outputFile - Path where the test file should be saved
 */
function convertToPHPUnit(recordingFile, outputFile) {
  console.log(`\n🔄 Converting ${recordingFile} to PHPUnit test...\n`);
  
  // ============================================================
  // LOAD RECORDING DATA
  // ============================================================
  
  const session = JSON.parse(fs.readFileSync(recordingFile, 'utf8'));
  
  // ============================================================
  // GENERATE TEST FILE HEADER
  // ============================================================
  
  const className = 'GeneratedTest' + new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  
  let testCode = `<?php

namespace Tests\\Feature;

use Illuminate\\Foundation\\Testing\\RefreshDatabase;
use Tests\\TestCase;

/**
 * Auto-generated PHPUnit Feature Test
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
class ${className} extends TestCase
{
`;

  // ============================================================
  // BUILD TEST METHODS
  // ============================================================
  
  /**
   * Combine all events into a chronological timeline
   * This ensures actions happen in the correct order
   */
  const timeline = buildTimeline(session);
  
  let testMethodCounter = 1;
  let currentUrl = '';
  let formDataBuffer = {};
  
  // Group events by route to create separate test methods
  const routeGroups = [];
  let currentGroup = { route: '', events: [] };
  
  for (const event of timeline) {
    if (event.type === 'route' && event.to !== currentUrl) {
      if (currentGroup.events.length > 0) {
        routeGroups.push(currentGroup);
      }
      currentGroup = { route: event.to, events: [] };
      currentUrl = event.to;
    }
    currentGroup.events.push(event);
  }
  
  if (currentGroup.events.length > 0) {
    routeGroups.push(currentGroup);
  }
  
  // Generate test method for each route group
  for (const group of routeGroups) {
    const path = new URL(group.route).pathname;
    const methodName = 'test_' + sanitizeMethodName(path) + '_' + testMethodCounter;
    
    testCode += generateTestMethod(methodName, group, session);
    testMethodCounter++;
  }
  
  // ============================================================
  // CLOSE TEST CLASS
  // ============================================================
  
  testCode += `}
`;

  // ============================================================
  // WRITE TEST FILE
  // ============================================================
  
  fs.writeFileSync(outputFile, testCode);
  
  console.log(`✅ PHPUnit test generated successfully!`);
  console.log(`📄 File: ${outputFile}`);
  console.log(`\n▶️  Run with: php artisan test ${outputFile}\n`);
}

/**
 * Builds a chronological timeline of all events
 * @param {Object} session - The recorded session object
 * @returns {Array} Sorted array of all events
 */
function buildTimeline(session) {
  const timeline = [];
  
  // Add all routes
  session.routes.forEach(route => {
    timeline.push({ type: 'route', ...route });
  });
  
  // Add all clicks
  session.clicks.forEach(click => {
    timeline.push({ type: 'click', ...click });
  });
  
  // Add all form data
  session.formData.forEach(form => {
    timeline.push({ type: 'formData', data: form, timestamp: form.timestamp });
  });
  
  // Add network requests
  session.networkRequests.forEach(req => {
    timeline.push({ type: 'network', ...req });
  });
  
  // Sort by timestamp
  timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  return timeline;
}

/**
 * Generates a test method for a route group
 */
function generateTestMethod(methodName, group, session) {
  let code = `    /**
     * Test user interaction on ${group.route}
     */
    public function ${methodName}(): void
    {
`;

  const path = new URL(group.route).pathname;
  
  // Check if this is a form submission route
  const hasFormSubmission = group.events.some(e => 
    e.type === 'formData' && e.data.type === 'form-submission'
  );
  
  if (hasFormSubmission) {
    // Generate POST request with form data
    const formEvent = group.events.find(e => 
      e.type === 'formData' && e.data.type === 'form-submission'
    );
    
    code += `        // Submit form with recorded data\n`;
    code += `        $response = $this->post('${path}', [\n`;
    
    if (formEvent && formEvent.data.data) {
      for (const [key, value] of Object.entries(formEvent.data.data)) {
        code += `            '${escapePhpString(key)}' => '${escapePhpString(value)}',\n`;
      }
    }
    
    code += `        ]);\n\n`;
    
    // Add assertions based on network responses
    const networkEvent = session.networkRequests.find(req => 
      req.method === 'POST' && req.url.includes(path)
    );
    
    if (networkEvent && networkEvent.response) {
      if (networkEvent.response.status >= 200 && networkEvent.response.status < 300) {
        code += `        $response->assertSuccessful();\n`;
      } else if (networkEvent.response.status >= 300 && networkEvent.response.status < 400) {
        code += `        $response->assertRedirect();\n`;
      }
    } else {
      code += `        $response->assertStatus(200);\n`;
    }
  } else {
    // Generate GET request
    code += `        // Navigate to ${group.route}\n`;
    code += `        $response = $this->get('${path}');\n\n`;
    code += `        $response->assertStatus(200);\n`;
  }
  
  code += `    }\n\n`;
  
  return code;
}

/**
 * Sanitizes a path to create a valid PHP method name
 */
function sanitizeMethodName(path) {
  return path
    .replace(/^\//, '')
    .replace(/\//g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .toLowerCase() || 'index';
}

/**
 * Escapes special characters for PHP strings
 */
function escapePhpString(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

// ============================================================
// CLI EXECUTION
// ============================================================

if (require.main === module) {
  const recordingFile = process.argv[2];
  
  if (!recordingFile) {
    console.error('❌ Error: Please provide a recording file');
    console.log('\nUsage: npm run convert:phpunit recordings/session-[timestamp].json');
    process.exit(1);
  }
  
  if (!fs.existsSync(recordingFile)) {
    console.error(`❌ Error: Recording file not found: ${recordingFile}`);
    process.exit(1);
  }
  
  // Generate output filename
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').split('.')[0];
  const outputDir = 'tests/Feature';
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `GeneratedTest${timestamp}.php`);
  
  convertToPHPUnit(recordingFile, outputFile);
}

module.exports = { convertToPHPUnit };
