// ============================================================
// 抓取中心 · 第二步 —— 确认小说信息并创建
// consumers: scrape/CenterView.tsx
// ============================================================
import { useState } from 'react'
import CustomSelect from '@/components/admin/CustomSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import ScrapeField from './ScrapeField'

export interface NovelPreview {
  title: string
  author: string
  category: string
  status: string
  description: string
  coverUrl: string
}

interface StepConfirmProps {
  preview: NovelPreview
  onPreviewChange: (next: NovelPreview) => void
  coverUrl: string
  confirming: boolean
  novelId: string
  onConfirm: () => void
  onSkip: () => void
}

const STATUS_OPTIONS = [
  { value: 'ongoing', label: '连载中' },
  { value: 'completed', label: '已完结' },
]

export default function StepConfirm({ preview, onPreviewChange, coverUrl, confirming, novelId, onConfirm, onSkip }: StepConfirmProps) {
  const [coverBroken, setCoverBroken] = useState(false)
  const showCover = !!coverUrl && !coverBroken

  return (
    <section className="admin-panel-card scrape-step">
      <span className="scrape-step__label">第二步</span>
      <h3 className="m-0 text-base font-semibold tracking-tight text-foreground md:text-lg">确认信息并抓取</h3>

      <div className={showCover ? 'scrape-preview' : ''}>
        {showCover && (
          <div className="scrape-preview__cover">
            <img src={coverUrl} alt="" referrerPolicy="no-referrer" onError={() => setCoverBroken(true)} />
          </div>
        )}

        <div className="scrape-preview__form">
          <ScrapeField label="书名">
            {({ id }) => <Input id={id} value={preview.title} onChange={(e) => onPreviewChange({ ...preview, title: e.target.value })} />}
          </ScrapeField>

          <ScrapeField label="作者">
            {({ id }) => <Input id={id} value={preview.author} onChange={(e) => onPreviewChange({ ...preview, author: e.target.value })} />}
          </ScrapeField>

          <ScrapeField label="分类">
            {({ id }) => (
              <Input
                id={id}
                value={preview.category}
                placeholder="玄幻, 修真"
                onChange={(e) => onPreviewChange({ ...preview, category: e.target.value })}
              />
            )}
          </ScrapeField>

          <ScrapeField label="状态">
            {({ labelId }) => (
              <CustomSelect
                compact
                aria-labelledby={labelId}
                options={STATUS_OPTIONS}
                value={preview.status}
                onChange={(v) => onPreviewChange({ ...preview, status: v })}
              />
            )}
          </ScrapeField>

          <ScrapeField label="简介" className="scrape-preview__field--wide">
            {({ id }) => (
              <Textarea
                id={id}
                className="scrape-preview__description"
                value={preview.description}
                onChange={(e) => onPreviewChange({ ...preview, description: e.target.value })}
              />
            )}
          </ScrapeField>

          <div className="scrape-preview__actions">
            <Button onClick={onConfirm} disabled={confirming || !!novelId}>
              {confirming ? '创建中…' : '确认并创建小说'}
            </Button>
            <Button variant="secondary" onClick={onSkip} disabled={!!novelId}>
              跳过 (已有小说)
            </Button>
          </div>

          {novelId && (
            <p className="scrape-ready-note m-0 text-sm font-medium text-success" role="status">
              小说已就绪，ID: {novelId}
            </p>
          )}
        </div>
      </div>
    </section>
  )
}
