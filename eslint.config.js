const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  {
    ignores: ['dist-chrome/**', 'dist-edge/**', 'node_modules/**', 'src/config/config.js']
  },
  js.configs.recommended,
  // Extension sources bundled by webpack (ES modules).
  {
    files: ['src/**/*.js'],
    ignores: ['src/lib/**'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
        ...globals.webextensions,
        chrome: 'readonly'
      }
    },
    rules: {
      'indent': ['error', 2],
      'linebreak-style': ['error', 'unix'],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'caughtErrors': 'none' }],
      'prefer-const': 'error',
      'no-var': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      'no-console': 'off'
    }
  },
  // Content-script modules ported from the Safari extension: plain scripts
  // (IIFEs exporting globals, copied unbundled), ES5 style, no semicolons.
  // Correctness rules only — restyling them would bury real diffs.
  {
    files: ['src/lib/**/*.js'],
    ignores: ['src/lib/tests/**'],
    languageOptions: {
      ecmaVersion: 2021,
      sourceType: 'script',
      globals: { ...globals.browser, ...globals.serviceworker, chrome: 'readonly', browser: 'readonly' }
    },
    rules: {
      'no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'caughtErrors': 'none' }]
    }
  },
  // node:test suites for the lib modules.
  {
    files: ['src/lib/tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    }
  },
  // Build tooling.
  {
    files: ['*.js', 'scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node }
    },
    rules: {
      'no-unused-vars': ['error', { 'argsIgnorePattern': '^_', 'caughtErrors': 'none' }]
    }
  }
];
