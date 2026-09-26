/**
 * 阶段二回归网：长文本截断后的完整值可达、空状态的分层信息、缺省表达。
 * 这些都靠「DOM 上有、视觉上被裁掉」的约定工作，肉眼复核容易漏，
 * 因此把契约固定成断言。
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AdminCellText, AdminMetricStrip, AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import AdminEmptyState from '@/components/admin/AdminEmptyState'

describe('AdminCellText', () => {
  const LONG_TITLE = '穿成反派他娘后我靠种田养崽苟活于乱世并为原著女主撑起一片天的那些年'

  it('完整值挂在 title 上，鼠标悬停可读到被裁掉的全文', () => {
    render(<AdminCellText>{LONG_TITLE}</AdminCellText>)
    expect(screen.getByTitle(LONG_TITLE)).toBeInTheDocument()
  })

  it('被截断时读屏仍能拿到完整文本', () => {
    render(<AdminCellText>{LONG_TITLE}</AdminCellText>)
    // 视觉层截断 + sr-only 补全：可见文本与读屏文本都是完整的，
    // 不能出现只有省略号而丢失信息的情况
    expect(screen.getByTitle(LONG_TITLE).textContent).toContain(LONG_TITLE)
    expect(screen.getByTitle(LONG_TITLE)).toHaveTextContent('完整')
  })

  it('strong 变体加主字段类名，供字号档位选择', () => {
    render(<AdminCellText strong>书名</AdminCellText>)
    expect(screen.getByTitle('书名')).toHaveClass('admin-cell-text--strong')
  })

  it('空值不会被渲染成空白（占位符仍是字符串，title 不为 undefined）', () => {
    render(<AdminCellText>—</AdminCellText>)
    const el = screen.getByTitle('—')
    expect(el).toBeInTheDocument()
    expect(el).not.toHaveAttribute('title', 'undefined')
  })
})

describe('AdminEmptyState', () => {
  it('hint 提供「为什么空 / 下一步」，与结论分层显示', () => {
    render(
      <AdminEmptyState
        message="暂无抓取任务"
        hint="从「爬虫抓取」提交一个链接或搜索书名。"
        action={<button>去抓取</button>}
      />,
    )
    expect(screen.getByText('暂无抓取任务')).toHaveClass('admin-empty-state__message')
    expect(screen.getByText(/从「爬虫抓取」提交/)).toHaveClass('admin-empty-state__hint')
    expect(screen.getByRole('button', { name: '去抓取' })).toBeInTheDocument()
  })

  it('不传 hint 时不渲染空段落', () => {
    const { container } = render(<AdminEmptyState message="暂无数据" />)
    expect(container.querySelector('.admin-empty-state__hint')).toBeNull()
    expect(screen.getByText('暂无数据')).toBeInTheDocument()
  })
})

describe('AdminPanelHeading 与指标条的字阶层级', () => {
  it('小节标题与面板描述各自成段，层级不被压平', () => {
    render(<AdminPanelHeading title="最近抓取任务" description="按更新时间" />)
    expect(screen.getByRole('heading', { name: '最近抓取任务' })).toBeInTheDocument()
    expect(screen.getByText('按更新时间')).toBeInTheDocument()
  })

  it('指标条把标签、数值、单位分成三个独立元素（供档位分别取值）', () => {
    render(<AdminMetricStrip items={[{ label: '小说总数', value: '1,024', detail: '本' }]} />)
    const item = screen.getByText('小说总数').closest('.admin-metric-strip__item')!
    expect(item.querySelector('span')).toHaveTextContent('小说总数')
    expect(item.querySelector('strong')).toHaveTextContent('1,024')
    expect(item.querySelector('small')).toHaveTextContent('本')
  })
})
