const fs = require('fs');
const path = require('path');

/**
 * Converts a recorded session to PHPUnit test format
 * 
 * This script takes the JSON recording from advanced-recording.js and generates
 * a complete PHPUnit Feature test file with:
 * - HTTP GET requests for route navigation
 * - POST/PUT requests for form submissions
 * - Assertions based on recorded interactions
 * - Proper test structure following Laravel conventions
 * 
 * @usage
 * npm run convert:phpunit recordings/session-[timestamp].json
 * 
 * @output
 * tests/Feature/GeneratedRecordedSessionTest.php
 */

/**
 * Main conversion function
 * @param {string} recordingFile - Path to the recording JSON file
 * @param {string} outputFile - Path where the test file should be saved
 */
function convertToPhpUnit(recordingFile, outputFile) {
  console.log(`\n🔄 Converting ${recordingFile} to PHPUnit test...\n`);
  
  // ============================================================
  // LOAD RECORDING DATA
  // ============================================================
  
  const session = JSON.parse(fs.readFileSync(recordingFile, 'utf8'));
  
  // ============================================================
  // GENERATE TEST FILE HEADER
  // ============================================================
  
  let testCode = `<?php

namespace Tests\\Feature;

use App\\Models\\User;
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
class GeneratedRecordedSessionTest extends TestCase
{
    use RefreshDatabase;

    protected User $user;

    protected function setUp(): void
    {
        parent::setUp();
        
        // Create an authenticated user for the tests
        // Adjust the factory call based on your User model setup
        $this->user = User::factory()->create();
    }

    /**
     * Test the recorded user session
     *
     * @return void
     */
    public function test_recorded_user_session(): void
    {
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
  let formDataBuffer = {}; // Store form data until submission
  
  for (const event of timeline) {
    switch (event.type) {
      case 'route':
        // Generate HTTP GET request for route navigation
        if (event.to !== currentUrl) {
          testCode += generateRouteStep(event, stepCounter);
          currentUrl = event.to;
          stepCounter++;
        }
        break;
        
      case 'click':
        // Some clicks trigger navigation or form submission
        // We'll add them as comments for context
        testCode += generateClickComment(event, stepCounter);
        stepCounter++;
        break;
        
      case 'formData':
        if (event.data.type === 'form-submission') {
          // Generate POST/PUT request with all form data
          testCode += generateFormSubmissionStep(event, session, stepCounter);
          formDataBuffer = {}; // Clear buffer after submission
          stepCounter++;
        } else {
          // Store form field data for later submission
          const fieldName = event.data.name || event.data.id;
          if (fieldName) {
            formDataBuffer[fieldName] = event.data.value;
          }
        }
        break;
        
      case 'network':
        // Add network request verification as comments
        testCode += generateNetworkComment(event, stepCounter);
        break;
    }
  }
  
  // ============================================================
  // CLOSE TEST STRUCTURE
  // ============================================================
  
  testCode += `    }
}
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
 * Generates code for a route navigation step
 */
function generateRouteStep(event, step) {
  const url = new URL(event.to);
  const path = url.pathname;
  
  return `        // Step ${step}: Navigate to ${path}
        $response = $this->actingAs($this->user)->get('${path}');
        $response->assertStatus(200);

`;
}

/**
 * Generates a comment for click interactions
 */
function generateClickComment(event, step) {
  const comment = event.text ? `Click "${event.text}"` : `Click ${event.tagName}`;
  
  return `        // Step ${step}: ${comment}
`;
}

/**
 * Generates code for a complete form submission
 */
function generateFormSubmissionStep(event, session, step) {
  const url = new URL(event.data.url);
  const path = url.pathname;
  const method = (event.data.method || 'post').toLowerCase();
  const phpMethod = method === 'get' ? 'get' : (method === 'put' || method === 'patch' ? 'put' : 'post');
  
  let code = `        // Step ${step}: Submit form to ${path}
`;
  
  // Generate the form data array
  if (event.data.data && Object.keys(event.data.data).length > 0) {
    code += `        $formData = [\n`;
    
    for (const [key, value] of Object.entries(event.data.data)) {
      const escapedValue = escapePhpValue(value);
      code += `            '${key}' => ${escapedValue},\n`;
    }
    
    code += `        ];\n\n`;
    code += `        $response = $this->actingAs($this->user)->${phpMethod}('${path}', $formData);\n`;
  } else {
    code += `        $response = $this->actingAs($this->user)->${phpMethod}('${path}');\n`;
  }
  
  code += `        $response->assertSessionHasNoErrors();
        // Adjust the assertion below based on expected behavior (redirect, status, etc.)
        $response->assertStatus(302); // Typically redirects after form submission

`;
  
  return code;
}

/**
 * Generates a comment for network requests
 */
function generateNetworkComment(event, step) {
  return `        // Step ${step}: ${event.method} request to ${event.url}
        // Status: ${event.response?.status || 'pending'}
`;
}

/**
 * Escapes and formats values for PHP
 */
function escapePhpValue(value) {
  if (value === null || value === undefined) {
    return 'null';
  }
  
  if (typeof value === 'boolean') {
    return value ? 'true' : 'false';
  }
  
  if (typeof value === 'number') {
    return String(value);
  }
  
  // String values need to be escaped
  const escapedValue = String(value)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  
  return `'${escapedValue}'`;
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
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const outputDir = 'tests/Feature';
  fs.mkdirSync(outputDir, { recursive: true });
  const outputFile = path.join(outputDir, `GeneratedRecordedSessionTest.php`);
  
  convertToPhpUnit(recordingFile, outputFile);
}

module.exports = { convertToPhpUnit };
