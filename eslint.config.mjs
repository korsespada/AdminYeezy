import { defineConfig, globalIgnores } from 'eslint/config'
import nextVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

export default defineConfig([
  ...nextVitals,
  ...nextTypescript,
  globalIgnores([
    '.next/**',
    'node_modules/**',
    // Локальное окружение Python (torch и т.п.) содержит vendored .mjs,
    // которые не относятся к коду проекта и ломали npm run lint.
    '.venv/**',
    'adminpro/**',
    '.adminpro-ref/**',
    '__tests__/**',
    'scripts/**',
    'scratch/**',
    'tmp/**',
    'inspect_db.js',
    'check-brand-fields.mjs',
    'tsconfig.tsbuildinfo',
  ]),
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      'prefer-const': 'off',
      'react/no-unescaped-entities': 'off',
      'react-hooks/error-boundaries': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/static-components': 'off',
    },
  },
])
