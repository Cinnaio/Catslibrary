/**
 * 阶段一回归网：行内操作菜单、选择计数条、弹窗键盘路径与焦点归还。
 * 这三件事都靠「渲染出来看不见的时序」工作（sticky 定位、rAF 抢焦点、
 * window 级快捷键），单靠人工点界面容易漏掉回归，因此固化成测试。
 */
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { Pencil, Trash2 } from 'lucide-react'
import AdminRowActions from '@/components/admin/AdminRowActions'
import AdminSelectionBar from '@/components/admin/AdminSelectionBar'
import { useDialogFocus, useDialogHotkeys } from '@/hooks/useDialogHotkeys'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'

describe('AdminRowActions', () => {
  it('主操作常驻，次级与危险操作收进菜单并可触发', async () => {
    const onEdit = vi.fn()
    const onDelete = vi.fn()
    render(
      <AdminRowActions
        label="书名"
        items={[
          { label: '同步信息', icon: Pencil, onSelect: vi.fn() },
          { label: '删除小说', icon: Trash2, onSelect: onDelete, danger: true },
        ]}
      >
        <button onClick={onEdit}>编辑</button>
      </AdminRowActions>,
    )

    // 编辑是常驻主操作，不经菜单即可命中
    await userEvent.click(screen.getByRole('button', { name: '编辑' }))
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onDelete).not.toHaveBeenCalled()

    // 危险操作藏在「更多操作」后，需要显式两步
    await userEvent.click(screen.getByRole('button', { name: '书名：更多操作' }))
    const del = await screen.findByRole('menuitem', { name: /删除小说/ })
    await userEvent.click(del)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('无次级操作时不渲染菜单触发器', () => {
    render(
      <AdminRowActions label="书名" items={[]}>
        <button>编辑</button>
      </AdminRowActions>,
    )
    expect(screen.queryByRole('button', { name: /更多操作/ })).toBeNull()
  })

  it('菜单项按普通项与危险项分组，危险项排在其后并带分隔', async () => {
    render(
      <AdminRowActions
        label="书名"
        items={[
          { label: '危险在前', icon: Trash2, onSelect: vi.fn(), danger: true },
          { label: '普通在后', icon: Pencil, onSelect: vi.fn() },
        ]}
      >
        <button>编辑</button>
      </AdminRowActions>,
    )
    await userEvent.click(screen.getByRole('button', { name: '书名：更多操作' }))

    const menuItems = await screen.findAllByRole('menuitem')
    // 顺序必须是普通项在前、危险项收尾：危险操作不应出现在菜单首项位置
    expect(menuItems.map((el) => el.textContent)).toEqual(['普通在后', '危险在前'])
    expect(screen.getByRole('menuitem', { name: /危险在前/ })).toHaveAttribute('data-variant', 'destructive')
  })
})

describe('AdminSelectionBar', () => {
  it('count 为 0 时整体不渲染', () => {
    const { container } = render(<AdminSelectionBar count={0} label="已选 0 本" onClear={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('展示计数、提供批量动作与清空入口', async () => {
    const onClear = vi.fn()
    render(
      <AdminSelectionBar count={3} label="已选 3 本" onClear={onClear}>
        <button>批量删除</button>
      </AdminSelectionBar>,
    )

    const bar = screen.getByRole('status')
    expect(bar).toHaveTextContent('已选 3 本')
    expect(screen.getByRole('button', { name: '批量删除' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /取消选择/ }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })
})

describe('useDialogHotkeys', () => {
  function Harness({ submitting = false }: { submitting?: boolean }) {
    const [open, setOpen] = useState(false)
    const [calls, setCalls] = useState(0)
    useDialogHotkeys({ open, onSubmit: () => setCalls((n) => n + 1), submitting })
    return (
      <div>
        <button onClick={() => setOpen(true)}>打开</button>
        <output data-testid="calls">{calls}</output>
        <input aria-label="普通输入" />
        {open && <textarea aria-label="正文" />}
      </div>
    )
  }

  // 弹窗未打开时不挂全局监听：后台常驻快捷键会与阅读器键盘绑定打架
  it('未打开时快捷键不生效', () => {
    render(<Harness />)
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(screen.getByTestId('calls')).toHaveTextContent('0')
  })

  it('Ctrl+Enter 与 Ctrl+S 都触发提交', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '打开' }))

    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    await waitFor(() => expect(screen.getByTestId('calls')).toHaveTextContent('1'))
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    await waitFor(() => expect(screen.getByTestId('calls')).toHaveTextContent('2'))
  })

  it('正文里的裸 Enter 不触发提交（换行仍归 textarea）', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('button', { name: '打开' }))
    fireEvent.keyDown(screen.getByLabelText('正文'), { key: 'Enter' })
    expect(screen.getByTestId('calls')).toHaveTextContent('0')
  })

  it('提交中不再触发，避免重复提交', async () => {
    render(<Harness submitting />)
    await userEvent.click(screen.getByRole('button', { name: '打开' }))
    fireEvent.keyDown(window, { key: 'Enter', ctrlKey: true })
    expect(screen.getByTestId('calls')).toHaveTextContent('0')
  })
})

describe('useDialogFocus', () => {
  function Harness() {
    const [open, setOpen] = useState(false)
    useDialogFocus(open, '#target-field')
    return (
      <div>
        <button onClick={() => setOpen(true)}>打开弹窗</button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>编辑</DialogTitle>
            {/* Radix 默认聚焦第一个可聚焦元素；这里放一个关闭按钮在最前，
                若没有 useDialogFocus，焦点会落到关闭按钮上 */}
            <Input id="target-field" aria-label="标题" />
          </DialogContent>
        </Dialog>
      </div>
    )
  }

  it('打开后焦点落到指定字段，关闭后归还给触发按钮', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: '打开弹窗' })
    await userEvent.click(opener)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('标题')))

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(document.activeElement).toBe(opener))
  })
})
