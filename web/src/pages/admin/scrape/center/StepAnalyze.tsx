// ============================================================
// 抓取中心 · 第一步 —— 智能分析小说
// consumers: scrape/CenterView.tsx
// ============================================================
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { CheckItem } from '../types'
import ScrapeChecks from './ScrapeChecks'

interface StepAnalyzeProps {
  sourceUrl: string
  onSourceUrlChange: (value: string) => void
  analyzing: boolean
  result: { ok: boolean | null; text: string }
  checks: CheckItem[]
  onAnalyze: () => void
}

export default function StepAnalyze({ sourceUrl, onSourceUrlChange, analyzing, result, checks, onAnalyze }: StepAnalyzeProps) {
  return (
    <section className="admin-panel-card scrape-step">
      <span className="scrape-step__label">第一步</span>
      <h3 className="m-0 text-base font-semibold tracking-tight text-foreground md:text-lg">智能分析小说</h3>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="url"
          className="min-w-64 flex-1 admin-input--compact"
          aria-label="小说网址"
          placeholder="https://wap.po18x.vip/book/10075/"
          value={sourceUrl}
          onChange={(e) => onSourceUrlChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAnalyze()
          }}
        />
        <Button size="sm" onClick={onAnalyze} disabled={analyzing}>
          {analyzing ? '分析中…' : '智能分析'}
        </Button>
      </div>

      {(analyzing || result.ok !== null) && (
        <div className="scrape-feedback text-sm" role="status">
          {analyzing ? (
            <div className="flex items-center gap-2">
              <div className="spinner"></div>
              <span className="text-muted-foreground">正在获取页面信息，识别书名、作者…</span>
            </div>
          ) : (
            <div className={result.ok ? 'font-medium text-success' : 'font-medium text-destructive'}>{result.text}</div>
          )}
        </div>
      )}

      <ScrapeChecks items={checks} />
    </section>
  )
}
