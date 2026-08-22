/**
 * Frontend half of the mind-the-gap audit.
 *
 * The backend half (FormDbConstraintAuditTest.php, in the Laravel app)
 * introspects the live *server-side* Filament form schema and cross-checks
 * it against real DB column constraints. That catches "the form's PHP rules
 * don't match the DB" — but not "the form's PHP rules are correct, yet the
 * actually-rendered HTML doesn't carry them" (a custom Blade override, a
 * disabled-at-render-time quirk, JS stripping an attribute, etc). This file
 * closes that second gap by reading the REAL rendered DOM.
 *
 * Input: schema.json, produced by `php artisan mind-the-gap:export-schema`
 * in the Laravel app (see Modules/Core/Commands/ExportFormDbSchemaCommand.php)
 * — one entry per Filament resource with its table's real column
 * constraints, unique indexes, and the shared KNOWN_GAPS allowlist.
 *
 * This module is intentionally browser/login-agnostic: it takes an
 * already-authenticated Playwright `page` and does the crawl+compare. The
 * actual Playwright test (tests-playwright/form-db-gaps.spec.js) owns
 * login/navigation lifecycle, consistent with every other generated spec
 * in this project.
 */

const fs = require('fs');

function loadSchema(schemaPath) {
  const raw = fs.readFileSync(schemaPath, 'utf8');
  return JSON.parse(raw);
}

function resourceUrl(baseUrl, resource, tenantSlug) {
  const base = baseUrl.replace(/\/$/, '');

  if (resource.panel === 'admin') {
    return `${base}/admin/${resource.slug}`;
  }

  // Company panel is the tenanted root panel — /<tenant>/<slug>, e.g.
  // /ivplv2/relations. See CLAUDE.md's "Company panel tenant config".
  return `${base}/${tenantSlug}/${resource.slug}`;
}

/**
 * Columns this audit never expects a create-form field for — same
 * exclusion list as the backend audit's checkRequired().
 */
const NON_FORM_COLUMNS = new Set(['id', 'created_at', 'updated_at', 'deleted_at']);

