import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import svelte from 'eslint-plugin-svelte';
import globals from 'globals';
import ts from 'typescript-eslint';

// Code rules; layout is Prettier's (.prettierrc), which eslint-config-prettier keeps out of ESLint
export default ts.config(
  { ignores: ['build/', '.svelte-kit/', 'node_modules/', 'data/', 'docs/legacy/'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } }
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: { parserOptions: { parser: ts.parser, extraFileExtensions: ['.svelte'] } }
  },
  {
    rules: {
      // a leading underscore marks a value that's deliberately unused, eg. a key left out of a copy
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_' }
      ],
      // links only need resolve() under a base path, and the app is served at /
      'svelte/no-navigation-without-resolve': 'off',
      // also flags short-lived locals, eg. a query string built and sent at once; state is $state
      'svelte/prefer-svelte-reactivity': 'off',
      // {' '} keeps a space between an element and the text after it
      'svelte/no-useless-mustaches': 'off'
    }
  },
  {
    // tests and the fake CHT hold CHT's untyped docs
    files: ['**/*.spec.ts', 'src/lib/server/testing/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' }
  },
  {
    // the CommonJS script cht-conf jobs run
    files: ['**/*.cjs'],
    rules: { '@typescript-eslint/no-require-imports': 'off' }
  }
);
