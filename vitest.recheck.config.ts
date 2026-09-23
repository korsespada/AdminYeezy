import { defineConfig } from 'vitest/config'
import path from 'path'

/** Конфигурация строгой перепроверки применённых пар. */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/unit/lib/ring-recheck.runner.ts'],
    testTimeout: 5_400_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'server-only': path.resolve(__dirname, './__tests__/mocks/server-only.ts'),
    },
  },
})
