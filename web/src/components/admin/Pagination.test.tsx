import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import Pagination from './Pagination'
import { ADMIN_DEFAULT_PAGE_SIZE, ADMIN_PAGE_SIZE_OPTIONS } from '@/lib/admin-pagination'

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver
}
Element.prototype.scrollIntoView = () => undefined
// Radix Select 在 jsdom 下需要此补丁，否则展开下拉时抛 hasPointerCapture 未定义。
// 与 DraftRewrite.test.tsx 的既有做法一致。
Element.prototype.hasPointerCapture = () => false

describe('admin Pagination（后台统一分页）', () => {
  it('容器只使用 .admin-pagination 命名空间，不复用前台类名', () => {
    // 回归护栏：复用 .home-pagination 会让 home.css 的卡片表面规则漏进后台，
    // 表现为后台分页拿到前台 20px 圆角。两套必须分开。
    render(<Pagination page={2} totalPages={5} onPage={() => {}} />)
    const root = document.querySelector('.admin-pagination')
    expect(root).not.toBeNull()
    expect(document.querySelector('.home-pagination')).toBeNull()
    expect(root?.className).not.toContain('home-pagination')
  })

  it('渲染页数、跳转框与前后翻页按钮', () => {
    render(<Pagination page={2} totalPages={5} onPage={() => {}} />)
    expect(screen.getByText('第 2 / 5 页')).toBeTruthy()
    expect(screen.getByRole('button', { name: '上一页' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '下一页' })).toBeTruthy()
    expect(screen.getByLabelText('跳转到指定页')).toBeTruthy()
  })

  it('首尾页禁用对应按钮', () => {
    const { unmount } = render(<Pagination page={1} totalPages={3} onPage={() => {}} />)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).not.toBeDisabled()
    unmount()

    render(<Pagination page={3} totalPages={3} onPage={() => {}} />)
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
  })

  it('跳转框输入合法页码即翻页，越界值被夹回范围内', async () => {
    const onPage = vi.fn()
    render(<Pagination page={2} totalPages={5} onPage={onPage} />)
    const input = screen.getByLabelText('跳转到指定页')

    fireEvent.change(input, { target: { value: '4' } })
    expect(onPage).toHaveBeenCalledWith(4)

    onPage.mockClear()
    // 超出上限：不触发（等失焦/回车再夹回），避免输入中间态就跳页
    fireEvent.change(input, { target: { value: '9' } })
    expect(onPage).not.toHaveBeenCalled()
  })

  it('busy 时禁用翻页按钮但不隐藏，避免布局跳动', () => {
    render(<Pagination page={2} totalPages={5} onPage={() => {}} busy />)
    expect(screen.getByRole('button', { name: '上一页' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '下一页' })).toBeDisabled()
    expect(screen.getByText('第 2 / 5 页')).toBeTruthy()
  })

  it('jump 框恒显示——不再提供关闭开关，避免再次分叉', () => {
    render(<Pagination page={1} totalPages={3} onPage={() => {}} />)
    expect(screen.getByLabelText('跳转到指定页')).toBeTruthy()
    expect(screen.getByText('第 1 / 3 页')).toBeTruthy()
  })

  it('有多页时渲染计数与翻页控件，并对齐为单一页脚形态', () => {
    render(<Pagination page={1} totalPages={3} onPage={() => {}} summary="共 30 条" />)
    const root = document.querySelector('.admin-pagination')
    expect(root).not.toBeNull()
    // 单一形态：不再有任何 --align-* / --footer 变体类
    expect(root?.className).toBe('admin-pagination')
    expect(screen.getByText('共 30 条')).toBeTruthy()
    expect(screen.getByText('第 1 / 3 页')).toBeTruthy()
  })

  it('传入 summary 与 pageSize 时渲染每页条数并可切换', async () => {
    const onPageSize = vi.fn()
    render(<Pagination page={1} totalPages={4} onPage={() => {}} summary={<>显示 1-25 / 100</>} pageSize={{ value: 25, onChange: onPageSize }} />)
    expect(screen.getByText('显示 1-25 / 100')).toBeTruthy()
    expect(screen.getByLabelText('每页显示数量')).toBeTruthy()

    await userEvent.click(screen.getByLabelText('每页显示数量'))
    await userEvent.click(await screen.findByRole('option', { name: '50 条' }))
    expect(onPageSize).toHaveBeenCalledWith(50)
  })

  it('单页且无计数/每页条数时整块不渲染', () => {
    const { container } = render(<Pagination page={1} totalPages={1} onPage={() => {}} />)
    expect(container.querySelector('.admin-pagination')).toBeNull()
  })

  it('单页但有计数时仍渲染（页脚需要显示总数与每页条数）', () => {
    render(<Pagination page={1} totalPages={1} onPage={() => {}} summary={<>共 3 条</>} pageSize={{ value: 25, onChange: () => {} }} />)
    expect(screen.getByText('共 3 条')).toBeTruthy()
    // 单页时不应出现翻页按钮，但页脚信息保留
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull()
  })

  /**
   * 全站默认每页条数契约。这些常量是后台所有列表页的唯一来源，
   * 一旦被改回 20/25/50，各页会静默回到分叉状态（历史上正是这样分叉的）。
   */
  it('默认每页 10 条，且档位为 10 / 20 / 50 / 100', () => {
    expect(ADMIN_DEFAULT_PAGE_SIZE).toBe(10)
    expect([...ADMIN_PAGE_SIZE_OPTIONS]).toEqual([10, 20, 50, 100])
  })

  it('未传 options 时下拉使用全站档位，且默认值 10 在可选档位内', async () => {
    render(<Pagination page={1} totalPages={5} onPage={() => {}} pageSize={{ value: ADMIN_DEFAULT_PAGE_SIZE, onChange: () => {} }} />)
    await userEvent.click(screen.getByLabelText('每页显示数量'))
    // 默认值必须在档位里，否则 Select 会显示空白
    expect(await screen.findByRole('option', { name: '10 条' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '20 条' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '50 条' })).toBeTruthy()
    expect(screen.getByRole('option', { name: '100 条' })).toBeTruthy()
  })
})
