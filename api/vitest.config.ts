import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    // shared/ 下的纯逻辑测试也在此执行。该目录不属于任何 workspace，默认不会被
    // 拾取——新增的 shared/*.test.ts 会静默不跑，等于没有测试。
    // 放在 api 侧：它已配置 @shared 别名，且是 node 环境（shared 是纯函数，无 DOM 依赖）。
    include: ['src/**/*.test.ts', '../shared/**/*.test.ts'],
  },
})
