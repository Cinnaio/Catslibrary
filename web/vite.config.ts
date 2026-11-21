import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const sharedDir = fileURLToPath(new URL('../shared', import.meta.url))
const srcDir = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'ios-font-downloads',
      apply: 'build',
      async buildStart() {
        // Keep the download paths and bytes expected by installed iOS clients.
        for (const file of ['NotoSerifSC-Regular.otf', 'NotoSerifSC-Bold.otf', 'LICENSE-OFL.txt']) {
          const source = await readFile(new URL(`../ios/font-dist/${file}`, import.meta.url))
          this.emitFile({ type: 'asset', fileName: `fonts/${file}`, source })
        }
      },
    },
  ],
  resolve: {
    alias: {
      '@shared': sharedDir,
      '@': srcDir,
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    // 本地开发：/api 代理到自托管 API（默认 8787，与 .env.example 一致）
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:8787',
        // 保留浏览器访问的 Host，使后端同源 CSRF 校验与 Origin 一致。
        changeOrigin: false,
      },
    },
  },
})
