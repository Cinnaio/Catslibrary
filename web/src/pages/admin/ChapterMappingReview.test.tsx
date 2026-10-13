import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import type { SourceSyncPreview } from '@/lib/api'
import ChapterMappingReview from './ChapterMappingReview'

it('默认聚焦待办，同名远距离候选展示邻章而不自动暂存', () => {
  const onRemap = vi.fn(), onInspect = vi.fn()
  const localChapters = [{id:'ok',order:91,title:'自由'},{id:'game',order:112,title:'游戏'}]
  render(<ChapterMappingReview preview={{
    ...preview, localChapters,
    mappings: [{...preview.mappings[0]!,sourceChapterKey:'free',sourceOrder:91,sourceTitle:'自由',localChapterIds:['ok']}],
    sourceChapters: [{key:'before',order:53,title:'前章',url:''},{key:'game-src',order:54,title:'游戏',url:''},{key:'after',order:55,title:'后章',url:''}],
    orderShiftSegments: [{localRange:{from:91,to:91},sourceRange:{from:91,to:91},offset:0,kind:'layout',reason:'已一致',blockingChapterIds:[],chapterIds:['ok']}],
  }} disabled={false} onRemap={onRemap} onInspect={onInspect} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  expect(screen.getByRole('button', {name:'有差异 1'})).toHaveAttribute('aria-pressed','true')
  expect(screen.queryByText('本地 91 · 自由')).not.toBeInTheDocument()
  expect(screen.queryByText('序号偏移分段')).not.toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'调整映射：本地 112'}))
  fireEvent.click(screen.getByRole('button',{name:'核对源站 54 · 游戏'}))
  expect(screen.getByText('源站前章：前章；后章：后章')).toBeInTheDocument()
  expect(screen.getByText(/两侧相距 58 个序号/)).toBeInTheDocument()
  expect(onRemap).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'预览此章正文'}))
  expect(onInspect).toHaveBeenCalledWith('game')
})

it('批量选择显示实际标题和序号影响，受阻项单独筛选', () => {
  const localChapters = ['a','b','c'].map((id,i)=>({id,order:i+1,title:`章节${id}`}))
  const changes = [{localChapterId:'a',eligible:false}] as SourceSyncPreview['changes']
  render(<ChapterMappingReview preview={{...preview,localChapters,changes,mappings:[],
    orderChanges:[{localChapterId:'b',title:'章节b',oldOrder:2,newOrder:1}],
    orderRepairSkipped:[{localChapterId:'c',reason:'被占用',blockingChapterIds:['a']}],
  }} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button',{name:'全选当前筛选结果 3 项'}))
  expect(screen.getByText('本次映射选择：确认 1 个标题 · 修复 1 个序号 · 0 项无需更新')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button',{name:'修复受阻 1'}))
  expect(screen.getByRole('list',{name:'全部章节映射'}).children).toHaveLength(1)
  expect(screen.getByText('本地 3 · 章节c')).toBeInTheDocument()
})

const preview = {
  mappings: [{ sourceChapterKey: 's1', sourceOrder: 1, sourceTitle: '源站第一章', localChapterIds: ['a'], relation: 'one_to_one', confidence: 'high', matchReason: 'exact-title', matchEvidence: '完整标题一致。' }],
  localChapters: [{ id: 'a', order: 1, title: '本地第一章' }, { id: 'b', order: 2, title: '本地第二章' }],
  sourceChapters: [{ key: 's1', order: 1, title: '源站第一章' }, { key: 's2', order: 2, title: '源站第二章' }],
  manualMappings: [],
} as unknown as SourceSyncPreview

it('展示匹配依据与相邻章节，保存未匹配章的人工对应关系', async () => {
  const onRemap = vi.fn()
  // jsdom 不实现指针捕获，Radix Select 在打开菜单时会读取这些浏览器 API。
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  const user = userEvent.setup()
  render(<ChapterMappingReview preview={preview} disabled={false} onRemap={onRemap} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  expect(screen.getByText(/完整标题一致 · 置信度高/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '调整映射：本地 2' }))
  expect(screen.getByRole('heading', { name: '调整本地 2 · 本地第二章' })).toHaveFocus()
  expect(screen.getByRole('button', { name: '调整映射：本地 2' })).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByText(/本地前章：本地第一章/)).toBeInTheDocument()
  await user.click(screen.getByRole('combobox'))
  expect(screen.getByRole('option', { name: /源站第一章（选择后交换）/ })).not.toHaveAttribute('aria-disabled', 'true')
  await user.click(screen.getByRole('option', { name: '2 · 源站第二章' }))
  expect(screen.getByText(/源站前章：源站第一章/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '暂存映射调整' }))
  expect(onRemap).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '保存 1 项映射并重新预览' }))
  expect(onRemap).toHaveBeenCalledWith([{ localChapterId: 'b', sourceChapterKey: 's2' }])
  await waitFor(() => expect(screen.queryByText(/已暂存/)).not.toBeInTheDocument())
})

