import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import prettierConfig from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'public',
      '.unit-test-dist',
      'src-tauri/target',
      'src-tauri/build',
      'src-tauri/dist',
      'src-tauri/bin',
      'src-tauri/.venv',
    ],
  },
  // Node-side tooling: build scripts, the sidecar builder, and the node --test suites.
  // These were previously unlinted because the only config block matched *.{ts,tsx}.
  {
    extends: [js.configs.recommended],
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      globals: { ...globals.node },
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'react-hooks/preserve-manual-memoization': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  // Layering: pure modules (document model, commands, scene, CDXML, geometry, SVG) must stay
  // runnable headless. They may not reach up into the store or into UI frameworks.
  {
    files: ['src/{lib,editor,utils,types}/**/*.ts'],
    ignores: [
      // Store-bound adapters: these are the sanctioned bridge from pure code to live state.
      'src/lib/svgExportFromStore.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/store', '**/store/*'],
              message: 'Pure layers must not import the store; take state as an argument.',
            },
            {
              group: ['react', 'react-dom', 'react-konva', 'konva', 'zustand'],
              message: 'Pure layers must not depend on UI frameworks.',
            },
          ],
        },
      ],
    },
  },
  prettierConfig,
);
