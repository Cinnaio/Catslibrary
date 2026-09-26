/**
 * 阶段三回归网：危险确认框的焦点安全 + 提交态的关闭复位。
 * 契约：危险操作弹出确认框后，初始焦点必须在「取消」而不是「确认」——
 * Radix 默认聚焦确认键，Enter 会直接执行删除，而 Enter 恰好是误触成本
 * 最低的键。这条约束看不见、只在真实键盘操作下暴露，必须固化成断言。
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { ConfirmProvider, useConfirm } from '@/components/feedback'
import { Dialog, DialogContent, DialogFooter, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'

function Harness({ danger }: { danger: boolean }) {
  const { confirm } = useConfirm()
  return (
    <button
      onClick={() =>
        void confirm({ title: '删除小说', message: '此操作不可恢复。', okText: '删除', danger })
      }
    >
      触发
    </button>
  )
}

async function openConfirm(danger: boolean) {
  render(
    <ConfirmProvider>
      <Harness danger={danger} />
    </ConfirmProvider>,
  )
  await userEvent.click(screen.getByRole('button', { name: '触发' }))
  await waitFor(() => expect(screen.getByRole('alertdialog')).toBeInTheDocument())
}

describe('危险确认框的初始焦点', () => {
  it('danger 时焦点落在「取消」，误触 Enter 不会执行删除', async () => {
    await openConfirm(true)
    const cancel = screen.getByRole('button', { name: '取消' })
    await waitFor(() => expect(document.activeElement).toBe(cancel))
  })

  it('danger 时按 Enter 只会关闭弹窗，不触发确认回调', async () => {
    let confirmed: boolean | null = null
    function Probe() {
      const { confirm } = useConfirm()
      return (
        <button
          onClick={() => {
            void confirm({ title: '删除小说', danger: true, okText: '删除' }).then((v) => {
              confirmed = v
            })
          }}
        >
          触发
        </button>
      )
    }
    render(
      <ConfirmProvider>
        <Probe />
      </ConfirmProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '触发' }))
    await screen.findByRole('alertdialog')

    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    // Enter 命中取消 ⇒ 结果是 false，绝不能是 true
    expect(confirmed).toBe(false)
  })

  it('非危险确认同样停在取消键（Radix AlertDialog 的既有行为，此处锁住不回退）', async () => {
    // 非危险操作不值得额外打断，但焦点也不能落在执行键上：
    // 这个断言的作用是记录「当前行为就是这样」，日后换原语时若焦点
    // 漂到执行键，会被这条测试拦下并逼我们显式决定。
    await openConfirm(false)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '取消' })))
  })
})

describe('编辑弹窗的提交态复位', () => {
  /**
   * 复现「请求飞行中关闭弹窗 → 下次打开按钮永久禁用」的路径。
   * 用最小复刻而非真实页面：close 与 submit 都必须复位 saving，
   * 只复位一处就会留下一个点不动的弹窗。
   * 提交触发器放在弹窗内部——Radix 模态会锁焦点，外部按钮点不到。
   */
  function Editor({ closeResetsSaving }: { closeResetsSaving: boolean }) {
    const [open, setOpen] = useState(false)
    const [saving, setSaving] = useState(false)

    function close() {
      setOpen(false)
      if (closeResetsSaving) setSaving(false)
    }

    return (
      <>
        <Button onClick={() => setOpen(true)}>打开</Button>
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!next) close()
          }}
        >
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>编辑</DialogTitle>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setSaving(true)}>
                模拟开始提交
              </Button>
              <Button variant="secondary" onClick={close} disabled={saving}>
                取消
              </Button>
              <Button disabled={saving}>{saving ? '保存中…' : '保存'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  }

  it('关闭时复位提交态，重开不会留下点不动的「保存中…」', async () => {
    render(<Editor closeResetsSaving />)
    await userEvent.click(screen.getByRole('button', { name: '打开' }))
    await userEvent.click(await screen.findByRole('button', { name: '模拟开始提交' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled())

    // Esc 关闭（取消键此时也因 saving 而禁用），再重新打开
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: '打开' }))

    const save = await screen.findByRole('button', { name: '保存' })
    expect(save).toBeEnabled()
  })

  it('若关闭不复位提交态，弹窗重开后确实卡在禁用态（证明该复位是必要的）', async () => {
    render(<Editor closeResetsSaving={false} />)
    await userEvent.click(screen.getByRole('button', { name: '打开' }))
    await userEvent.click(await screen.findByRole('button', { name: '模拟开始提交' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '保存中…' })).toBeDisabled())

    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await userEvent.click(screen.getByRole('button', { name: '打开' }))

    // 不复位 ⇒ 重开仍是禁用的「保存中…」，这就是要防的那个 bug
    expect(await screen.findByRole('button', { name: '保存中…' })).toBeDisabled()
  })
})
