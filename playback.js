const { chromium } = require('playwright');
const fs = require('fs');
const { buildTimeline } = require('./utils');

/**
 * Playback recorded sessions
 * Supports both legacy format (array of clicks) and new format (session object)
 */
(async () => {
  const recordingFile = process.argv[2];
  
  if (!recordingFile) {
    console.error('❌ Error: Please provide a recording file');
    console.log('\nUsage: npm run playback recordings/session-[timestamp].json');
    process.exit(1);
  }
  
  if (!fs.existsSync(recordingFile)) {
    console.error(`❌ Error: Recording file not found: ${recordingFile}`);
    process.exit(1);
  }
  
  const recording = JSON.parse(fs.readFileSync(recordingFile, 'utf8'));
  
  // Detect format: legacy (array) or new (session object)
  const isLegacyFormat = Array.isArray(recording);
  
  let events = [];
  let startUrl = '';
  
  if (isLegacyFormat) {
    // Legacy format: array of clicks
    events = recording;
    startUrl = recording[0]?.url || 'http://localhost:3000';
    console.log('📼 Playing back legacy format recording...\n');
  } else {
    // New format: session object with timeline
    startUrl = recording.metadata.startUrl;
    
    // Build timeline from session using shared utility
    events = buildTimeline(recording);
    
    console.log('📼 Playing back advanced recording...\n');
    console.log(`Recording from: ${recording.metadata.startTime}`);
    console.log(`Duration: ${Math.round(recording.metadata.duration / 1000)}s`);
    console.log(`Events: ${events.length}\n`);
  }
  
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const page = await browser.newPage();
  
  let currentUrl = '';
  let stepNumber = 1;
  
  // Navigate to start URL
  console.log(`Navigating to: ${startUrl}`);
  await page.goto(startUrl);
  currentUrl = startUrl;
  await page.waitForLoadState('networkidle');
  
  for (const event of events) {
    if (isLegacyFormat) {
      // Legacy format handling
      if (event.url !== currentUrl) {
        console.log(`${stepNumber}. Navigating to: ${event.url}`);
        await page.goto(event.url);
        currentUrl = event.url;
        await page.waitForLoadState('networkidle');
      }
      
      try {
        console.log(`${stepNumber}. Clicking: "${event.text || event.selector}"`);
        await page.click(event.selector);
        await page.waitForTimeout(1000);
      } catch (error) {
        console.log(`   ⚠️  Could not click: ${error.message}`);
      }
      
      stepNumber++;
    } else {
      // New format handling
      try {
        switch (event.type) {
          case 'route':
            if (event.to !== currentUrl) {
              console.log(`${stepNumber}. Navigating to: ${event.to}`);
              await page.goto(event.to);
              currentUrl = event.to;
              await page.waitForLoadState('networkidle');
              stepNumber++;
            }
            break;
            
          case 'click':
            console.log(`${stepNumber}. Clicking: "${event.text || event.selector}"`);
            const element = page.locator(event.selector).first();
            await element.waitFor({ state: 'visible', timeout: 5000 });
            await element.click();
            await page.waitForTimeout(1000);
            stepNumber++;
            break;
            
          case 'formData':
            if (event.data.type === 'form-submission') {
              console.log(`${stepNumber}. Submitting form`);
              // The form should already be filled from input events
              await page.click('button[type="submit"], input[type="submit"]');
              await page.waitForLoadState('networkidle');
            } else {
              console.log(`${stepNumber}. Filling field "${event.data.name || event.data.selector}"`);
              await page.locator(event.data.selector).fill(event.data.value || '');
            }
            stepNumber++;
            break;
        }
      } catch (error) {
        console.log(`   ⚠️  Error: ${error.message}`);
        stepNumber++;
      }
    }
  }
  
  console.log('\n✅ Playback completed!');
  await page.waitForTimeout(3000);
  await browser.close();
})();
