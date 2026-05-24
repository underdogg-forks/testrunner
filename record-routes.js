const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  
  const clicks = [];
  let stepNumber = 1;
  
  // Setup logging directory
  const logDir = 'storage/logs';
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, 'console.log');
  
  // Helper function to log to file
  function log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(logFile, logMessage);
    console.log(message);
  }

  // Clear previous log
  fs.writeFileSync(logFile, '');

  // Record all clicks
  await page.exposeFunction('recordClick', (data) => {
    clicks.push({
      step: stepNumber,
      timestamp: new Date().toISOString(),
      ...data
    });
    
    // Generalized logging - just what was clicked
    const clickedItem = data.text || data.selector || 'unknown element';
    log(`${stepNumber}. Clicked: "${clickedItem}"`);
    stepNumber++;
  });

  // Inject click listener into every page
  await context.addInitScript(() => {
    document.addEventListener('click', (e) => {
      const target = e.target;
      const selector = getSelector(target);
      
      window.recordClick({
        selector: selector,
        text: target.innerText?.substring(0, 50) || target.getAttribute('placeholder') || target.getAttribute('aria-label'),
        tagName: target.tagName,
        url: window.location.href,
        x: e.clientX,
        y: e.clientY
      });
    }, true);

    function getSelector(element) {
      if (element.id) return `#${element.id}`;
      if (element.className && typeof element.className === 'string') {
        const classes = element.className.trim().split(/\s+/).join('.');
        if (classes) return `${element.tagName.toLowerCase()}.${classes}`;
      }
      // Fallback to xpath-like description
      let path = element.tagName.toLowerCase();
      if (element.parentElement) {
        const siblings = Array.from(element.parentElement.children);
        const index = siblings.indexOf(element);
        if (siblings.length > 1) path += `[${index}]`;
      }
      return path;
    }
  });

  log('Recording started');

  // Navigate to starting URL
  await page.goto(process.env.APP_URL || process.env.START_URL || 'http://localhost:3000');

  // Keep browser open and wait for manual closure
  await page.waitForTimeout(300000); // 5 minutes, adjust as needed

  // Save recording
  const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
  const filename = `recordings/clicks-${timestamp}.json`;
  
  fs.mkdirSync('recordings', { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(clicks, null, 2));
  
  log(`Recording completed - ${clicks.length} actions recorded`);
  log(`Saved to: ${filename}`);

  await browser.close();
})();
