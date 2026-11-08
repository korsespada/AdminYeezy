import { configDefaults, defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    globals: true,
    // .claude/worktrees содержит отдельные рабочие копии репозитория, а tmp/ —
    // локальную песочницу: их устаревшие тесты не должны попадать в прогон.
    exclude: [...configDefaults.exclude, '.claude/**', 'tmp/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './'),
      'server-only': path.resolve(__dirname, './__tests__/mocks/server-only.ts'),
    },
  },
})
