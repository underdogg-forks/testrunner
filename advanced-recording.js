const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

/**
 * Advanced Playwright Recorder
 * 
 * This script records comprehensive user interactions including:
 * - Every click with element details (selector, text, position)
 * - Route changes and URL navigation history
 * - Form data and input values entered by the user
 * - Network requests (POST/PUT/PATCH) with full payloads
 * - Response data from API calls
 * 
 * The recorded data can be used to:
 * 1. Generate automated tests (Playwright, PHPUnit, Jest)
 * 2. Replay user sessions for debugging
 * 3. Analyze user workflows and data flow
 * 4. Create documentation of application behavior
 *
 * Note:
 * - This is a manual recorder (it captures your actions).
 * - It does not auto-crawl or auto-click all application routes.
 * 
 * @usage
 * npm run record
 * 
 * @output
 * - recordings/session-[timestamp].json (Complete session data)
 * - storage/logs/console.log (Human-readable log)
 */

(async () => {
  // ============================================================
  // CONFIGURATION
  // ============================================================
  
  const config = {
    // Starting URL for the recording session
    startUrl: process.env.START_URL || process.env.APP_URL || 'http://localhost:3000',
    
    // Maximum recording duration in milliseconds (5 minutes default)
    maxDuration: parseInt(process.env.MAX_DURATION) || 300000,
    
    // Whether to record network requests
    recordNetwork: process.env.RECORD_NETWORK !== 'false',
    
    // Whether to capture screenshots on each click
    captureScreenshots: process.env.CAPTURE_SCREENSHOTS === 'true',
    
    // Browser launch options
    headless: false,
    slowMo: 0, // Delay in ms between operations for visibility
  };

  // ============================================================
  // INITIALIZE BROWSER AND CONTEXT
  // ============================================================
  
  const browser = await chromium.launch({ 
    headless: config.headless,
    slowMo: config.slowMo 
  });
  
  const context = await browser.newContext({
    // Record videos if needed (optional)
    // recordVideo: { dir: 'recordings/videos/' }
  });
  
  const page = await context.newPage();
  
  // ============================================================
  // DATA STRUCTURES FOR RECORDING
  // ============================================================
  
  /**
   * Session object stores all recorded data
   * @type {Object}
   */
  const session = {
    metadata: {
      startTime: new Date().toISOString(),
      startUrl: config.startUrl,
      userAgent: await page.evaluate(() => navigator.userAgent),
      viewport: page.viewportSize(),
    },
    clicks: [],          // Array of click events
    routes: [],          // Array of route/URL changes
    formData: [],        // Array of form submissions with data
    networkRequests: [], // Array of POST/PUT/PATCH requests with payloads
    screenshots: [],     // Array of screenshot file paths (if enabled)
  };
  
  let stepNumber = 1;
  let previousUrl = '';
  
  // ============================================================
  // SETUP LOGGING
  // ============================================================
  
  const logDir = 'storage/logs';
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'console.log');
  
  /**
   * Logs a message to both console and file
   * @param {string} message - The message to log
   * @param {string} level - Log level (INFO, CLICK, ROUTE, FORM, NETWORK)
   */
  function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    fs.appendFileSync(logFile, logMessage);
    console.log(`[${level}] ${message}`);
  }
  
  // Clear previous log
  fs.writeFileSync(logFile, '');
  
  // ============================================================
  // NETWORK REQUEST INTERCEPTION
  // ============================================================
  
  /**
   * Intercepts network requests to capture POST/PUT/PATCH data
   * This captures API calls, form submissions, and AJAX requests
   */
  if (config.recordNetwork) {
    page.on('request', request => {
      const method = request.method();
      
      // Only capture mutation requests (POST, PUT, PATCH, DELETE)
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        const requestData = {
          step: stepNumber,
          timestamp: new Date().toISOString(),
          method: method,
          url: request.url(),
          headers: request.headers(),
          postData: request.postData(), // Request payload
          resourceType: request.resourceType(), // xhr, fetch, document, etc.
        };
        
        session.networkRequests.push(requestData);
        
        log(
          `Network ${method}: ${request.url().substring(0, 80)}...`,
          'NETWORK'
        );
      }
    });
    
    /**
     * Captures responses to see what data the server returned
     */
    page.on('response', async response => {
      const request = response.request();
      const method = request.method();
      
      if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
        try {
          // Try to capture response body (only for JSON responses)
          const contentType = response.headers()['content-type'] || '';
          let responseBody = null;
          
          if (contentType.includes('application/json')) {
            responseBody = await response.json().catch(() => null);
          }
          
          // Find the corresponding request in our array and add response data
          const requestIndex = session.networkRequests.findIndex(
            req => req.url === request.url() && req.method === method
          );
          
          if (requestIndex !== -1) {
            session.networkRequests[requestIndex].response = {
              status: response.status(),
              statusText: response.statusText(),
              headers: response.headers(),
              body: responseBody,
            };
          }
        } catch (error) {
          // Response body might not be available or parseable
        }
      }
    });
  }
  
  // ============================================================
  // URL/ROUTE CHANGE TRACKING
  // ============================================================
  
  /**
   * Tracks URL changes (page navigations, SPA route changes)
   * Important for understanding user journey through the application
   */
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) {
      const currentUrl = page.url();
      
      if (currentUrl !== previousUrl) {
        const routeData = {
          step: stepNumber,
          timestamp: new Date().toISOString(),
          from: previousUrl || 'initial',
          to: currentUrl,
          path: new URL(currentUrl).pathname,
        };
        
        session.routes.push(routeData);
        log(`Route: ${currentUrl}`, 'ROUTE');
        
        previousUrl = currentUrl;
        stepNumber++;
      }
    }
  });
  
  // ============================================================
  // CLICK RECORDING WITH ENHANCED DATA CAPTURE
  // ============================================================
  
  /**
   * Exposes a function to the browser context to record clicks
   * This function is called from the injected script below
   */
  await page.exposeFunction('recordClick', async (data) => {
    const clickData = {
      step: stepNumber,
      timestamp: new Date().toISOString(),
      ...data
    };
    
    session.clicks.push(clickData);
    
    const clickedItem = data.text || data.selector || 'unknown element';
    log(`${stepNumber}. Clicked: "${clickedItem}"`, 'CLICK');
    
    // Capture screenshot if enabled
    if (config.captureScreenshots) {
      const screenshotDir = 'recordings/screenshots';
      fs.mkdirSync(screenshotDir, { recursive: true });
      const screenshotPath = `${screenshotDir}/step-${stepNumber}.png`;
      await page.screenshot({ path: screenshotPath });
      session.screenshots.push(screenshotPath);
    }
    
    stepNumber++;
  });
  
  /**
   * Exposes a function to record form data when inputs are filled
   * Captures what the user typed into form fields
   */
  await page.exposeFunction('recordFormData', (data) => {
    session.formData.push({
      step: stepNumber,
      timestamp: new Date().toISOString(),
      ...data
    });
    
    log(`Form field "${data.name || data.selector}": "${data.value}"`, 'FORM');
  });
  
  // ============================================================
  // INJECT CLIENT-SIDE RECORDING SCRIPTS
  // ============================================================
  
  /**
   * This script runs in the browser context on every page
   * It sets up event listeners to capture user interactions
   */
  await context.addInitScript(() => {
    // ==========================================================
    // CLICK TRACKING
    // ==========================================================
    
    /**
     * Listens for all click events and records them
     * Captures both the element clicked and contextual information
     */
    document.addEventListener('click', (e) => {
      const target = e.target;
      const selector = getSelector(target);
      
      // Extract all useful information about the clicked element
      window.recordClick({
        selector: selector,
        text: target.innerText?.substring(0, 100) || 
              target.value?.substring(0, 100) ||
              target.getAttribute('placeholder') || 
              target.getAttribute('aria-label') ||
              target.getAttribute('title') ||
              '',
        tagName: target.tagName,
        type: target.type || '',
        id: target.id || '',
        className: target.className || '',
        name: target.name || '',
        href: target.href || '',
        url: window.location.href,
        pathname: window.location.pathname,
        x: e.clientX,
        y: e.clientY,
        // Additional context
        dataAttributes: getDataAttributes(target),
      });
    }, true); // Use capture phase to catch all clicks
    
    // ==========================================================
    // FORM INPUT TRACKING
    // ==========================================================
    
    /**
     * Tracks when users fill out form fields
     * Records the field name and value for test generation
     */
    document.addEventListener('input', (e) => {
      const target = e.target;
      
      // Only track actual form inputs
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        const selector = getSelector(target);
        
        window.recordFormData({
          selector: selector,
          name: target.name || '',
          id: target.id || '',
          type: target.type || target.tagName.toLowerCase(),
          value: target.value,
          placeholder: target.placeholder || '',
          url: window.location.href,
          pathname: window.location.pathname,
        });
      }
    }, true);
    
    // ==========================================================
    // FORM SUBMISSION TRACKING
    // ==========================================================
    
    /**
     * Captures form submissions to record complete form data
     * This gets ALL form fields when the form is submitted
     */
    document.addEventListener('submit', (e) => {
      const form = e.target;
      const formData = new FormData(form);
      const formObject = {};
      
      // Convert FormData to plain object
      for (let [key, value] of formData.entries()) {
        formObject[key] = value;
      }
      
      window.recordFormData({
        type: 'form-submission',
        selector: getSelector(form),
        action: form.action,
        method: form.method,
        data: formObject,
        url: window.location.href,
        pathname: window.location.pathname,
      });
    }, true);
    
    // ==========================================================
    // HELPER FUNCTIONS
    // ==========================================================
    
    /**
     * Generates a unique CSS selector for an element
     * Priority: ID > Name > Class > XPath-like descriptor
     * 
     * @param {HTMLElement} element - The element to generate selector for
     * @returns {string} CSS selector string
     */
    function getSelector(element) {
      // Highest priority: ID (most specific)
      if (element.id) {
        return `#${element.id}`;
      }
      
      // Second priority: Name attribute (common for forms)
      if (element.name) {
        return `[name="${element.name}"]`;
      }
      
      // Third priority: Class names
      if (element.className && typeof element.className === 'string') {
        const classes = element.className.trim().split(/\s+/).join('.');
        if (classes) {
          const selector = `${element.tagName.toLowerCase()}.${classes}`;
          
          // Check if this selector is unique
          if (document.querySelectorAll(selector).length === 1) {
            return selector;
          }
        }
      }
      
      // Fallback: Generate a path-based selector
      let path = element.tagName.toLowerCase();
      
      if (element.parentElement) {
        const siblings = Array.from(element.parentElement.children);
        const index = siblings.indexOf(element);
        
        if (siblings.length > 1) {
          path += `:nth-child(${index + 1})`;
        }
        
        // Add parent context for better specificity
        const parentTag = element.parentElement.tagName.toLowerCase();
        if (parentTag !== 'body') {
          path = `${parentTag} > ${path}`;
        }
      }
      
      return path;
    }
    
    /**
     * Extracts all data-* attributes from an element
     * These are often used by JavaScript frameworks (React, Vue, Alpine, Livewire)
     * 
     * @param {HTMLElement} element - The element to extract data attributes from
     * @returns {Object} Object containing all data attributes
     */
    function getDataAttributes(element) {
      const dataAttrs = {};
      
      if (element.attributes) {
        for (let attr of element.attributes) {
          if (attr.name.startsWith('data-') || 
              attr.name.startsWith('wire:') || 
              attr.name.startsWith('x-') ||
              attr.name.startsWith('v-')) {
            dataAttrs[attr.name] = attr.value;
          }
        }
      }
      
      return dataAttrs;
    }
  });
  
  // ============================================================
  // START RECORDING SESSION
  // ============================================================
  
  log('========================================', 'INFO');
  log('Recording started', 'INFO');
  log(`Navigate to: ${config.startUrl}`, 'INFO');
  log('Click around and fill out forms', 'INFO');
  log('Press Ctrl+C when done', 'INFO');
  log('========================================', 'INFO');
  
  // Navigate to starting URL
  await page.goto(config.startUrl);
  previousUrl = page.url();
  
  // ============================================================
  // KEEP BROWSER OPEN FOR RECORDING
  // ============================================================
  
  // Wait for the specified duration or manual termination
  await page.waitForTimeout(config.maxDuration);
  
  // ============================================================
  // SAVE RECORDING DATA
  // ============================================================
  
  session.metadata.endTime = new Date().toISOString();
  session.metadata.duration = Date.now() - new Date(session.metadata.startTime).getTime();
  
  // Generate filename with timestamp
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const recordingsDir = 'recordings';
  fs.mkdirSync(recordingsDir, { recursive: true });
  
  const filename = path.join(recordingsDir, `session-${timestamp}.json`);
  
  // Write the complete session data to JSON file
  fs.writeFileSync(filename, JSON.stringify(session, null, 2));
  
  // ============================================================
  // GENERATE SUMMARY REPORT
  // ============================================================
  
  log('========================================', 'INFO');
  log(`Recording completed`, 'INFO');
  log(`Duration: ${Math.round(session.metadata.duration / 1000)}s`, 'INFO');
  log(`Total clicks: ${session.clicks.length}`, 'INFO');
  log(`Route changes: ${session.routes.length}`, 'INFO');
  log(`Form interactions: ${session.formData.length}`, 'INFO');
  log(`Network requests: ${session.networkRequests.length}`, 'INFO');
  log(`Saved to: ${filename}`, 'INFO');
  log('========================================', 'INFO');
  
  // ============================================================
  // CLEANUP
  // ============================================================
  
  await browser.close();
  
  // ============================================================
  // NEXT STEPS MESSAGE
  // ============================================================
  
  console.log('\nNext steps:');
  console.log(`   Convert to Playwright tests: npm run convert:playwright ${filename}`);
  console.log(`   Convert to PHPUnit tests: npm run convert:phpunit ${filename}`);
  console.log(`   Replay session: npm run playback ${filename}\n`);
  
})();
