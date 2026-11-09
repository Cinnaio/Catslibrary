import { readSse } from '@shared/sse'
import { parseAiTextProgress, type AiTextProgress } from '@shared/ai-text-progress'

export type AiProgressHandler = (progress: AiTextProgress) => void

export async function readAiResponse(response: Response, onProgress: AiProgressHandler): Promise<{ status: number; data: unknown }> {
  if (!response.headers.get('content-type')?.includes('text/event-stream')) return { status: response.status, data: await response.json().catch(() => ({})) }
  if (!response.body) throw new Error('没有收到流式响应，请检查任务状态后再操作')
  let result: { status: number; data: unknown } | undefined
  await readSse(response.body, (data) => {
    const event = JSON.parse(data)
    if (event.type === 'progress') {
      const progress = parseAiTextProgress(JSON.stringify(event.progress))
      if (progress) onProgress(progress)
    } else if (event.type === 'result' && Number.isInteger(event.status) && event.status >= 200 && event.status <= 599) {
      result = { status: event.status, data: event.data }
      return false
    }
  })
  if (!result) throw new Error('连接已中断，操作可能仍在后台完成，请先检查结果，避免重复生成')
  return result
}
