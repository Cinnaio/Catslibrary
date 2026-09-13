import { useId } from 'react'
import { Check, ChevronDown, FlaskConical, RotateCcw, Settings2 } from 'lucide-react'
import CustomSelect from '@/components/admin/CustomSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import type { CheckItem, ConfigRow, DiscoverNovel } from '../types'
import ScrapeChecks from './ScrapeChecks'
import type { Selectors, TestResult } from './StepConfig'
import ScrapeField from './ScrapeField'

export interface SetupPreview {
  title: string
  author: string
  category: string
  status: string
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
  advancedOpen: boolean
  onToggleAdvanced: () => void
  summary: ConfigRow[]
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
  onConfirm: () => void
  onStart: () => void
  onReset: () => void
}

const STATUS_OPTIONS = [
  { value: 'ongoing', label: '连载中' },
  { value: 'completed', label: '已完结' },
]

const SELECTOR_FIELDS: Array<{ key: keyof Selectors; label: string; placeholder: string }> = [
  { key: 'chapterList', label: '章节链接', placeholder: '.chapter-list a' },
  { key: 'chapterTitle', label: '章节标题', placeholder: 'h1' },
  { key: 'chapterContent', label: '章节正文', placeholder: '#content' },
  { key: 'nextPage', label: '下一页', placeholder: '.next a（可选）' },
]

