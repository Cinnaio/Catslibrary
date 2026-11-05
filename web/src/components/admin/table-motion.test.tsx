import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import AccountAuditPanel, { type LoginAudit } from '@/pages/admin/AccountAuditPanel'
const motionCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../styles/admin/components/table-motion.css'), 'utf8')

let stylesheet: HTMLStyleElement
beforeEach(() => {
  stylesheet = document.createElement('style')
  stylesheet.textContent = motionCss
  document.head.append(stylesheet)
})
afterEach(() => stylesheet.remove())

function rowRules(rules: CSSRuleList, animation: string): CSSStyleRule[] {
  return Array.from(rules).filter((rule): rule is CSSStyleRule => rule instanceof CSSStyleRule && rule.style.animation?.includes(animation))
}

function panel(count: number, limit = count) {
  const records: LoginAudit[] = Array.from({ length: count }, (_, index) => ({
    id: `login-${index}`,
    userId: `user-${index}`,
    username: `reader-${index}`,
    displayName: `读者 ${index}`,
    status: 'success',
    reason: 'login',
    ipAddress: '',
    userAgent: '',
    createdAt: 1793880000000,
  }))
  return (
    <AccountAuditPanel
      kind="login"
      records={records}
      total={count}
      loading={false}
      status="all"
      onStatus={vi.fn()}
      onRefresh={vi.fn()}
      page={1}
      limit={limit}
      onPage={vi.fn()}
      onLimit={vi.fn()}
      statusLabel={() => '成功'}
    />
  )
}

describe('后台整页行入场动效', () => {
  it.each([15, 20, 50, 100])('每页 %i 条时所有数据行都命中生产动效样式，延迟不超过 240ms', (count) => {
    const { container } = render(panel(count))
    const rows = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody > tr'))
    const enterRules = rowRules(stylesheet.sheet!.cssRules, 'admin-tab-row-enter')
    expect(rows).toHaveLength(count)
    const delays = rows.map((row) => {
      expect(enterRules.some((rule) => row.matches(rule.selectorText))).toBe(true)
      return Number.parseFloat(row.style.animationDelay)
    })
    expect(delays.every((delay, index) => delay > 0 && delay <= 240 && (index === 0 || delay > delays[index - 1]!))).toBe(true)
    expect(delays.at(-1)).toBe(240)

    // 同一份生产 CSS 的减少动态规则也必须覆盖第 9 行至第 100 行。
    const reduced = Array.from(stylesheet.sheet!.cssRules).find(
      (rule) => 'conditionText' in rule && String(rule.conditionText).includes('prefers-reduced-motion'),
    ) as CSSMediaRule
    const reducedRules = rowRules(reduced.cssRules, 'none')
    expect(rows.every((row) => reducedRules.some((rule) => row.matches(rule.selectorText)))).toBe(true)
  })

  it('更改每页数量会重建表体，相同数据的后台刷新保留表体', () => {
    const view = render(panel(15))
    const original = view.container.querySelector('tbody')
    view.rerender(panel(15))
    expect(view.container.querySelector('tbody')).toBe(original)
    view.rerender(panel(15, 100))
    expect(view.container.querySelector('tbody')).not.toBe(original)
  })

  it('跨列详情和空态不占用数据行入场，详情展开不改变后面行的延迟', () => {
    const { container } = render(panel(20))
    const body = container.querySelector('tbody')!
    const row = body.rows[10]!
    const delay = row.style.animationDelay
    const details = document.createElement('tr')
    details.dataset.slot = 'table-row'
    const cell = details.insertCell()
    cell.dataset.slot = 'table-cell'
    cell.colSpan = 5
    row.before(details)
    const enterRules = rowRules(stylesheet.sheet!.cssRules, 'admin-tab-row-enter')
    expect(enterRules.some((rule) => details.matches(rule.selectorText))).toBe(false)
    expect(enterRules.some((rule) => row.matches(rule.selectorText))).toBe(true)
    expect(row.style.animationDelay).toBe(delay)
  })
})
