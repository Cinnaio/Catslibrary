import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

const sharedDir = fileURLToPath(new URL('../shared', import.meta.url))
const srcDir = fileURLToPath(new URL('./src', import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
        changeOrigin: true,
      },
    },
  },
})
