import { act, renderHook, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useReaderSearch } from './useReaderSearch'
import { findBookMatches } from '@shared/book-search'
import type { ReactNode } from 'react'

const highlights = new Map<string, unknown>()
beforeEach(() => {
  vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal('Highlight', class { constructor(..._ranges: Range[]) {} })
})
afterEach(() => { highlights.clear(); vi.unstubAllGlobals() })

it('跨行内标签高亮，等待阅读进度恢复后再定位，且不改写正文节点', async () => {
  const root = document.createElement('div')
  root.innerHTML = '<p>海<em>风</em>吹过</p><p>海风仍在</p>'
  const original = root.innerHTML
  const ready = { current: false }, body = { current: root }, onLocate = vi.fn()
  const { result, unmount } = renderHook(() => useReaderSearch({
    body, ready, chapterId: 'c', loading: false, content: original, pageMode: false, onLocate,
  }), { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={['/read/n/c?find=海风']}>{children}</MemoryRouter> })
  expect(onLocate).not.toHaveBeenCalled()
  ready.current = true
  await waitFor(() => expect(result.current.total).toBe(2))
  expect(onLocate.mock.calls[0]![0].toString()).toBe('海风')
  expect(root.innerHTML).toBe(original)
  expect(highlights.has('book-search')).toBe(true)
  act(() => result.current.locate(1))
  expect(result.current.index).toBe(1)
  unmount(); expect(highlights.has('book-search')).toBe(false)
})

it('匹配特殊符号与 Unicode 时保留原文 UTF-16 位置，并限制高亮数量', () => {
  expect(findBookMatches('İ猫 %_ .* 海风', '猫')).toEqual([{ start: 1, end: 2 }])
  expect(findBookMatches('İ猫 %_ .* 海风', '.*')).toEqual([{ start: 6, end: 8 }])
  expect(findBookMatches('猫'.repeat(2000), '猫')).toHaveLength(1000)
})