function columnVarcharLength(column) {
  if (column.type_name !== 'varchar') return null;
  const match = /varchar\((\d+)\)/.exec(column.type || '');
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Extracts every top-level data-bound field inside an open Filament form
 * modal. Filament/Livewire renders form inputs with name="data.<field>"
 * (or name="data.<field>[]" for multi-selects) — stripping the "data."
 * prefix gives the same field-name key the backend audit uses. Deeper
 * paths (repeaters, nested relation forms) contain a second dot and are
 * skipped: they don't map 1:1 onto a single table's columns, which is
 * exactly the same "not this audit's concern" boundary the backend audit
 * draws around Repeaters via its collectFields() try/catch.
 *
 * @returns {Promise<Array<{name: string, required: boolean, maxLength: number|null}>>}
 */
async function extractFormFields(dialog) {
  const fields = await dialog.evaluate((dialogEl) => {
    const els = Array.from(dialogEl.querySelectorAll('input[name^="data."], textarea[name^="data."], select[name^="data."]'));
    const out = [];

    for (const el of els) {
      const rawName = el.getAttribute('name') || '';
      const withoutPrefix = rawName.replace(/^data\./, '').replace(/\[\]$/, '');

      // Skip nested paths (repeaters, relation sub-forms) — not a single
      // table's column.
      if (withoutPrefix.includes('.') || withoutPrefix === '') continue;

      if (el.disabled) continue;

      out.push({
        name: withoutPrefix,
        required: el.required || el.getAttribute('aria-required') === 'true',
        maxLength: el.hasAttribute('maxlength') ? parseInt(el.getAttribute('maxlength'), 10) : null,
      });
    }

    return out;
  });

  // De-dupe: some Filament fields render a visible control plus a hidden
  // mirror with the same name (see project memory on searchable Selects).
  // A field counts as satisfying a constraint if ANY rendered copy does.
  const byName = new Map();

  for (const field of fields) {
    const existing = byName.get(field.name);

    if (!existing) {
      byName.set(field.name, field);
      continue;
    }

    byName.set(field.name, {
      name: field.name,
      required: existing.required || field.required,
      maxLength: existing.maxLength ?? field.maxLength,
    });
  }

  return Array.from(byName.values());
}

/**
 * Compares one resource's real rendered form fields against its DB column
 * constraints. Returns a list of human-readable violation strings.
 *
 * @param {Array<{name: string, required: boolean, maxLength: number|null}>} domFields
 * @param {object} resource - one entry from schema.json's `resources` array
 * @param {Record<string, string>} knownGaps
 */
function compareFieldsToSchema(domFields, resource, knownGaps) {
  const violations = [];
  const columnsByName = new Map(resource.columns.map((c) => [c.name, c]));
  const domByName = new Map(domFields.map((f) => [f.name, f]));

  for (const field of domFields) {
    const column = columnsByName.get(field.name);
    if (!column) continue; // not a real column (e.g. a virtual/lookup field)

    const gapKey = `${resource.resourceClass}:${field.name}`;
    if (knownGaps[gapKey]) continue;

    // required
    if (!column.nullable && column.default === null && !column.auto_increment && !NON_FORM_COLUMNS.has(field.name)) {
      if (!field.required) {
        violations.push(`${resource.resourceClass} [${resource.panel}] — rendered field '${field.name}' has no required/aria-required attribute, but DB column '${resource.table}.${field.name}' is NOT NULL with no default.`);
      }
    }

    // maxlength
    const dbLength = columnVarcharLength(column);
    if (dbLength !== null && dbLength < 255) {
      if (field.maxLength === null || field.maxLength > dbLength) {
        violations.push(`${resource.resourceClass} [${resource.panel}] — rendered field '${field.name}' has no maxlength<=${dbLength} attribute, but DB column '${resource.table}.${field.name}' is varchar(${dbLength}).`);
      }
    }
  }

  // Unique indexes: HTML has no native "unique" attribute, so this can't be
  // checked from static DOM inspection the way required/maxlength can — it
  // needs an actual duplicate-value submission (that's what the project's
  // real E2E behavioral tests do, e.g. Modules/Core/Tests/E2E). What this
  // audit CAN do without mutating data: flag a form-editable, uniquely
  // constrained field that isn't even rendered as a form field at all,
  // which would make a duplicate-value E2E test impossible to write.
  for (const index of resource.uniqueIndexes || []) {
    for (const col of index.columns) {
      const gapKey = `${resource.resourceClass}:${col}`;
      if (knownGaps[gapKey]) continue;
      if (!domByName.has(col) && columnsByName.has(col)) {
        violations.push(`${resource.resourceClass} [${resource.panel}] — DB has a unique index on '${resource.table}.${col}', but no rendered form field for it was found to even assert a duplicate-value test against.`);
      }
    }
  }

  return violations;
}

/**
 * Opens a resource's create-form modal from its index page, extracts real
 * rendered field constraints, compares to the DB schema, and closes the
 * modal again. Returns { violations, skippedReason }.
 */
async function auditResource(page, resource, { baseUrl, tenantSlug, createButtonPattern, knownGaps }) {
  const url = resourceUrl(baseUrl, resource, tenantSlug);
  await page.goto(url, { waitUntil: 'domcontentloaded' });

  const createButton = page.getByRole('button', { name: createButtonPattern }).first();

  if (!(await createButton.isVisible({ timeout: 5000 }).catch(() => false))) {
    return { violations: [], skippedReason: 'no create button found (read-only or non-modal resource)' };
  }

  await createButton.click();
  const dialog = page.getByRole('dialog');

  try {
    await dialog.waitFor({ state: 'visible', timeout: 10000 });
  } catch {
    return { violations: [], skippedReason: 'create action did not open a modal dialog' };
  }

  const domFields = await extractFormFields(dialog);
  const violations = compareFieldsToSchema(domFields, resource, knownGaps || {});

  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

  return { violations, skippedReason: null };
}

module.exports = {
  loadSchema,
  resourceUrl,
  extractFormFields,
  compareFieldsToSchema,
  auditResource,
};
