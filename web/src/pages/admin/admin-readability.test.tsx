/**
 * 阶段二回归网：长文本截断后的完整值可达、空状态的分层信息、缺省表达。
 * 这些都靠「DOM 上有、视觉上被裁掉」的约定工作，肉眼复核容易漏，
 * 因此把契约固定成断言。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CellText } from '@/components/shared/CellText'
import { PanelHeading } from '@/components/shared/PanelHeading'
import EmptyState from "@/components/shared/EmptyState"

describe('CellText', () => {
  const LONG_TITLE = '穿成反派他娘后我靠种田养崽苟活于乱世并为原著女主撑起一片天的那些年'

  it('完整值挂在 title 上，鼠标悬停可读到被裁掉的全文', () => {
    render(<CellText>{LONG_TITLE}</CellText>)
    expect(screen.getByTitle(LONG_TITLE)).toBeInTheDocument()
  })

  it('被截断时读屏仍能拿到完整文本', () => {
    render(<CellText>{LONG_TITLE}</CellText>)
    // 视觉层截断 + sr-only 补全：可见文本与读屏文本都是完整的，
    // 不能出现只有省略号而丢失信息的情况
    expect(screen.getByTitle(LONG_TITLE).textContent).toContain(LONG_TITLE)
    expect(screen.getByTitle(LONG_TITLE)).toHaveTextContent('完整')
  })

  it('strong 变体加主字段类名，供字号档位选择', () => {
    render(<CellText strong>书名</CellText>)
    expect(screen.getByTitle('书名')).toHaveClass('cell-text--strong')
  })

  it('空值不会被渲染成空白（占位符仍是字符串，title 不为 undefined）', () => {
    render(<CellText>—</CellText>)
    const el = screen.getByTitle('—')
    expect(el).toBeInTheDocument()
    expect(el).not.toHaveAttribute('title', 'undefined')
  })
})

describe('EmptyState', () => {
  it('hint 提供「为什么空 / 下一步」，与结论分层显示', () => {
    render(
      <EmptyState
        message="暂无抓取任务"
        hint="从「爬虫抓取」提交一个链接或搜索书名。"
        action={<button>去抓取</button>}
      />,
    )
    expect(screen.getByText('暂无抓取任务')).toHaveClass('empty-state__message')
    expect(screen.getByText(/从「爬虫抓取」提交/)).toHaveClass('empty-state__hint')
    expect(screen.getByRole('button', { name: '去抓取' })).toBeInTheDocument()
  })

  it('不传 hint 时不渲染空段落', () => {
    const { container } = render(<EmptyState message="暂无数据" />)
    expect(container.querySelector('.empty-state__hint')).toBeNull()
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })
})

describe('PanelHeading 的字阶层级', () => {
  it('卡片标题区只呈现主标题', () => {
    const { container } = render(<PanelHeading title="最近抓取任务" />)
    expect(screen.getByRole('heading', { name: '最近抓取任务' })).toBeInTheDocument()
    expect(container.querySelector('.panel-heading__copy p')).toBeNull()
  })

})
