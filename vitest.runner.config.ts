import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Конфигурация прогонщика подбора колец: node-окружение без jsdom, роняет
 * серверные экшены через мок админ-сессии (см. ring-match.runner.ts).
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['__tests__/unit/lib/ring-match.runner.ts'],
    testTimeout: 5_400_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'server-only': path.resolve(__dirname, './__tests__/mocks/server-only.ts'),
    },
  },
})
