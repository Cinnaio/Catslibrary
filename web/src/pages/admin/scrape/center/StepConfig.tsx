// ============================================================
// 抓取中心 · 第三步 —— 抓取配置（折叠摘要 / 高级配置 / 选择器测试）
// consumers: scrape/CenterView.tsx
// ============================================================
import { useId } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { CheckItem, ConfigRow } from '../types'
import ScrapeChecks from './ScrapeChecks'
import ScrapeDisclosure from './ScrapeDisclosure'
import ScrapeField from './ScrapeField'

export interface Selectors {
  chapterList: string
  chapterTitle: string
  chapterContent: string
  nextPage: string
}

export interface TestResult {
  loading: boolean
  empty?: boolean
  error?: string
  data: Record<string, any> | null
}

interface StepConfigProps {
  summary: ConfigRow[]
  advancedOpen: boolean
  onToggleAdvanced: () => void
  sitePreset: string
  onSitePresetChange: (value: string) => void
  chapterListUrl: string
  onChapterListUrlChange: (value: string) => void
  encoding: string
  onEncodingChange: (value: string) => void
  selectors: Selectors
  onSelectorsChange: (next: Selectors) => void
  testResult: TestResult
  testChecks: CheckItem[]
  onTest: () => void
  onStart: () => void
}

const SELECTOR_FIELDS: Array<{ key: keyof Selectors; label: string; placeholder: string }> = [
  { key: 'chapterList', label: '章节列表', placeholder: '.chapter-list a' },
  { key: 'chapterTitle', label: '章节标题', placeholder: 'h1' },
  { key: 'chapterContent', label: '章节内容', placeholder: '#content' },
  { key: 'nextPage', label: '下一页', placeholder: '.next a (可选)' },
]

export default function StepConfig({
  summary,
  advancedOpen,
  onToggleAdvanced,
  sitePreset,
  onSitePresetChange,
  chapterListUrl,
  onChapterListUrlChange,
  encoding,
  onEncodingChange,
  selectors,
  onSelectorsChange,
  testResult,
  testChecks,
  onTest,
  onStart,
}: StepConfigProps) {
  const advancedId = useId()
  const links: Array<{ text?: string; href: string }> = testResult.data?.links || []

  return (
    <section className="admin-panel-card scrape-step">
      <span className="scrape-step__label">第三步</span>
      <h3 className="m-0 text-base font-semibold tracking-tight text-foreground md:text-lg">抓取配置</h3>

      {!advancedOpen && summary.length > 0 && (
        <dl className="scrape-summary text-xs">
          {summary.map(([key, value]) => (
            <div className="scrape-summary__row" key={key}>
              <dt>{key}</dt>
              <dd title={value}>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      <ScrapeDisclosure open={advancedOpen} onToggle={onToggleAdvanced} controls={advancedId}>
        高级配置
      </ScrapeDisclosure>

      {advancedOpen && (
        <div id={advancedId} className="grid gap-3">
          <Tabs value={sitePreset} onValueChange={onSitePresetChange}>
            <TabsList>
              <TabsTrigger value="po18">PO18</TabsTrigger>
              <TabsTrigger value="custom">自定义</TabsTrigger>
            </TabsList>
          </Tabs>

          <ScrapeField label="章节列表页 URL">
            {({ id }) => <Input id={id} type="url" value={chapterListUrl} onChange={(e) => onChapterListUrlChange(e.target.value)} />}
          </ScrapeField>

          <ScrapeField label="编码">
            {({ id }) => <Input id={id} value={encoding} placeholder="utf-8 / gbk" onChange={(e) => onEncodingChange(e.target.value)} />}
          </ScrapeField>

          <fieldset className="scrape-step__fieldset">
            <legend className="text-sm font-semibold text-secondary-foreground">选择器配置</legend>
            <div className="grid gap-3 md:grid-cols-2">
              {SELECTOR_FIELDS.map((f) => (
                <ScrapeField label={f.label} key={f.key}>
                  {({ id }) => (
                    <Input
                      id={id}
                      placeholder={f.placeholder}
                      value={selectors[f.key]}
                      onChange={(e) => onSelectorsChange({ ...selectors, [f.key]: e.target.value })}
                    />
                  )}
                </ScrapeField>
              ))}
            </div>
          </fieldset>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={onTest}>
          测试选择器
        </Button>
        <Button size="sm" className="ml-auto" onClick={onStart}>
          开始抓取
        </Button>
      </div>

      {(testResult.loading || testResult.data || testResult.empty || testResult.error) && (
        <div className="scrape-feedback text-sm" role="status">
          {testResult.loading ? (
            <div className="flex items-center gap-2">
              <div className="spinner"></div>
              <span className="text-muted-foreground">正在测试选择器…</span>
            </div>
          ) : links.length > 0 ? (
            <>
              <Badge className="bg-success/10 text-success">测试成功 — 找到 {links.length} 个章节链接</Badge>
              <ul className="scrape-feedback__links text-xs">
                {links.slice(0, 20).map((l, i) => (
                  <li key={i}>
                    {l.text || l.href} → <span className="text-muted-foreground">{l.href}</span>
                  </li>
                ))}
                {links.length > 20 && <li className="text-muted-foreground">…还有 {links.length - 20} 个</li>}
              </ul>
            </>
          ) : testResult.empty ? (
            <Badge variant="secondary">未找到任何链接，请检查选择器</Badge>
          ) : testResult.error ? (
            <div className="font-medium text-destructive">测试失败: {testResult.error}</div>
          ) : null}
        </div>
      )}

      <ScrapeChecks items={testChecks} />
    </section>
  )
}
