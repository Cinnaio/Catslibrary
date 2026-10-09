import { useMemo, useRef } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hashParagraphText } from '@shared/thought-anchor'
import type { ChapterIllustration } from '@shared/chapter-illustrations'
import ChapterIllustrations from './ChapterIllustrations'
import { makeIllustrationAnchor } from '../../lib/chapter-illustrations'
import { formatContent } from '../../lib/reader-utils'

const api = vi.hoisted(() => ({ list: vi.fn(), save: vi.fn(), imageBlob: vi.fn() }))
vi.mock('../../lib/api', () => ({ illustrationsApi: api }))
const content = '庭院落满了雨。\n他推开了门。\n灯火依然亮着。'
function fixture(): ChapterIllustration {
  const root = document.createElement('div')
  root.innerHTML = formatContent(content)
  return {
    id: 'illustration',
    chapterId: 'chapter',
    assetId: 'asset',
    width: 20,
    height: 10,
    caption: '庭院',
    size: 'medium',
    anchor: makeIllustrationAnchor(Array.from(root.querySelectorAll<HTMLElement>('p')), 1),
    chapterRevision: 'revision',
    version: 1,
    order: 1,
    deleted: false,
  }
}
function Harness({ managing = true, visible = true, text = content }: { managing?: boolean; visible?: boolean; text?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => ({ __html: formatContent(text) }), [text])
  return (
    <>
      <ChapterIllustrations chapterId="chapter" content={text} bodyRef={ref} canManage managing={managing} visible={visible} onExit={() => {}} />
      <div ref={ref} data-testid="body" dangerouslySetInnerHTML={html} />
    </>
  )
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubGlobal('IntersectionObserver', undefined)
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
  api.list.mockResolvedValue({ illustrations: [], chapterRevision: 'revision', contentHash: hashParagraphText(content) })
  api.imageBlob.mockResolvedValue(new Blob(['image'], { type: 'image/webp' }))
})
describe('章节插图交互', () => {
  it('段间上传和预览后才保存，不改变正文段落数量；保存失败保留草稿', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(await screen.findByRole('button', { name: '在第 2 段后插图' }))
    const file = new File(['png'], 'courtyard.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('选择图片（也可以在此粘贴）'), file)
    await user.type(screen.getByLabelText('图注（可选）'), '雨夜庭院')
    expect(api.save).not.toHaveBeenCalled()
    expect(screen.getByAltText('待保存插图预览')).toBeInTheDocument()
    api.save.mockRejectedValueOnce(new Error('插图已被其他管理员修改，请刷新后重试'))
    await user.click(screen.getByRole('button', { name: '保存插图' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText('图注（可选）')).toHaveValue('雨夜庭院')
    expect(screen.getByAltText('待保存插图预览')).toBeInTheDocument()
    api.save.mockResolvedValueOnce({ ...fixture(), caption: '雨夜庭院' })
    await user.click(screen.getByRole('button', { name: '保存插图' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(api.save.mock.calls[1]?.[2]).toMatchObject({
      chapterRevision: 'revision',
      caption: '雨夜庭院',
      anchor: { paragraphIndex: 1, paragraphText: '他推开了门。' },
    })
    expect(api.save.mock.calls[1]?.[3]).toBe(file)
    expect(screen.getByTestId('body').querySelectorAll('p')).toHaveLength(3)
  })
  it('读者隐藏插图移除展示，恢复后位置不变', async () => {
    api.list.mockResolvedValue({ illustrations: [fixture()], chapterRevision: 'revision', contentHash: hashParagraphText(content) })
    const view = render(<Harness managing={false} />)
    await screen.findByRole('button', { name: '放大查看章节插图' })
    expect(screen.getByTestId('body').querySelectorAll('p')).toHaveLength(3)
    view.rerender(<Harness managing={false} visible={false} />)
    await waitFor(() => expect(screen.queryByRole('button', { name: '放大查看章节插图' })).not.toBeInTheDocument())
    view.rerender(<Harness managing={false} visible />)
    await screen.findByRole('button', { name: '放大查看章节插图' })
    expect(screen.getByTestId('body').querySelectorAll('p')[1]?.nextElementSibling?.className).toBe('chapter-illustration-slot')
  })
  it('删除后可撤销，素材和插图版本传给服务端', async () => {
    const item = fixture()
    api.list.mockResolvedValue({ illustrations: [item], chapterRevision: 'revision', contentHash: hashParagraphText(content) })
    api.save.mockResolvedValueOnce({ ...item, version: 2, deleted: true }).mockResolvedValueOnce({ ...item, version: 3 })
    render(<Harness />)
    fireEvent.click(await screen.findByRole('button', { name: '删除' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: '删除' })).not.toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    await screen.findByRole('button', { name: '删除' })
    expect(api.save.mock.calls[1]?.[2]).toMatchObject({ assetId: 'asset', version: 2, deleted: false })
  })
  it('原段落消失时只在管理列表显示，重新定位后恢复正文展示', async () => {
    const revised = '全新的第一段。\n全新的第二段。'
    api.list.mockResolvedValue({ illustrations: [fixture()], chapterRevision: 'new-revision', contentHash: hashParagraphText(revised) })
    api.save.mockImplementation(async (_chapter, _id, metadata) => ({ ...fixture(), ...metadata, version: 2 }))
    render(<Harness text={revised} />)
    await screen.findByText('位置待确认（1）')
    expect(screen.getByTestId('body').querySelectorAll('figure')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: '重新定位' }))
    fireEvent.click(screen.getByRole('button', { name: '在第 1 段后插图' }))
    await waitFor(() => expect(screen.queryByText('位置待确认（1）')).not.toBeInTheDocument())
    expect(api.save.mock.calls[0]?.[2]).toMatchObject({ anchor: { paragraphIndex: 0, paragraphText: '全新的第一段。' } })
    expect(screen.getByTestId('body').querySelectorAll('figure')).toHaveLength(1)
  })
})
