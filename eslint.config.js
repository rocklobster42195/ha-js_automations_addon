'use strict';

const js = require('@eslint/js');
const globals = require('globals');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      '.claude/**',
      'scripts/**',
      'js_automations_beta/**',
      'js_automations/public/js/vendor/**',
      'js_automations/public/js/dist/**',
      'js_automations/locales/**',
      'docs/**',
      'notes/**',
      'examples/**',
    ],
  },
  js.configs.recommended,
  {
    files: [
      'eslint.config.js',
      'js_automations/server.js',
      'js_automations/core/**/*.js',
      'js_automations/routes/**/*.js',
      'js_automations/services/**/*.js',
      'tools/**/*.js',
      'test/**/*.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // catch(e) without using e is a deliberate, common pattern in this codebase
      'no-unused-vars': ['error', { caughtErrors: 'none' }],
    },
  },
  {
    // Classic global <script> files (js_automations/public/index.html) — functions/vars
    // declared here are consumed as globals by other files in the same set, by design.
    // See docs/RFC_FRONTEND_MODERNIZATION.md section 11 (~80 window.* globals, inventoried
    // ahead of the LIT migration rather than fixed here).
    files: ['js_automations/public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        io: 'readonly',
        i18next: 'readonly',
        i18nextHttpBackend: 'readonly',
        monaco: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': ['warn', { caughtErrors: 'none' }],
    },
  },
  prettierConfig,
];
