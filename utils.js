/**
 * Shared utility functions for test generation and playback
 */

/**
 * Builds a chronological timeline of all events from a session
 * @param {Object} session - The recorded session object
 * @returns {Array} Sorted array of all events
 */
function buildTimeline(session) {
  const timeline = [];
  
  // Add all routes
  if (session.routes) {
    session.routes.forEach(route => {
      timeline.push({ type: 'route', ...route });
    });
  }
  
  // Add all clicks
  if (session.clicks) {
    session.clicks.forEach(click => {
      timeline.push({ type: 'click', ...click });
    });
  }
  
  // Add all form data
  if (session.formData) {
    session.formData.forEach(form => {
      timeline.push({ type: 'formData', data: form, timestamp: form.timestamp });
    });
  }
  
  // Add network requests
  if (session.networkRequests) {
    session.networkRequests.forEach(req => {
      timeline.push({ type: 'network', ...req });
    });
  }
  
  // Sort by timestamp
  timeline.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  return timeline;
}

/**
 * Escapes special characters in CSS selectors
 * @param {string} selector - CSS selector to escape
 * @returns {string} Escaped selector
 */
function escapeSelector(selector) {
  return selector.replace(/'/g, "\\'");
}

/**
 * Escapes special characters in form values
 * @param {*} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeValue(value) {
  return String(value).replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

/**
 * Sanitizes a path to create a valid PHP method name
 * @param {string} path - URL path to sanitize
 * @returns {string} Valid PHP method name
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
 * @param {string} str - String to escape
 * @returns {string} Escaped PHP string
 */
function escapePhpString(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Escapes and formats values for PHP
 * @param {*} value - Value to format
 * @returns {string} PHP-formatted value
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
  const escapedValue = escapePhpString(value);
  return `'${escapedValue}'`;
}

module.exports = {
  buildTimeline,
  escapeSelector,
  escapeValue,
  sanitizeMethodName,
  escapePhpString,
  escapePhpValue
};
