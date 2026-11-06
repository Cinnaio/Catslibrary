import { defineConfig } from 'tsup'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  entry: { index: 'src/index.ts', 'recover-super-admin': 'scripts/recover-super-admin.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  outDir: 'dist',
  sourcemap: true,
  clean: true,
  // The deploy workflow ships dist only; include this pure JS decoder in the artifact.
  noExternal: ['entities'],
  alias: {
    '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
  },
})