it('选择占用目标暂存双方交换，保存失败保留草稿可重试', async () => {
  const onRemap = vi.fn().mockResolvedValue(false), onPendingMappingsChange = vi.fn()
  const user = userEvent.setup()
  render(<ChapterMappingReview preview={preview} disabled={false} onRemap={onRemap} onPendingMappingsChange={onPendingMappingsChange} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  fireEvent.click(screen.getByRole('button', { name: '调整映射：本地 2' }))
  await user.click(screen.getByRole('combobox'))
  await user.click(screen.getByRole('option', { name: /源站第一章（选择后交换）/ }))
  expect(screen.getByText(/将与本地 1/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '暂存映射调整' }))
  expect(onPendingMappingsChange).toHaveBeenLastCalledWith(2)
  fireEvent.click(screen.getByRole('button', { name: '保存 2 项映射并重新预览' }))
  await waitFor(() => expect(onRemap).toHaveBeenCalledWith([
    { localChapterId: 'b', sourceChapterKey: 's1' }, { localChapterId: 'a', sourceChapterKey: null },
  ]))
  expect(screen.getByText(/已暂存 2/)).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '放弃暂存调整' }))
  expect(onPendingMappingsChange).toHaveBeenLastCalledWith(0)
})

it('有差异筛选保留序号偏移、标题不同及未匹配，忽略完整标题的标点差别', () => {
  const locals = [
    { id: 'same', order: 1, title: '第一章，标题' },
    { id: 'order', order: 53, title: '相同标题' },
    { id: 'title', order: 3, title: '原标题' },
    { id: 'missing', order: 4, title: '未匹配章' },
  ]
  const mappings = [
    { ...preview.mappings[0]!, localChapterIds: ['same'], sourceTitle: '第一章, 标题', sourceOrder: 1 },
    { ...preview.mappings[0]!, localChapterIds: ['order'], sourceTitle: '相同标题', sourceOrder: 52 },
    { ...preview.mappings[0]!, localChapterIds: ['title'], sourceTitle: '新标题', sourceOrder: 3, matchReason: 'sequence' as const },
  ]
  render(<ChapterMappingReview preview={{ ...preview, localChapters: locals, mappings }} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  fireEvent.click(screen.getByRole('button', { name: '有差异 3' }))
  expect(screen.queryByText('本地 1 · 第一章，标题')).not.toBeInTheDocument()
  expect(screen.getByText('本地 53 · 相同标题')).toBeInTheDocument()
  expect(screen.getByText('序号不同')).toBeInTheDocument()
  expect(screen.getByText('标题不同')).toBeInTheDocument()
  expect(screen.getByText('未匹配')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索本地章节映射'), { target: { value: '53' } })
  expect(screen.getAllByRole('button', { name: /调整映射：本地/ })).toHaveLength(1)
  fireEvent.change(screen.getByLabelText('搜索本地章节映射'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '全部 4' }))
  expect(screen.getAllByRole('button', { name: /调整映射：本地/ })).toHaveLength(4)
})

it('恢复自动匹配清除覆盖，拆分组不能被单章重映射', () => {
  const onRemap = vi.fn()
  render(<ChapterMappingReview preview={{ ...preview, manualMappings: [{ localChapterId: 'b', sourceChapterKey: null }], mappings: [{ ...preview.mappings[0]!, relation: 'split' }] }} disabled={false} onRemap={onRemap} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  expect(screen.getByRole('button', { name: '调整映射：本地 1' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: '恢复自动匹配' }))
  expect(onRemap).toHaveBeenCalledWith([])
})

it('全选覆盖筛选结果所有页，跨筛选保留选择，逐项取消和清空可用', () => {
  const localChapters = Array.from({ length: 25 }, (_, i) => ({ id: `local-${i}`, order: i + 1, title: `章节 ${i + 1}` }))
  render(<ChapterMappingReview preview={{ ...preview, localChapters, mappings: [] }} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  fireEvent.change(screen.getByLabelText('搜索本地章节映射'), { target: { value: '章节 25' } })
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 1 项' }))
  expect(screen.getByText('已选 1 项映射')).toBeInTheDocument()
  fireEvent.change(screen.getByLabelText('搜索本地章节映射'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 25 项' }))
  expect(screen.getByText('已选 25 项映射')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '下一页' }))
  expect(screen.getByRole('checkbox', { name: '选择映射：本地 25' })).toBeChecked()
  fireEvent.click(screen.getByRole('checkbox', { name: '选择映射：本地 25' }))
  expect(screen.getByText('已选 24 项映射')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '清空映射选择' }))
  expect(screen.getByText('已选 0 项映射')).toBeInTheDocument()
  expect(screen.getByRole('checkbox', { name: '选择映射：本地 21' })).not.toBeChecked()
})

it('选择和清空立即通知同步流程，禁用时不能操作', () => {
  const onSelectedMappingsChange = vi.fn()
  const props = { preview, onRemap: vi.fn(), onSelectedMappingsChange }
  const { rerender } = render(<ChapterMappingReview {...props} disabled={false} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  fireEvent.click(screen.getByRole('button', { name: '全选当前筛选结果 2 项' }))
  expect(onSelectedMappingsChange).toHaveBeenLastCalledWith(new Set(['a', 'b']))
  fireEvent.click(screen.getByRole('checkbox', { name: '选择映射：本地 1' }))
  expect(onSelectedMappingsChange).toHaveBeenLastCalledWith(new Set(['b']))
  rerender(<ChapterMappingReview {...props} disabled={true} />)
  expect(screen.getByRole('checkbox', { name: '选择映射：本地 1' })).toBeDisabled()
  expect(screen.getByRole('button', { name: '清空映射选择' })).toBeDisabled()
  rerender(<ChapterMappingReview {...props} disabled={false} />)
  fireEvent.click(screen.getByRole('button', { name: '清空映射选择' }))
  expect(onSelectedMappingsChange).toHaveBeenLastCalledWith(new Set())
})

it('查看阻塞章节跨越筛选与分页定位到实际占用章节，不改变同步选择', () => {
  const locals = Array.from({ length: 25 }, (_, index) => ({ id: `l${index}`, order: index + 1, title: `目录章节${index + 1}` }))
  const onSelectedMappingsChange = vi.fn()
  render(<ChapterMappingReview preview={{ ...preview,
    localChapters: locals,
    orderRepairSkipped: [{ localChapterId: 'l0', reason: '目标序号的移动依赖受阻：本地 25', blockingChapterIds: ['l24'] }],
  }} disabled={false} onRemap={vi.fn()} onSelectedMappingsChange={onSelectedMappingsChange} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  fireEvent.click(screen.getByRole('button', { name: /查看阻塞章节：本地 25/ }))
  expect(screen.getByText('本地 25 · 目录章节25')).toHaveFocus()
  expect(screen.queryByRole('region', { name: '人工映射编辑' })).not.toBeInTheDocument()
  expect(screen.getByText('本地 25 · 目录章节25')).toBeInTheDocument()
  expect(onSelectedMappingsChange).not.toHaveBeenCalled()
})

/**
 * 真实书「虐文女主求生指南」181 章 / 源站 182 章的段形态。
 * 关键事实：+1 段（真实错位）与 +7/+8 段（良性排版）的 matchReason **全部**是
 * exact-title，所以区分只能用段级 kind，不能用匹配依据。
 */
const shiftedPreview = {
  ...preview,
  localChapters: [
    { id: 'gap', order: 40, title: '笼子' },
    { id: 'layout', order: 120, title: '番外前移' },
    { id: 'plain', order: 130, title: '同序号同标题' },
  ],
  mappings: [
    { ...preview.mappings[0]!, sourceChapterKey: 's39', sourceTitle: '笼子', sourceOrder: 39, localChapterIds: ['gap'] },
    { ...preview.mappings[0]!, sourceChapterKey: 's113', sourceTitle: '番外前移', sourceOrder: 113, localChapterIds: ['layout'] },
    { ...preview.mappings[0]!, sourceChapterKey: 's130', sourceTitle: '同序号同标题', sourceOrder: 130, localChapterIds: ['plain'] },
  ],
  orderShiftSegments: [
    { localRange: { from: 40, to: 40 }, sourceRange: { from: 39, to: 39 }, offset: 1, kind: 'gap' as const, reason: '本地第 40-40 章相对源站偏移 +1，等于其前 1 个无源站对应章节造成的位移，需按源站序号归位。', blockingChapterIds: ['junk'], chapterIds: ['gap'] },
    { localRange: { from: 120, to: 120 }, sourceRange: { from: 113, to: 113 }, offset: 7, kind: 'layout' as const, reason: '本地第 120-120 章相对源站偏移 +7，无法由其前 1 个无源站对应章节解释，属本地主动重排，不按源站序号归位。', blockingChapterIds: [], chapterIds: ['layout'] },
  ],
} as unknown as SourceSyncPreview

it('真实错位段（kind=gap）与良性排版段（kind=layout）分开呈现，两者均进入序号核对', () => {
  render(<ChapterMappingReview preview={shiftedPreview} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  // 两类序号偏移都进入核对，标题匹配正确并不代表序号一致。
  fireEvent.click(screen.getByRole('button', { name: '有差异 2' }))
  expect(screen.getByText('本地 40 · 笼子')).toBeInTheDocument()
  expect(screen.getByText('序号错位')).toBeInTheDocument()
  expect(screen.getByText('本地 120 · 番外前移')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '全部 3' }))
  // 编排差异展示具体偏移，允许按勾选同步。
  expect(screen.getByText('序号偏移 +7（按勾选同步）')).toBeInTheDocument()
  expect(screen.getByText('序号偏移 +7（按勾选同步）').className).toContain('chapter-merge-dialog__shift-neutral')
  expect(screen.getByText('序号不同')).toBeInTheDocument()
  const gapNote = screen.getByText('序号错位 +1（真实错位）')
  expect(gapNote.className).toContain('chapter-merge-dialog__shift-gap')
})

it('段汇总区分真实错位与排版偏移，可定位到段内章节', () => {
  const locals = Array.from({ length: 25 }, (_, index) => ({ id: `l${index + 1}`, order: index + 1, title: `目录章节${index + 1}` }))
  // 两个真实错位段（真实书 L39-54 与 L56-105 两段同偏移、被 L55 断开），走分区列表而非折叠结论。
  const segments = [
    { localRange: { from: 1, to: 2 }, sourceRange: { from: 1, to: 2 }, offset: 0, kind: 'layout' as const, reason: '本地序号与源站一致，无需调整。', blockingChapterIds: [], chapterIds: ['l1', 'l2'] },
    { localRange: { from: 3, to: 4 }, sourceRange: { from: 1, to: 2 }, offset: 2, kind: 'gap' as const, reason: '本地第 3-4 章相对源站偏移 +2，需按源站序号归位。', blockingChapterIds: [], chapterIds: ['l3', 'l4'] },
    { localRange: { from: 6, to: 7 }, sourceRange: { from: 4, to: 5 }, offset: 2, kind: 'gap' as const, reason: '本地第 6-7 章相对源站偏移 +2，需按源站序号归位。', blockingChapterIds: [], chapterIds: ['l6', 'l7'] },
  ]
  const orderChanges = ['l3', 'l4', 'l6', 'l7'].map(id => ({ localChapterId: id, title: '目录章节', oldOrder: Number(id.slice(1)), newOrder: Number(id.slice(1)) - 2 }))
  render(<ChapterMappingReview preview={{
    ...preview,
    localChapters: locals,
    mappings: locals.map(local => ({
      ...preview.mappings[0]!, sourceChapterKey: `s${local.order}`, sourceTitle: local.title, localChapterIds: [local.id],
      sourceOrder: local.order >= 3 && local.order <= 7 ? local.order - 2 : local.order,
    })),
    orderShiftSegments: segments,
    orderChanges,
  }} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  fireEvent.click(screen.getByText('序号偏移分段'))
  expect(screen.getByText('本地 3–4 章（源站 1–2 章）')).toBeInTheDocument()
  expect(screen.getAllByText('真实错位 +2')).toHaveLength(2)
  expect(screen.getAllByText('2 章可修复（本地 3、4）')).toHaveLength(1)
  expect(screen.getByText('2 章可修复（本地 6、7）')).toBeInTheDocument()
  expect(screen.queryByText('编排差异 0')).not.toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: '定位' })[0]!)
  expect(screen.getByText('本地 3 · 目录章节3')).toHaveFocus()
})

