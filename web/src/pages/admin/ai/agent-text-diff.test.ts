import { describe, expect, it } from 'vitest'
import { compareAgentText } from './agent-text-diff'

describe('Agent text comparison', () => {
  it.each([
    ['', ''],
    ['', '新增一段。\n'],
    ['移除一段。\n', ''],
    ['共同开头。\n旧段落。\n共同结尾。', '共同开头。\n新段落。\n共同结尾。'],
    ['重复\n重复\n末尾', '重复\n新增\n重复\n末尾'],
    ['第一段\r\n\r\n第二段\n', '第一段\r\n新内容\r\n\r\n第二段\n'],
    ['表情🐱与标点。\n', '表情🐈与标点！\n'],
  ])('preserves both source texts exactly (%j to %j)', (before, after) => {
    const rows = compareAgentText(before, after)
    expect(rows.map(row => row.before).join('')).toBe(before)
    expect(rows.map(row => row.after).join('')).toBe(after)
    expect(rows.filter(row => row.kind === 'equal').every(row => row.before === row.after)).toBe(true)
  })

  it('isolates added and removed paragraphs without highlighting the unchanged tail', () => {
    expect(compareAgentText('共同开头\n共同结尾', '共同开头\n新增段落\n共同结尾')).toEqual([
      { kind: 'equal', before: '共同开头\n', after: '共同开头\n' },
      { kind: 'added', before: '', after: '新增段落\n' },
      { kind: 'equal', before: '共同结尾', after: '共同结尾' },
    ])
    expect(compareAgentText('删除段落\n结尾', '结尾')[0]).toEqual({ kind: 'removed', before: '删除段落\n', after: '' })
  })

  it('bounds alignment for many changed paragraphs while retaining full text', () => {
    const before = '旧段落\n'.repeat(1200)
    const after = '新段落\n'.repeat(1200)
    expect(compareAgentText(before, after)).toEqual([{ kind: 'changed', before, after }])
  })
})
