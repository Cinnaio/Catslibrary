/** Shared UTF-8 / CRLF / multiline SSE framing for upstream and browser streams. */
export async function readSse(body: ReadableStream<Uint8Array>, onData: (data: string) => void | boolean | Promise<void | boolean>): Promise<void> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let lines: string[] = []
  let size = 0
  let stopped = false
  const dispatch = async () => {
    if (lines.length && (await onData(lines.join('\n'))) === false) stopped = true
    lines = []
    size = 0
  }
  const line = async (value: string) => {
    if (!value) return dispatch()
    if (!value.startsWith('data:')) return
    const data = value.slice(5).replace(/^ /, '')
    size += data.length
    if (size > 2_000_000) throw new Error('流式事件过大')
    lines.push(data)
  }
  try {
    while (!stopped) {
      const chunk = await reader.read()
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true })
      let match: RegExpExecArray | null
      while (!stopped && (match = /\r\n|\r(?!$)|\n/.exec(buffer))) {
        const value = buffer.slice(0, match.index)
        buffer = buffer.slice(match.index + match[0].length)
        await line(value)
      }
      if (buffer.length > 2_000_000) throw new Error('流式事件过大')
      if (chunk.done) {
        if (buffer) await line(buffer.replace(/\r$/, ''))
        if (!stopped) await dispatch()
        break
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