it('缺少 orderShiftSegments 的旧响应回退为序号不同，不崩溃', () => {
  const legacy = { ...shiftedPreview, orderShiftSegments: undefined } as unknown as SourceSyncPreview
  render(<ChapterMappingReview preview={legacy} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  fireEvent.click(screen.getByRole('button', { name: '有差异 2' }))
  expect(screen.getAllByText('序号不同')).toHaveLength(2)
  expect(screen.queryByText(/排版偏移/)).not.toBeInTheDocument()
  expect(screen.queryByText('序号偏移分段')).not.toBeInTheDocument()
})

/**
 * 真实书形态的回归：真实错位段（全部 exact-title）+ 良性排版段，
 * 66 条真实错位与 69 条良性排版在 matchReason 上完全同形（都是 exact-title）。
 * 用 matchReason 判定会一条都报不出来。
 */
it('真实书的 +1 真实错位段报出可归位章节，+7/+8 编排差异同样进入核对', () => {
  const shifted = Array.from({ length: 66 }, (_, index) => ({ id: `g${index}`, order: 40 + index, title: `正文${index}` }))
  const laid = Array.from({ length: 69 }, (_, index) => ({ id: `y${index}`, order: 113 + index, title: `番外${index}` }))
  const localChapters = [...shifted, ...laid]
  const mappings = localChapters.map(row => ({
    ...preview.mappings[0]!, sourceChapterKey: `s${row.order - 1}`, sourceOrder: row.order >= 113 ? row.order - 8 : row.order - 1, sourceTitle: row.title,
    localChapterIds: [row.id], matchReason: 'exact-title' as const,
  }))
  const orderShiftSegments = [
    { localRange: { from: 40, to: 105 }, sourceRange: { from: 39, to: 104 }, offset: 1, kind: 'gap' as const, reason: '需按源站序号归位。', blockingChapterIds: ['junk'], chapterIds: shifted.map(row => row.id) },
    { localRange: { from: 113, to: 181 }, sourceRange: { from: 105, to: 173 }, offset: 8, kind: 'layout' as const, reason: '属本地主动重排，不按源站序号归位。', blockingChapterIds: [], chapterIds: laid.map(row => row.id) },
  ]
  const orderChanges = shifted.slice(0, 66).map(row => ({ localChapterId: row.id, title: row.title, oldOrder: row.order, newOrder: row.order - 1 }))
  render(<ChapterMappingReview preview={{ ...preview, localChapters, mappings, orderShiftSegments, orderChanges }} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  // 真实错位段内的可归位章节全部进入有差异筛选（分页只显示前 20 条）。
  fireEvent.click(screen.getByRole('button', { name: '有差异 135' }))
  expect(screen.getAllByText('序号错位 +1（真实错位）')).toHaveLength(20)
  // 69 条编排差异同样纳入核对，不能静默隐藏。
  expect(screen.getByRole('button', { name: '有差异 135' })).toBeInTheDocument()
  fireEvent.click(screen.getByText('序号偏移分段'))
  expect(screen.getByText('66 章可修复（本地 40、41、42、43、44、45…）')).toBeInTheDocument()
  expect(screen.queryByText('编排差异 0')).not.toBeInTheDocument()
  fireEvent.click(screen.getAllByRole('button', { name: '定位' })[0]!)
  expect(screen.getByText('本地 40 · 正文0')).toHaveFocus()
})

it('后端认定 exact-title 时前端不报标题不同，源站编号前缀差异仍提示', () => {
  const cases = {
    ...preview,
    localChapters: [
      { id: 'noise', order: 1, title: '掉马' },
      { id: 'prefix', order: 2, title: '12、分岔山路' },
      { id: 'real', order: 3, title: '原标题' },
    ],
    mappings: [
      { ...preview.mappings[0]!, sourceChapterKey: 's1', sourceTitle: '掉马（微H）', sourceOrder: 1, localChapterIds: ['noise'], matchReason: 'exact-title' as const },
      { ...preview.mappings[0]!, sourceChapterKey: 's2', sourceTitle: '第12章 分岔山路', sourceOrder: 2, localChapterIds: ['prefix'], matchReason: 'chapter-number' as const },
      { ...preview.mappings[0]!, sourceChapterKey: 's3', sourceTitle: '新标题', sourceOrder: 3, localChapterIds: ['real'], matchReason: 'sequence' as const },
    ],
  } as unknown as SourceSyncPreview
  render(<ChapterMappingReview preview={cases} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  fireEvent.click(screen.getByRole('button', { name: '有差异 2' }))
  expect(screen.queryByText('本地 1 · 掉马')).not.toBeInTheDocument()
  expect(screen.getByText('本地 2 · 12、分岔山路')).toBeInTheDocument()
  expect(screen.getByText('本地 3 · 原标题')).toBeInTheDocument()
  expect(screen.getAllByText('标题不同')).toHaveLength(2)
})

it('源站选择器支持序号与标题子串搜索，超过 100 章给出引导', async () => {
  Element.prototype.hasPointerCapture = () => false
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  const user = userEvent.setup()
  const sources = Array.from({ length: 120 }, (_, index) => ({ key: `s${index + 1}`, order: index + 1, title: `源站章节${index + 1}`, url: '' }))
  render(<ChapterMappingReview preview={{ ...preview,
    sourceChapters: sources,
    mappings: [{ ...preview.mappings[0]!, sourceChapterKey: 's1', sourceOrder: 1, sourceTitle: '源站章节1', localChapterIds: ['a'] }],
  }} disabled={false} onRemap={vi.fn()} />)
  fireEvent.click(screen.getByText('核对与调整映射'))
  fireEvent.click(screen.getByRole('button', { name: /^全部 / }))
  fireEvent.click(screen.getByRole('button', { name: '调整映射：本地 2' }))
  await user.click(screen.getByRole('combobox'))
  // 未搜索时给出上限引导，且只展示前 100 章。
  expect(screen.getByText('找到 120 章，展示前 100 章；输入标题或序号缩小范围。')).toBeInTheDocument()
  expect(screen.getByRole('option', { name: '100 · 源站章节100' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: '101 · 源站章节101' })).not.toBeInTheDocument()
  // 标题子串可定位到 100 条之外的章节。
  fireEvent.change(screen.getByLabelText('搜索源站映射目标'), { target: { value: '章节120' } })
  expect(screen.getByRole('option', { name: '120 · 源站章节120' })).toBeInTheDocument()
  expect(screen.queryByText(/展示前 100 章/)).not.toBeInTheDocument()
  // 序号子串同样有效。
  fireEvent.change(screen.getByLabelText('搜索源站映射目标'), { target: { value: '119' } })
  expect(screen.getByRole('option', { name: '119 · 源站章节119' })).toBeInTheDocument()
  expect(screen.queryByRole('option', { name: '120 · 源站章节120' })).not.toBeInTheDocument()
})