export default function ScrapeSetupPanel({
  item,
  preview,
  onPreviewChange,
  coverUrl,
  novelId,
  confirming,
  advancedOpen,
  onToggleAdvanced,
  summary,
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
  onConfirm,
  onStart,
  onReset,
}: ScrapeSetupPanelProps) {
  const advancedId = useId()
  const showCover = Boolean(coverUrl)
  const links: Array<{ text?: string; href: string }> = testResult.data?.links || []

  return (
    <section className="admin-panel-card scrape-setup" aria-labelledby="scrape-setup-title">
      <div className="scrape-setup__heading">
        <div>
          <h3 id="scrape-setup-title">确认作品并配置章节</h3>
          <p>先保存书籍信息，再测试章节选择器。所有修改只会在点击启动后写入抓取任务。</p>
        </div>
        <Button variant="ghost" size="sm" onClick={onReset}>
          <RotateCcw aria-hidden="true" />
          换一本
        </Button>
      </div>

      <div className="scrape-setup__book">
        <div className={`scrape-setup__cover${showCover ? '' : ' is-empty'}`} data-letter={(preview.title || item.title || '书').slice(0, 1)}>
          {showCover && (
            <img
              src={coverUrl}
              alt=""
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
                event.currentTarget.parentElement?.classList.add('is-empty')
              }}
            />
          )}
        </div>
        <div className="scrape-setup__book-copy">
          <div className="scrape-setup__book-title">{preview.title || item.title || '待确认作品'}</div>
          <div className="scrape-setup__book-source">
            {preview.author || item.author || '未知作者'} · {item.url}
          </div>
          <div className="scrape-setup__book-badges">
            <Badge variant="outline">待导入</Badge>
            {preview.status && (
              <Badge className={preview.status === 'completed' ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning'}>
                {preview.status === 'completed' ? '已完结' : '连载中'}
              </Badge>
            )}
            {novelId && (
              <Badge className="bg-success/10 text-success">
                <Check aria-hidden="true" />
                已保存
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="scrape-setup__fields">
        <ScrapeField label="书名">
          {({ id }) => <Input id={id} value={preview.title} onChange={(event) => onPreviewChange({ ...preview, title: event.target.value })} />}
        </ScrapeField>
        <ScrapeField label="作者">
          {({ id }) => <Input id={id} value={preview.author} onChange={(event) => onPreviewChange({ ...preview, author: event.target.value })} />}
        </ScrapeField>
        <ScrapeField label="分类">
          {({ id }) => (
            <Input
              id={id}
              value={preview.category}
              placeholder="玄幻, 修真"
              onChange={(event) => onPreviewChange({ ...preview, category: event.target.value })}
            />
          )}
        </ScrapeField>
        <ScrapeField label="状态">
          {({ labelId }) => (
            <CustomSelect
              aria-labelledby={labelId}
              options={STATUS_OPTIONS}
              value={preview.status}
              onChange={(value) => onPreviewChange({ ...preview, status: value })}
            />
          )}
        </ScrapeField>
        <ScrapeField label="简介" className="scrape-setup__field--wide">
          {({ id }) => (
            <Textarea
              id={id}
              className="scrape-setup__description"
              value={preview.description}
              onChange={(event) => onPreviewChange({ ...preview, description: event.target.value })}
            />
          )}
        </ScrapeField>
      </div>

      <div className="scrape-setup__save-row">
        <Button onClick={onConfirm} disabled={confirming || Boolean(novelId)}>
          {confirming ? '保存中…' : novelId ? '书籍已保存' : '保存书籍并继续'}
        </Button>
        {!novelId && <span>保存后才能启动章节抓取任务</span>}
      </div>

      <div className="scrape-setup__config">
        <div className="scrape-setup__config-heading">
          <div>
            <h4>
              <Settings2 aria-hidden="true" />
              章节配置
            </h4>
            <p>智能分析已经填入初始值；只有源站结构特殊时才需要展开修改。</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onToggleAdvanced} aria-expanded={advancedOpen} aria-controls={advancedId}>
            {advancedOpen ? '收起高级配置' : '编辑选择器'} <ChevronDown className={advancedOpen ? 'rotate-180' : ''} aria-hidden="true" />
          </Button>
        </div>

        {!advancedOpen && summary.length > 0 && (
          <dl className="scrape-setup__summary">
            {summary.map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd title={value}>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {advancedOpen && (
          <div id={advancedId} className="scrape-setup__advanced">
            <div className="scrape-setup__preset-row">
              <span>选择器来源</span>
              <div className="scrape-setup__preset-tabs">
                <Button variant={sitePreset === 'po18' ? 'default' : 'secondary'} size="sm" onClick={() => onSitePresetChange('po18')}>
                  PO18 预设
                </Button>
                <Button variant={sitePreset === 'custom' ? 'default' : 'secondary'} size="sm" onClick={() => onSitePresetChange('custom')}>
                  自定义
                </Button>
              </div>
            </div>
            <div className="scrape-setup__config-fields">
              <ScrapeField label="章节列表页 URL" className="scrape-setup__field--wide">
                {({ id }) => <Input id={id} type="url" value={chapterListUrl} onChange={(event) => onChapterListUrlChange(event.target.value)} />}
              </ScrapeField>
              <ScrapeField label="编码">
                {({ id }) => <Input id={id} value={encoding} placeholder="utf-8 / gbk" onChange={(event) => onEncodingChange(event.target.value)} />}
              </ScrapeField>
            </div>
            <fieldset className="scrape-setup__fieldset">
              <legend>CSS 选择器</legend>
              <div className="scrape-setup__selector-grid">
                {SELECTOR_FIELDS.map((field) => (
                  <ScrapeField label={field.label} key={field.key}>
                    {({ id }) => (
                      <Input
                        id={id}
                        placeholder={field.placeholder}
                        value={selectors[field.key]}
                        onChange={(event) => onSelectorsChange({ ...selectors, [field.key]: event.target.value })}
                      />
                    )}
                  </ScrapeField>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        <div className="scrape-setup__test-row">
          <Button variant="secondary" onClick={onTest} disabled={!chapterListUrl.trim() || !selectors.chapterList.trim()}>
            <FlaskConical aria-hidden="true" />
            测试章节选择器
          </Button>
          <Button className="scrape-setup__start" onClick={onStart} disabled={!novelId || !selectors.chapterContent.trim()}>
            开始抓取
          </Button>
        </div>

        {(testResult.loading || testResult.data || testResult.empty || testResult.error) && (
          <div className="scrape-setup__test-result" role="status">
            {testResult.loading ? (
              <span>正在读取样章并检查选择器…</span>
            ) : links.length > 0 ? (
              <>
                <Badge className="bg-success/10 text-success">
                  <Check aria-hidden="true" />
                  测试通过 · {links.length} 个章节链接
                </Badge>
                <ul>
                  {links.slice(0, 8).map((link, index) => (
                    <li key={index}>{link.text || link.href}</li>
                  ))}
                </ul>
              </>
            ) : testResult.empty ? (
              <Badge variant="secondary">没有找到章节链接，请检查选择器</Badge>
            ) : testResult.error ? (
              <span className="text-destructive">测试失败：{testResult.error}</span>
            ) : null}
          </div>
        )}
        <ScrapeChecks items={testChecks} />
      </div>
    </section>
  )
}
