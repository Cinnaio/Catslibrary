export interface AgentTextDifference {
  kind: 'equal' | 'changed' | 'added' | 'removed'
  before: string
  after: string
}

const lines = (text: string) => text.match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean) ?? []

/** Preserve every character; bound paragraph alignment work for unusually long chapters. */
export function compareAgentText(before: string, after: string): AgentTextDifference[] {
  const original = lines(before)
  const revised = lines(after)
  let start = 0
  while (start < original.length && start < revised.length && original[start] === revised[start]) start++
  let end = 0
  while (end < original.length - start && end < revised.length - start && original[original.length - end - 1] === revised[revised.length - end - 1]) end++
  const left = original.slice(start, original.length - end)
  const right = revised.slice(start, revised.length - end)
  const result: AgentTextDifference[] = []
  function append(oldText: string, newText: string, equal = false) {
    if (!oldText && !newText) return
    const kind = equal ? 'equal' : oldText ? newText ? 'changed' : 'removed' : 'added'
    result.push({ kind, before: oldText, after: newText })
  }
  append(original.slice(0, start).join(''), revised.slice(0, start).join(''), true)
  const cells = (left.length + 1) * (right.length + 1)
  if (cells > 250_000) {
    append(left.join(''), right.join(''))
  } else {
    const width = right.length + 1
    const lcs = new Uint32Array(cells)
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        lcs[i * width + j] = left[i] === right[j]
          ? 1 + lcs[(i + 1) * width + j + 1]!
          : Math.max(lcs[(i + 1) * width + j]!, lcs[i * width + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    let oldText = ''
    let newText = ''
    let unchanged = ''
    function flushChange() {
      append(oldText, newText)
      oldText = ''
      newText = ''
    }
    function flushEqual() {
      append(unchanged, unchanged, true)
      unchanged = ''
    }
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        flushChange()
        unchanged += left[i++]!
        j++
      } else {
        flushEqual()
        if (i < left.length && (j === right.length || lcs[(i + 1) * width + j]! >= lcs[i * width + j + 1]!)) oldText += left[i++]!
        else newText += right[j++]!
      }
    }
    flushChange()
    flushEqual()
  }
  append(original.slice(original.length - end).join(''), revised.slice(revised.length - end).join(''), true)
  return result
}
