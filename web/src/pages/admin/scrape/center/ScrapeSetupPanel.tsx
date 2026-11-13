import { MotionDetails, MotionPresence } from '@/components/ui/motion'
import { useId, useState } from 'react'
import { ArrowRight, ChevronDown, ExternalLink, FlaskConical, RotateCcw } from 'lucide-react'
import type { ContentRating } from '@shared/types'
import SearchSelect from "@/components/shared/SearchSelect"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { CheckItem, DiscoverNovel } from '../types'
import ScrapeChecks from './ScrapeChecks'
import type { Selectors, TestResult } from './StepConfig'
import ScrapeField from './ScrapeField'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import { Spinner } from '@/components/ui/spinner'
import styles from '../workbench.module.css'
import { InlineError } from '@/components/shared/AsyncStates'

export interface SetupPreview {
  title: string
  author: string
  category: string
  status: string
  contentRating: ContentRating
  description: string
  coverUrl: string
}

interface ScrapeSetupPanelProps {
  item: DiscoverNovel
  preview: SetupPreview
  onPreviewChange: (next: SetupPreview) => void
  coverUrl: string
  novelId: string
  confirming: boolean
  starting: boolean
  started: boolean
  advancedOpen: boolean
  onToggleAdvanced: () => void
  /** 智能分析得到的可抓取章节数。统计失败时为 0，界面显示为「—」。 */
  chapterCount: number
  /** 章节数只是目录前几页的统计（长目录书）。 */
  hasMoreChapters: boolean
  /** 需订购/购买才能读取正文的章节数。 */
  protectedChapterCount: number
  chapterListUrl: string
  onChapterListUrlChange: (value: string) => void
  encoding: string
  onEncodingChange: (value: string) => void
  selectors: Selectors
  onSelectorsChange: (next: Selectors) => void
  testResult: TestResult
  testChecks: CheckItem[]
  onTest: () => void
  onConfirm: () => void
  onStart: () => void
  onReset: () => void
}

const STATUS_OPTIONS = [
  { value: 'ongoing', label: '连载中' },
  { value: 'completed', label: '已完结' },
]

/**
 * 内容分级选项。顺序刻意把「未标注」放在首位并作为默认值：
 * 抓取时默认是「未标注」。保存时服务端会用标签和文本规则做初判；
 * 未命中的仍为未标注，绝不自动标成「一般」。
 */
const CONTENT_RATING_OPTIONS = [
  { value: 'unknown', label: '未标注' },
  { value: 'general', label: '一般' },
  { value: 'restricted', label: '限制级' },
]

const SELECTOR_FIELDS: Array<{ key: keyof Selectors; label: string; placeholder: string }> = [
  { key: 'chapterList', label: '章节链接', placeholder: '.chapter-list a' },
  { key: 'chapterTitle', label: '章节标题', placeholder: 'h1' },
  { key: 'chapterContent', label: '章节正文', placeholder: '#content' },
  { key: 'nextPage', label: '下一页', placeholder: '.next a（可选）' },
]

