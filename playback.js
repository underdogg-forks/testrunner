const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const recordingFile = process.argv[2] || 'recordings/clicks-latest.json';
  const clicks = JSON.parse(fs.readFileSync(recordingFile, 'utf8'));
  
  const browser = await chromium.launch({ headless: false, slowMo: 500 });
  const page = await browser.newPage();
  
  console.log(`Playing back ${clicks.length} clicks...\n`);
  
  let currentUrl = '';
  
  for (const click of clicks) {
    // Navigate if URL changed
    if (click.url !== currentUrl) {
      console.log(`Navigating to: ${click.url}`);
      await page.goto(click.url);
      currentUrl = click.url;
      await page.waitForLoadState('networkidle');
    }
    
    // Click the element
    try {
      console.log(`${click.step}. Clicking: "${click.text || click.selector}"`);
      await page.click(click.selector);
      await page.waitForTimeout(1000); // Pause between clicks
    } catch (error) {
      console.log(`Could not click: ${error.message}`);
    }
  }
  
  console.log('\nPlayback completed!');
  await page.waitForTimeout(3000);
  await browser.close();
})();
