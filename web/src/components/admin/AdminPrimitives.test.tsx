import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import FormField from "@/components/shared/FormField"
import { DialogBody, DialogFrame } from "@/components/shared/DialogFrame"
import { Dialog, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'

describe('后台共用字段的标签关联', () => {
  it('保留调用方的控件 ID，输入与原处理器保持连接', async () => {
    const user = userEvent.setup()
    function Form() {
      const [value, setValue] = useState('')
      return (
        <FormField label="模型" htmlFor="provider-model" hint="填入供应商的模型名称">
          <input id="provider-model" value={value} onChange={(event) => setValue(event.target.value)} />
        </FormField>
      )
    }
    render(<Form />)
    const input = screen.getByRole('textbox', { name: '模型' })
    await user.type(input, 'example-model')
    expect(input).toHaveValue('example-model')
    expect(screen.getByText('填入供应商的模型名称')).toBeInTheDocument()
  })

  it('复合控件拿到独立标签 ID，多个同名字段不会串联', () => {
    render(
      <>
        <FormField label="来源">
          {({ id, labelId }) => (
            <button id={id} aria-labelledby={labelId}>
              选一个来源
            </button>
          )}
        </FormField>
        <FormField label="来源">
          {({ id, labelId }) => (
            <button id={id} aria-labelledby={labelId}>
              选另一个来源
            </button>
          )}
        </FormField>
      </>,
    )
    const buttons = screen.getAllByRole('button', { name: '来源' })
    expect(buttons[0]!.id).not.toBe(buttons[1]!.id)
    expect(buttons[0]!.getAttribute('aria-labelledby')).not.toBe(buttons[1]!.getAttribute('aria-labelledby'))
    for (const button of buttons) {
      const label = document.getElementById(button.getAttribute('aria-labelledby')!)
      expect(label).toHaveAttribute('for', button.id)
    }
  })
})

describe('后台弹窗保持原语的键盘行为', () => {
  it('内容在 portal 中可读，Escape 关闭后焦点返回入口', async () => {
    const user = userEvent.setup()
    render(
      <Dialog>
        <DialogTrigger>查看正文</DialogTrigger>
        <DialogFrame variant="reading">
          <DialogTitle>生成正文</DialogTitle>
          <DialogDescription>查看完整生成结果</DialogDescription>
          <DialogBody>
            <p>第一段正文</p>
          </DialogBody>
        </DialogFrame>
      </Dialog>,
    )
    const trigger = screen.getByRole('button', { name: '查看正文' })
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: '生成正文' })).toHaveTextContent('第一段正文')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })
})
