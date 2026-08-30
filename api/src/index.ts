import { serve } from '@hono/node-server'
import { app } from './app'
import { loadConfig } from './config'
import { migrate } from './db/migrate'
import { getDb } from './db/pool'
import { getAiSettings } from './services/ai/settings'
import { AI_TASK_RECLAIM_INTERVAL_MS, failInterruptedAiTasks, listAiTasks, pruneFinishedAiTasks, reclaimStaleAiTasks, updateAiTask } from './services/ai/tasks'
import { generateCoverPromptTask } from './services/ai/cover'
import { ensureRuntimeSalts } from './runtime-config'
import { pruneMobileTelemetry } from './routes/mobile-telemetry'
import { pruneAdminOperationAudit } from './services/admin-operation-audit'

async function resumeInterruptedCoverPromptTasks() {
  const db = getDb()
  const { items } = await listAiTasks(db, { kind: 'cover_prompt', limit: 100, offset: 0 })
  const interrupted = items.filter((task) => task.status === 'queued' || task.status === 'running')
  let resumed = 0
  for (const task of interrupted) {
    let params: Record<string, any> | null = null
    try {
      params = task.params ? (JSON.parse(task.params) as Record<string, any>) : null
    } catch {
      params = null
    }
    const novelId = String(params?.novelId || task.novelId || '').trim()
    if (!params || !novelId) {
      await updateAiTask(db, task.id, { status: 'failed', step: '已中断', error: '任务缺少原始参数，无法恢复' })
      continue
    }
    resumed += 1
    void generateCoverPromptTask(db, {
      userId: task.userId,
      novelId,
      renderTitle: typeof params.renderTitle === 'boolean' ? params.renderTitle : true,
      platform: typeof params.platform === 'string' && params.platform ? params.platform : 'default',
      stylePreset: typeof params.stylePreset === 'string' && params.stylePreset ? params.stylePreset : 'auto',
      composition: typeof params.composition === 'string' && params.composition ? params.composition : 'auto',
      variationId: typeof params.variationId === 'string' ? params.variationId : '',
      taskId: task.id,
    })
  }
  return resumed
}

async function start() {
  // 会话/IP 哈希盐：缺失或为弱默认值时生成随机盐并持久化，须在处理任何请求前完成
  ensureRuntimeSalts()
  const config = loadConfig()

  if (config.configured) {
    const applied = await migrate({ keepPoolOpen: true })
    if (applied.length) console.log(`[zhi-zhou api] applied migrations: ${applied.join(', ')}`)
    const reclaimed = await reclaimStaleAiTasks(getDb())
    if (reclaimed) console.log(`[zhi-zhou api] reclaimed ${reclaimed} stale AI task(s)`)
    // 提示词任务参数和结果可持久化，服务重启后自动接管；有副作用的图片/写作任务仍标记失败，交给管理员确认后重试。
    const interrupted = await failInterruptedAiTasks(getDb(), { excludeKinds: ['cover_prompt'] })
    if (interrupted) console.log('[zhi-zhou api] marked ' + interrupted + ' interrupted AI task(s) as failed')
    const resumed = await resumeInterruptedCoverPromptTasks()
    if (resumed) console.log('[zhi-zhou api] resumed ' + resumed + ' interrupted cover prompt task(s)')
    // 已结束任务按保留期清理（天数在管理端「参数调优」可配）
    const settings = await getAiSettings(getDb())
    const pruned = await pruneFinishedAiTasks(getDb(), settings.taskRetentionDays)
    if (pruned) console.log(`[zhi-zhou api] pruned ${pruned} finished AI task(s) older than ${settings.taskRetentionDays}d`)
    const prunedTelemetry = await pruneMobileTelemetry()
    if (prunedTelemetry) console.log(`[zhi-zhou api] pruned ${prunedTelemetry} mobile telemetry event(s) older than 90d`)
    const prunedAdminOperations = await pruneAdminOperationAudit(getDb())
    if (prunedAdminOperations) console.log(`[zhi-zhou api] pruned ${prunedAdminOperations} admin operation audit record(s) older than 180d`)
  }

  const server = serve({ fetch: app.fetch, port: config.port })
  const aiTaskReclaimTimer = config.configured
    ? setInterval(() => {
        void reclaimStaleAiTasks(getDb()).then((reclaimed) => {
          if (reclaimed) console.log(`[zhi-zhou api] reclaimed ${reclaimed} stale AI task(s)`)
        }).catch((err) => console.error('[zhi-zhou api] AI task reclaim failed:', err))
      }, AI_TASK_RECLAIM_INTERVAL_MS)
    : undefined
  aiTaskReclaimTimer?.unref?.()
  console.log(
    `[zhi-zhou api] listening on http://127.0.0.1:${config.port}  (db: ${config.configured ? 'configured' : 'needsSetup'})`,
  )

  function shutdown() {
    if (aiTaskReclaimTimer) clearInterval(aiTaskReclaimTimer)
    server.close(() => process.exit(0))
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

start().catch((err) => {
  console.error('[zhi-zhou api] startup failed:', err)
  process.exitCode = 1
})
