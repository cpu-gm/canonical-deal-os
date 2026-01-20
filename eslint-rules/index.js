/**
 * Custom ESLint rules for security enforcement
 *
 * Usage in .eslintrc.js:
 *
 * module.exports = {
 *   plugins: ['./eslint-rules'],
 *   rules: {
 *     'local/no-unsafe-headers': 'error',
 *     'local/require-org-isolation': 'warn'
 *   }
 * };
 */

module.exports = {
  rules: {
    'no-unsafe-headers': require('./no-unsafe-headers'),
    'require-org-isolation': require('./require-org-isolation')
  }
};
