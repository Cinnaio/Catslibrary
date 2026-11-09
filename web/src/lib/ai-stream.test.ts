import { describe, expect, it, vi } from 'vitest'
import { readAiResponse } from './ai-stream'

const frame = (event: unknown) => `data: ${JSON.stringify(event)}\n\n`
describe('AI browser response', () => {
  it('shows valid progress then returns the final status, without exposing raw reasoning', async () => {
    const progress = { kind: 'text-progress', phase: 'writing', preview: '片段', generatedCharacters: 2, reasoningCharacters: 4, startedAt: 1, updatedAt: 2 }
    const onProgress = vi.fn()
    const response = new Response(frame({ type: 'progress', progress }) + frame({ type: 'result', status: 422, data: { error: '结果未通过校验' } }), {
      headers: { 'content-type': 'text/event-stream' },
    })
    expect(await readAiResponse(response, onProgress)).toEqual({ status: 422, data: { error: '结果未通过校验' } })
    expect(onProgress).toHaveBeenCalledExactlyOnceWith(progress)
  })
  it('accepts old JSON servers without manufacturing partial data', async () => {
    const callback = vi.fn()
    expect(await readAiResponse(Response.json({ recap: '完整回顾' }), callback)).toEqual({ status: 200, data: { recap: '完整回顾' } })
    expect(callback).not.toHaveBeenCalled()
  })
  it('never treats EOF as a completed operation or replays a request', async () => {
    const response = new Response(frame({ type: 'heartbeat' }), { headers: { 'content-type': 'text/event-stream' } })
    await expect(readAiResponse(response, vi.fn())).rejects.toThrow('避免重复生成')
  })
})
