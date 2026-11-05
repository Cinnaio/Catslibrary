import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog'
import { ControlAppearance } from '@/components/ui/control-appearance'
import FormField from './FormField'
import SearchSelect from './SearchSelect'
import TimeField from './TimeField'
import Pagination from './Pagination'
import { DialogBody, DialogFrame } from './DialogFrame'
import { SearchField } from './SearchField'
import { ConfirmProvider, useConfirm } from '@/components/feedback'

describe('共享字段的标签和描述契约', () => {
  it('说明和错误关联到主控件，移除错误后保留输入及自有说明', async () => {
    function Form() {
      const [value, setValue] = useState('')
      return (
        <>
          <p id="own-hint">原有说明</p>
          <FormField label="书名" hint="最多 30 字" error={value ? undefined : '请输入书名'}>
            <Input value={value} onChange={(event) => setValue(event.target.value)} aria-describedby="own-hint" />
          </FormField>
        </>
      )
    }
    render(<Form />)
    const input = screen.getByRole('textbox', { name: '书名' })
    expect(input).toHaveAccessibleDescription('原有说明 最多 30 字 请输入书名')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(input, '山海')
    expect(input).toHaveValue('山海')
    expect(input).not.toHaveAttribute('aria-invalid')
    expect(input).toHaveAccessibleDescription('原有说明 最多 30 字')
  })

  it('同名字段拥有独立 ID，辅助控件的显式 ID 不被覆盖', () => {
    render(
      <>
        <FormField label="来源">
          <Input />
          <Input id="auxiliary" aria-label="辅助来源" />
        </FormField>
        <FormField label="来源">
          <Input />
        </FormField>
      </>,
    )
    const inputs = screen.getAllByRole('textbox', { name: '来源' })
    expect(inputs).toHaveLength(2)
    expect(inputs[0]?.id).not.toBe(inputs[1]?.id)
    expect(screen.getByRole('textbox', { name: '辅助来源' })).toHaveAttribute('id', 'auxiliary')
  })

  it('标准选择器、可搜索选择器及搜索字段都有实际可访问名称', () => {
    render(
      <>
        <FormField label="分级" hint="选择可见范围">
          <Select>
            <SelectTrigger>
              <SelectValue placeholder="请选择" />
            </SelectTrigger>
          </Select>
        </FormField>
        <FormField label="模型" hint="可输入关键词">
          <SearchSelect options={[]} value="" onChange={() => {}} />
        </FormField>
        <SearchField label="搜索作品" />
      </>,
    )
    expect(screen.getByRole('combobox', { name: '分级' })).toHaveAccessibleDescription('选择可见范围')
    expect(screen.getByRole('combobox', { name: '模型' })).toHaveAccessibleDescription('可输入关键词')
    expect(screen.getByRole('searchbox', { name: '搜索作品' })).toBeInTheDocument()
  })

  it('时间字段的预设由使用方提供，禁用后关闭浮层并阻止再次操作', async () => {
    const onChange = vi.fn()
    const form = (disabled: boolean) => (
      <FormField label="执行时间" hint="本地时间">
        <TimeField value="12:15" presets={['03:00']} disabled={disabled} onChange={onChange} />
      </FormField>
    )
    const { rerender } = render(form(false))
    expect(screen.getByRole('button', { name: '执行时间' })).toHaveAccessibleDescription('本地时间')
    await userEvent.click(screen.getByRole('button', { name: '执行时间' }))
    await userEvent.click(screen.getByRole('button', { name: '03:00' }))
    expect(onChange).toHaveBeenCalledWith('03:00')
    rerender(form(true))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '执行时间' })).toBeDisabled()
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})

describe('共享布局与浮层契约', () => {
  it('全局确认服务采用调用方的外观，仍返回原有确认结果', async () => {
    const done = vi.fn()
    function Trigger() {
      const { confirm } = useConfirm()
      return (
        <button
          onClick={() => {
            void confirm({ title: '测试确认', message: '只是合成检查。' }).then(done)
          }}
        >
          打开确认
        </button>
      )
    }
    render(
      <ConfirmProvider>
        <ControlAppearance appearance="management">
          <Trigger />
        </ControlAppearance>
      </ConfirmProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: '打开确认' }))
    expect(screen.getByRole('alertdialog', { name: '测试确认' })).toHaveAttribute('data-ui', 'management')
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(done).toHaveBeenCalledWith(false)
  })
  it('外观上下文穿过 portal，Escape 关闭后焦点返回原入口', async () => {
    render(
      <ControlAppearance appearance="management">
        <Dialog>
          <DialogTrigger>查看详情</DialogTrigger>
          <DialogFrame>
            <DialogTitle>任务详情</DialogTitle>
            <DialogDescription>任务正文</DialogDescription>
            <DialogBody>已有结果</DialogBody>
          </DialogFrame>
        </Dialog>
      </ControlAppearance>,
    )
    const trigger = screen.getByRole('button', { name: '查看详情' })
    await userEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '任务详情' })).toHaveAttribute('data-ui', 'management')
    expect(screen.getByRole('dialog')).toHaveTextContent('已有结果')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('忙碌时分页保留读数并禁用翻页、跳转和页大小', async () => {
    const onPage = vi.fn(),
      onSize = vi.fn()
    render(<Pagination page={2} totalPages={4} onPage={onPage} pageSize={{ value: 15, onChange: onSize }} busy />)
    expect(screen.getByRole('navigation', { name: '分页' })).toHaveTextContent('第 2 / 4 页')
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    expect(screen.getByRole('spinbutton', { name: '跳转到指定页' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: '每页显示数量' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(onPage).not.toHaveBeenCalled()
    expect(onSize).not.toHaveBeenCalled()
  })

  it('公开页分页沿用受控页码，Enter 限制跳转边界且不同控件不互相串号', () => {
    const onPage = vi.fn()
    const { rerender } = render(<Pagination variant="plain" ariaLabel="书库分页" page={2} totalPages={4} onPage={onPage} />)
    const jump = screen.getByRole('spinbutton', { name: '跳转到指定页' })
    fireEvent.change(jump, { target: { value: '99' } })
    fireEvent.keyDown(jump, { key: 'Enter' })
    expect(onPage).toHaveBeenLastCalledWith(4)
    rerender(<Pagination variant="plain" ariaLabel="书库分页" page={3} totalPages={4} onPage={onPage} />)
    expect(jump).toHaveValue(3)
    expect(screen.getByRole('navigation', { name: '书库分页' })).toHaveTextContent('第 3 / 4 页')
  })
})
