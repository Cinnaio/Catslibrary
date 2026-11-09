import { describe, expect, it } from 'vitest'
import { readSse } from './sse'

describe('SSE framing', () => {
  it('preserves split UTF-8, CRLF, comments and multiline data', async () => {
    const bytes = new TextEncoder().encode(': heartbeat\r\ndata: {\r\ndata: "text":"中文🙂"\r\ndata: }\r\n\r\ndata: last\r\n\r\n')
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (const byte of bytes) c.enqueue(Uint8Array.of(byte))
        c.close()
      },
    })
    const events: string[] = []
    await readSse(body, (value) => {
      events.push(value)
    })
    expect(events).toEqual(['{\n"text":"中文🙂"\n}', 'last'])
    expect(JSON.parse(events[0]!)).toEqual({ text: '中文🙂' })
  })
  it('stops and releases a subscription without consuming later events', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(new TextEncoder().encode('data: first\n\ndata: second\n\n'))
      },
      cancel() {
        cancelled = true
      },
    })
    const values: string[] = []
    await readSse(body, (value) => {
      values.push(value)
      return false
    })
    expect(values).toEqual(['first'])
    expect(cancelled).toBe(true)
    expect(body.locked).toBe(false)
  })
})
