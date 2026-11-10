import { useState } from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { AnalysisReferenceSelection } from '@shared/novel-analysis'
import { request } from '@/lib/api'
import AnalysisReferencePicker from './AnalysisReferencePicker'

vi.mock('@/lib/api', () => ({ request: vi.fn() }))
const choice = (id = 'r1', revision = 1) => ({ id, revision, kind: 'plot', edited: true, usable: true, reason: '',
  question: '旧信的去向', startChapter: { id: 'c1', title: '第一章' }, endChapter: { id: 'c1', title: '第一章' } })
const changed = vi.fn()
function Picker({ active = true, novelId = 'book', initial }: { active?: boolean; novelId?: string; initial?: AnalysisReferenceSelection[] }) {
  const [value, setValue] = useState(initial)
  return <AnalysisReferencePicker novelId={novelId} afterChapterId="c1" active={active} value={value}
    onChange={next => { changed(next); setValue(next) }} disabled={false} onOpenAnalysis={() => {}} />
}
beforeEach(() => { vi.mocked(request).mockReset(); changed.mockClear() })

it('显示默认修订、禁止未来报告，并保留作者取消全部后的空选择', async () => {
  vi.mocked(request).mockResolvedValue({ reports: [choice(), { ...choice('future'), usable: false, reason: '超过当前起点' }],
    defaults: [{ reportId: 'r1', revision: 1 }], nextOffset: null })
  const view = render(<Picker />)
  await waitFor(() => expect(screen.getAllByRole('checkbox')[0]).toBeChecked())
  expect(screen.getAllByRole('checkbox')[1]).toBeDisabled()
  expect(screen.getAllByText('旧信的去向')).toHaveLength(2)
  fireEvent.click(screen.getByRole('button', { name: '取消全部参考' }))
  expect(changed).toHaveBeenLastCalledWith([])
  view.rerender(<Picker active={false} />)
  view.rerender(<Picker active />)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(2))
  expect(screen.getAllByRole('checkbox')[0]).not.toBeChecked()
  expect(changed).toHaveBeenLastCalledWith([])
})

it('翻页更新已选报告版本并要求作者重新选用，不静默替换', async () => {
  vi.mocked(request).mockResolvedValueOnce({ reports: [choice()], defaults: [{ reportId: 'r1', revision: 1 }], nextOffset: 20 })
    .mockResolvedValueOnce({ reports: [choice('r1', 2)], nextOffset: null })
  render(<Picker />)
  await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked())
  fireEvent.click(screen.getByRole('button', { name: '更多报告' }))
  await screen.findByText('所选版本已变化，请取消后重新选用。')
  expect(changed).toHaveBeenLastCalledWith([{ reportId: 'r1', revision: 1 }])
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('checkbox'))
  expect(changed).toHaveBeenLastCalledWith([{ reportId: 'r1', revision: 2 }])
})

it('切书后丢弃旧请求的默认选择与内容', async () => {
  let resolve!: (page: unknown) => void
  vi.mocked(request).mockImplementationOnce(() => new Promise(done => { resolve = done }))
    .mockResolvedValueOnce({ reports: [], defaults: [], nextOffset: null })
  const view = render(<Picker key="book" />)
  await waitFor(() => expect(request).toHaveBeenCalledTimes(1))
  view.rerender(<Picker key="other" novelId="other" />)
  await screen.findByText('暂无分析报告，仍可使用正文创作。')
  await act(async () => { resolve({ reports: [choice()], defaults: [{ reportId: 'r1', revision: 1 }], nextOffset: null }) })
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  expect(changed).toHaveBeenCalledTimes(1)
  expect(changed).toHaveBeenLastCalledWith([])
})

it('显示报告事实疑点但保留作者手动选择权', async () => {
  vi.mocked(request).mockResolvedValue({ reports: [{ ...choice(), reviewWarning: '有 1 处事实疑点待核对' }], defaults: [], nextOffset: null })
  render(<Picker />)
  await screen.findByText('有 1 处事实疑点待核对')
  expect(screen.getByRole('checkbox')).toBeEnabled()
  fireEvent.click(screen.getByRole('checkbox'))
  expect(changed).toHaveBeenLastCalledWith([{ reportId: 'r1', revision: 1 }])
})
