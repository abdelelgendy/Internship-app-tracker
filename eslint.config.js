import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // docs/day-one keeps Abdel's first app exactly as he wrote it, so it is not linted.
  globalIgnores(['dist', 'coverage', 'output', 'playwright-report', 'test-results', '.private', 'docs/day-one']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023 },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended, reactRefresh.configs.vite],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**/*.ts', 'server/**/*.ts', 'vite.config.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // The engine is imported by the UI and by Node scripts, so it stays pure TypeScript.
    files: ['src/engine/**/*.ts'],
    ignores: ['src/engine/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-*',
                'react/*',
                '@dnd-kit/*',
                'node:*',
                'fs',
                'fs/*',
                'path',
                'os',
                'child_process',
                'yaml',
                '@anthropic-ai/*',
                'playwright',
                '@/*',
                '**/ui/**',
                '**/features/**',
                '**/app/**',
                '**/data/**',
              ],
              message:
                'src/engine is pure TypeScript shared by the UI and Node scripts: no React, Node APIs, packages or imports from outside src/engine.',
            },
          ],
        },
      ],
    },
  },
])
