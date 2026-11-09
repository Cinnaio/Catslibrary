import type { AiTextProgress } from '@shared/ai-text-progress'
import type { Db } from '../../db/pool'
import { AiError, type AiChatProgress } from './client'
import { updateAiTask } from './tasks'
import { publishAiTask } from './task-events'

/** Keep live previews separate from saved drafts/archives; never persist raw reasoning. */
export function createTextProgressReporter(db: Db, taskId?: string, options: { round?: number; previewLimit?: number } = {}) {
  const startedAt = Date.now()
  let firstContentMs: number | null = null
  let firstReasoningMs: number | null = null
  let lastWrite = -Infinity
  let lastPublish = -Infinity
  const state: AiTextProgress = { kind: 'text-progress', phase: 'thinking', preview: '', generatedCharacters: 0, reasoningCharacters: 0, startedAt, updatedAt: startedAt, ...(options.round !== undefined ? { round: options.round } : {}) }
  async function flush(force = false) {
    if (!taskId) return
    state.updatedAt = Date.now()
    const step = state.phase === 'thinking' ? `模型思考中 · 已生成 ${state.reasoningCharacters} 个思考字符，尚未输出正文` : `正文生成中 · 已收到 ${state.generatedCharacters} 个字符`
    if (force || Date.now() - lastPublish >= 80) {
      lastPublish = Date.now()
      publishAiTask(taskId, { step, result: JSON.stringify(state) })
    }
    if (!force && Date.now() - lastWrite < 1000) return
    lastWrite = Date.now()
    if (!await updateAiTask(db, taskId, { step, result: JSON.stringify(state) })) throw new AiError('cancelled', '任务已停止，未保存未完成内容', 409)
  }
  return {
    async start() {
      if (taskId && !await updateAiTask(db, taskId, { result: '', step: '等待模型响应' })) throw new AiError('cancelled', '任务已停止', 409)
    },
    async onProgress(progress: AiChatProgress) {
      state.phase = progress.phase
      state.reasoningCharacters = progress.reasoningCharacters
      if (progress.phase === 'thinking') {
        if (firstReasoningMs === null) firstReasoningMs = Date.now() - startedAt
        await flush()
      }
    },
    async onDelta(delta: string) {
      if (!delta) return
      if (firstContentMs === null) firstContentMs = Date.now() - startedAt
      state.phase = 'writing'
      state.generatedCharacters += delta.length
      state.preview = (state.preview + delta).slice(-Math.min(24000, Math.max(4000, options.previewLimit || 4000)))
      await flush()
    },
    flush,
    metrics: () => ({ durationMs: Date.now() - startedAt, firstContentMs, firstReasoningMs, outputCharacters: state.generatedCharacters }),
  }
}
