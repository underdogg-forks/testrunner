const fs = require('fs');
const path = require('path');

const roots = ['tests-playwright', 'tests/Feature'];
const weakPatterns = [
  /expect\(response\.ok\(\)\)\.toBeTruthy\(\)/,
  /expect\(response\.status\(\)\)\.toBe\(200\)/,
  /assertStatus\(200\)/,
  /toBeVisible\(\);/,
  /waitForLoadState\('networkidle'\)/,
];

function walk(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const item of fs.readdirSync(dir)) {
    const full = path.join(dir, item);
    const st = fs.statSync(full);
    if (st.isDirectory()) walk(full, files);
    else if (/\.(spec\.js|php)$/.test(item)) files.push(full);
  }
  return files;
}

const findings = [];
for (const root of roots) {
  for (const file of walk(root)) {
    const content = fs.readFileSync(file, 'utf8');
    for (const pattern of weakPatterns) {
      if (pattern.test(content)) findings.push({ file, pattern: pattern.toString() });
    }

    const hasAction = /(click\(|fill\(|post\(|put\(|delete\()/i.test(content);
    const hasOutcome = /(toHaveURL\(|assertRedirect\(|assertForbidden\(|assertSessionHasErrors\(|assertSessionHasNoErrors)/.test(content);
    const hasState = /(toContainText\(|assertDatabaseHas\(|assertDatabaseMissing\(|assertSessionHas\()/.test(content);
    if (!(hasAction && hasOutcome && hasState)) {
      findings.push({ file, pattern: 'missing action→outcome→state checkpoint' });
    }
  }
}

if (findings.length) {
  console.error('Behavioral audit failed:');
  for (const f of findings) console.error(`- ${f.file}: ${f.pattern}`);
  process.exit(1);
}

console.log('Behavioral audit passed.');
