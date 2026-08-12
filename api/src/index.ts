import { serve } from '@hono/node-server'
import { app } from './app'
import { loadConfig } from './config'
import { migrate } from './db/migrate'
import { ensureRuntimeSalts } from './runtime-config'

async function start() {
  // 会话/IP 哈希盐：缺失或为弱默认值时生成随机盐并持久化，须在处理任何请求前完成
  ensureRuntimeSalts()
  const config = loadConfig()

  if (config.configured) {
    const applied = await migrate({ keepPoolOpen: true })
    if (applied.length) console.log(`[zhi-zhou api] applied migrations: ${applied.join(', ')}`)
  }

  const server = serve({ fetch: app.fetch, port: config.port })
  console.log(
    `[zhi-zhou api] listening on http://127.0.0.1:${config.port}  (db: ${config.configured ? 'configured' : 'needsSetup'})`,
  )

  function shutdown() {
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch((err) => {
  console.error('[zhi-zhou api] startup failed:', err)
  process.exitCode = 1
})
