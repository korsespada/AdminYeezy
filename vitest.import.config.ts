import { defineConfig } from 'vitest/config'
import path from 'path'

/** Конфигурация импортёра оставшихся колец David. */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/unit/lib/david-import.runner.ts'],
    testTimeout: 5_400_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'server-only': path.resolve(__dirname, './__tests__/mocks/server-only.ts'),
    },
  },
})
