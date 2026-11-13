import { fireEvent, render, screen, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import type { TitleSource } from '@/lib/api'
import TitleSourceSearchResults from './TitleSourceSearchResults'

function candidate(site: string, id: string, confidence: TitleSource['confidence'], matchScore: number): TitleSource {
  return { site, siteName: site === 'jjwxc' ? '晋江' : '示例书源', bookId: id, title: `作品${id}`, author: '作者', status: 'ongoing', url: `https://${site}.example/${id}`, confidence, matchScore, matchReason: confidence === 'high' ? '书名一致 · 作者一致' : '书名不一致' }
}

it('晋江大量结果时，示例书源高匹配候选直接出现在顶部，其他结果折叠且可选择', () => {
  const onSelect = vi.fn()
  const jjwxc = Array.from({ length: 30 }, (_, i) => candidate('jjwxc', String(i), 'low', 0))
  const hit = candidate('fixture', 'matched', 'high', 100)
  const medium = candidate('jjwxc', 'medium', 'medium', 70)
  render(<TitleSourceSearchResults search={{ title: '作品', author: '作者', sources: {
    jjwxc: { ok: true, results: [...jjwxc, medium] }, fixture: { ok: true, results: [hit] },
  } }} disabled={false} onSelect={onSelect} />)
  const preferred = screen.getByRole('region', { name: '优先候选' })
  const buttons = within(preferred).getAllByRole('button')
  expect(buttons[0]).toHaveTextContent('作品matched')
  expect(buttons[0]).toHaveTextContent('示例书源')
  expect(buttons[0]).toHaveTextContent('高置信匹配')
  fireEvent.click(buttons[0]!)
  expect(onSelect).toHaveBeenCalledWith(hit.url)
  const summary = screen.getByText('晋江其他结果 · 30 个')
  expect(summary.closest('details')).not.toHaveAttribute('open')
  fireEvent.click(summary)
  expect(summary.closest('details')).toHaveAttribute('open')
  fireEvent.click(screen.getByRole('button', { name: /^作品0晋江/ }))
  expect(onSelect).toHaveBeenLastCalledWith(jjwxc[0]!.url)
})

it('优先展示最多六个，剩余候选仍可展开，不会自动读取源站', () => {
  const onSelect = vi.fn()
  render(<TitleSourceSearchResults search={{ title: '', author: '', sources: {
    jjwxc: { ok: true, results: Array.from({ length: 10 }, (_, i) => candidate('jjwxc', String(i), 'high', 100 - i)) },
    fixture: { ok: false, results: [], error: '书源搜索需要登录' },
  } }} disabled={true} onSelect={onSelect} />)
  expect(within(screen.getByRole('region', { name: '优先候选' })).getAllByRole('button')).toHaveLength(6)
  expect(screen.getByText('晋江其他结果 · 4 个')).toBeInTheDocument()
  expect(screen.getByText('书源搜索需要登录')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /^作品0晋江/ }))
  expect(onSelect).not.toHaveBeenCalled()
})

it('无高匹配候选时提供展开入口，兼容没有匹配等级的结果', () => {
  render(<TitleSourceSearchResults search={{ title: '', author: '', sources: {
    jjwxc: { ok: true, results: [candidate('jjwxc', 'old', undefined, 0)] }, fixture: { siteName: '示例书源', ok: true, results: [] },
  } }} disabled={false} onSelect={vi.fn()} />)
  expect(screen.getByText('没有找到高匹配候选，可展开源站结果手动查找。')).toBeInTheDocument()
  expect(screen.getByText('晋江其他结果 · 1 个')).toBeInTheDocument()
  expect(screen.getByText('示例书源 · 没有匹配结果')).toBeInTheDocument()
})
