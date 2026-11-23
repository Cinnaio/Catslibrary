import { renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { hashParagraphText } from '@shared/thought-anchor'
import { useReaderSearch } from './useReaderSearch'
import type { ReactNode } from 'react'
beforeEach(() => { vi.stubGlobal('CSS', { highlights: new Map() }); vi.stubGlobal('Highlight', class {}) })
afterEach(() => { vi.unstubAllGlobals() })
function setup(html: string, hash: string, index: number, query = '银铃响起') {
  const root = document.createElement('div'); root.innerHTML = html
  const onLocate = vi.fn(), params = new URLSearchParams({ find: query, echoHash: hash, echoParagraph: String(index) })
  const body = { current: root }, ready = { current: true }
  const hook = renderHook(() => useReaderSearch({ body, ready, chapterId: 'c', loading: false, content: html, pageMode: false, onLocate }),
    { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[`/read/n/c?${params}`]}>{children}</MemoryRouter> })
  return { ...hook, root, onLocate }
}
it('重复原句只在带指纹的目标段落定位，正文变更不回退到其他同句', async () => {
  const text = '窗前银铃响起。', hash = hashParagraphText(text)
  const { result, onLocate, root } = setup(`<p>${text}</p><p>月下银铃响起。</p><p>${text}</p>`, hash, 2)
  await waitFor(() => expect(result.current.total).toBe(1))
  expect(onLocate.mock.calls[0]![0].startContainer.parentElement).toBe(root.children[2])
  const missing = setup(`<p>${text}</p>`, 'obsolete', 2)
  await new Promise(r => setTimeout(r, 40))
  expect(missing.onLocate).not.toHaveBeenCalled(); expect(missing.result.current.total).toBe(0)
})
it('虚拟分段保留源锚点，可以定位跨显示段落的连续引文', async () => {
  const text = '窗前银铃响起，往事浮现。', hash = hashParagraphText(text)
  const attributes = `data-source-paragraph-index="0" data-source-paragraph-hash="${hash}" data-paragraph-hash="${hash}"`
  const { result, onLocate } = setup(`<p ${attributes}>窗前银铃</p><p ${attributes}>响起，往事浮现。</p>`, hash, 0)
  await waitFor(() => expect(result.current.total).toBe(1))
  expect(onLocate.mock.calls[0]![0].toString()).toBe('银铃响起')
})
it('CR 历史正文的全章指纹不妨碍按实际段落定位', async () => {
  const text = '银铃响起，往事浮现。'
  const { result, root, onLocate } = setup(`<p data-source-paragraph-index="0" data-paragraph-hash="legacy">旧时</p><p data-source-paragraph-index="0" data-paragraph-hash="legacy">${text}</p>`, hashParagraphText(text), 1)
  await waitFor(() => expect(result.current.total).toBe(1))
  expect(onLocate.mock.calls[0]![0].startContainer.parentElement).toBe(root.children[1])
})

it('归一化引文仍能定位多空格及行内换行，保留真实选区偏移', async () => {
  const text = '她说：“银铃  响起，\n约定还在。”'
  const { result, onLocate } = setup(`<p>${text}</p>`, hashParagraphText(text), 0, '银铃 响起， 约定还在')
  await waitFor(() => expect(result.current.total).toBe(1))
  expect(onLocate.mock.calls[0]![0].toString()).toBe('银铃  响起，\n约定还在')
})

it('CR 全章历史锚点的跨段引句保留换行间隔', async () => {
  const hash = hashParagraphText('银铃响起。\r往事浮现。')
  const attributes = `data-source-paragraph-index="0" data-source-paragraph-hash="${hash}" data-paragraph-hash="${hash}"`
  const { result, onLocate } = setup(`<p ${attributes}>银铃响起。</p><p ${attributes}>往事浮现。</p>`, hash, 0, '银铃响起。 往事浮现。')
  await waitFor(() => expect(result.current.total).toBe(1))
  expect(onLocate).toHaveBeenCalledTimes(1)
})