export default function ScrapeSetupPanel({
  item, preview, onPreviewChange, coverUrl, novelId, confirming, starting, started,
  advancedOpen, onToggleAdvanced, chapterCount, hasMoreChapters, protectedChapterCount,
  chapterListUrl, onChapterListUrlChange,
  encoding, onEncodingChange, selectors, onSelectorsChange, testResult, testChecks,
  onTest, onConfirm, onStart, onReset,
}: ScrapeSetupPanelProps) {
  const advancedId = useId()
  const metadataId = useId()
  const [attemptedSave, setAttemptedSave] = useState(false)
  const [metadataOpen, setMetadataOpen] = useState(!preview.title.trim() || !preview.author.trim())
  const [failedCover, setFailedCover] = useState('')
  const links: Array<{ text?: string; href: string }> = testResult.data?.links || []
  const chapterText = chapterCount > 0 ? `${chapterCount}${hasMoreChapters ? '+' : ''}` : '尚未确认'
  const busy = confirming || starting
  const canStart = Boolean(chapterListUrl.trim() && selectors.chapterList.trim() && selectors.chapterContent.trim())

  function saveOrStart() {
    if (busy || started) return
    if (novelId) onStart()
    else {
      setAttemptedSave(true)
      if (!preview.title.trim() || !preview.author.trim()) setMetadataOpen(true)
      onConfirm()
    }
  }

  return (
    <div className={styles.setup} aria-label="作品与章节配置">
      <div className={styles.book}>
        <div className={styles.cover}>
          <span aria-hidden="true">{(preview.title || item.title || '书').slice(0, 1)}</span>
          {coverUrl && failedCover !== coverUrl && <img src={coverUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailedCover(coverUrl)} />}
        </div>
        <div className={styles.bookInfo}>
          <div className={styles.bookTitle}>
            <h3>{preview.title || item.title || '待确认作品'}</h3>
            <AdminStatusBadge tone={novelId ? 'success' : 'muted'}>{novelId ? '已保存至书库' : '待导入'}</AdminStatusBadge>
          </div>
          <p className={styles.hint}>
            {preview.author || item.author || '未知作者'} · {preview.status === 'completed' ? '已完结' : '连载中'} · {CONTENT_RATING_OPTIONS.find((option) => option.value === preview.contentRating)?.label || '未标注'}
          </p>
          <p className={styles.hint}>
            检测章节：{chapterText}{chapterCount > 0 ? ' 章' : ''}
            {protectedChapterCount > 0 ? `，其中 ${protectedChapterCount} 章需要账号读取权限` : ''}
          </p>
          <a href={item.url} target="_blank" rel="noreferrer" className={styles.source} title={item.url}>
            <span>{item.url}</span><ExternalLink className="size-3.5" aria-hidden="true" />
          </a>
          {preview.description && <p className={styles.description}>{preview.description}</p>}
        </div>
        <Button variant="ghost" onClick={onReset} disabled={busy || testResult.loading}>
          <RotateCcw aria-hidden="true" />{started ? '导入下一本' : '更换作品'}
        </Button>
      </div>

      <section className={styles.fold} aria-label="作品信息">
        <div className={styles.foldHeading}>
          <Button variant="ghost" className={styles.foldButton} onClick={() => setMetadataOpen((open) => !open)} aria-expanded={metadataOpen} aria-controls={metadataId}>
            <ChevronDown className={`${styles.chevron} ${metadataOpen ? styles.chevronOpen : ''}`} aria-hidden="true" />
            {novelId ? '已保存的作品信息' : '编辑作品信息'}
          </Button>
          <span className={styles.foldAside}>书名、作者、分类与分级</span>
        </div>
        <MotionPresence asChild open={metadataOpen} mode="disclosure"><div id={metadataId} className={styles.foldBody}>
          <fieldset className={styles.metadata} disabled={Boolean(novelId) || busy}>
            <div className={styles.fields}>
              <ScrapeField label="书名" error={attemptedSave && !preview.title.trim() ? '请填写书名' : undefined}>{({ id }) => <Input id={id} value={preview.title} onChange={(event) => onPreviewChange({ ...preview, title: event.target.value })} />}</ScrapeField>
              <ScrapeField label="作者" error={attemptedSave && !preview.author.trim() ? '请填写作者' : undefined}>{({ id }) => <Input id={id} value={preview.author} onChange={(event) => onPreviewChange({ ...preview, author: event.target.value })} />}</ScrapeField>
              <ScrapeField label="分类">{({ id }) => <Input id={id} value={preview.category} placeholder="多个分类用逗号分隔" onChange={(event) => onPreviewChange({ ...preview, category: event.target.value })} />}</ScrapeField>
              <ScrapeField label="状态">{({ labelId }) => <SearchSelect aria-labelledby={labelId} options={STATUS_OPTIONS} value={preview.status} disabled={Boolean(novelId) || busy} onChange={(value) => onPreviewChange({ ...preview, status: value })} />}</ScrapeField>
              <ScrapeField label="内容分级">{({ labelId }) => <SearchSelect aria-labelledby={labelId} options={CONTENT_RATING_OPTIONS} value={preview.contentRating} disabled={Boolean(novelId) || busy} onChange={(value) => onPreviewChange({ ...preview, contentRating: value as ContentRating })} />}</ScrapeField>
              <ScrapeField label="简介" className={styles.wide}>{({ id }) => <Textarea id={id} rows={3} value={preview.description} onChange={(event) => onPreviewChange({ ...preview, description: event.target.value })} />}</ScrapeField>
            </div>
          </fieldset>
          {novelId && <p className={styles.hint}>作品信息已保存，后续可到作品库编辑。</p>}
        </div></MotionPresence>
      </section>

      <section className={styles.fold} aria-label="章节规则与校验">
        <div className={styles.foldHeading}>
          <Button variant="ghost" className={styles.foldButton} onClick={onToggleAdvanced} aria-expanded={advancedOpen} aria-controls={advancedId}>
            <ChevronDown className={`${styles.chevron} ${advancedOpen ? styles.chevronOpen : ''}`} aria-hidden="true" />
            章节规则与校验
          </Button>
        </div>
        {!canStart && !advancedOpen && <p className={`${styles.hint} ${styles.danger}`}>章节来源或选择器不完整，请展开补充后启动。</p>}
        <MotionPresence asChild open={advancedOpen} mode="disclosure"><div id={advancedId} className={styles.config}>
            <fieldset className={`${styles.metadata} ${styles.ruleFields}`} disabled={busy || started || testResult.loading}>
              <div className={styles.sourceFields}>
                <ScrapeField label="章节列表页 URL">{({ id }) => <Input id={id} type="url" value={chapterListUrl} onChange={(event) => onChapterListUrlChange(event.target.value)} />}</ScrapeField>
                <ScrapeField label="编码">{({ id }) => <Input id={id} value={encoding} placeholder="utf-8 / gbk" onChange={(event) => onEncodingChange(event.target.value)} />}</ScrapeField>
              </div>
              <div className={styles.fields}>
                {SELECTOR_FIELDS.map((field) => (
                  <ScrapeField label={field.label} key={field.key}>{({ id }) => <Input id={id} placeholder={field.placeholder} value={selectors[field.key]} onChange={(event) => onSelectorsChange({ ...selectors, [field.key]: event.target.value })} />}</ScrapeField>
                ))}
              </div>
            </fieldset>
            <div className={styles.controls}>
              <Button variant="outline" onClick={onTest} disabled={busy || started || testResult.loading || !chapterListUrl.trim() || !selectors.chapterList.trim()}>
                {testResult.loading ? <Spinner size="sm" aria-hidden="true" /> : <FlaskConical aria-hidden="true" />}
                {testResult.loading ? '正在测试…' : '测试章节选择器'}
              </Button>
              <span className={styles.hint}>检查目录链接与样章正文，受保护章节仍需实际读取权限。</span>
            </div>
            {testResult.loading && <p className={styles.loadingLine} role="status"><Spinner size="sm" aria-hidden="true" />正在读取目录与样章…</p>}
            {testResult.error && <InlineError message={testResult.error} onRetry={onTest} />}
            {testResult.empty && <p className={`${styles.hint} ${styles.danger}`} role="status">没有找到章节链接，请检查目录地址和章节链接选择器。</p>}
            {testResult.data && !testResult.loading && <div className={styles.checkResults} role="status">
              <ScrapeChecks items={testChecks} />
              {links.length > 0 && <MotionDetails className={styles.sampleLinks}>
                <summary>查看章节链接样本（前 {Math.min(8, links.length)} 个）</summary>
                <ol tabIndex={0} aria-label="章节链接样本">{links.slice(0, 8).map((link, index) => <li key={index}><a href={link.href} target="_blank" rel="noreferrer">{link.text || link.href}</a></li>)}</ol>
              </MotionDetails>}
            </div>}
          </div></MotionPresence>
      </section>

      <div className={styles.actions}>
        <p className={styles.hint} role="status">
          {started ? '任务已启动，可在下方查看进度，离开页面后仍会继续。' : novelId ? '作品已保存，核对章节规则后即可启动抓取。' : '先保存作品信息，再启动章节抓取任务。'}
        </p>
        <Button onClick={saveOrStart} disabled={busy || started || testResult.loading || (Boolean(novelId) && !canStart)}>
          {busy && <Spinner size="sm" aria-hidden="true" />}
          {confirming ? '保存中…' : starting ? '启动中…' : started ? '任务已启动' : novelId ? '开始抓取' : '保存作品并继续'}
          {!busy && !started && <ArrowRight aria-hidden="true" />}
        </Button>
      </div>
    </div>
  )
}
