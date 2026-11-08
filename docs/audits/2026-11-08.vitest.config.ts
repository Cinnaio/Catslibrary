import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  root: fileURLToPath(new URL('../../api', import.meta.url)),
  resolve: { alias: { '@shared': fileURLToPath(new URL('../../shared', import.meta.url)) } },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['../docs/audits/2026-11-08-deep-review.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    maxWorkers: 1,
    minWorkers: 1,
  },
})
