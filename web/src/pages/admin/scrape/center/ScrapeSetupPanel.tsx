import { useId } from 'react'
import { Check, ChevronDown, FlaskConical, RotateCcw, Settings2 } from 'lucide-react'
import type { ContentRating } from '@shared/types'
import CustomSelect from '@/components/admin/CustomSelect'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdminDataPanel, AdminPanelHeading } from '@/components/admin/AdminWorkspace'
import type { CheckItem, DiscoverNovel } from '../types'
import ScrapeChecks from './ScrapeChecks'
import type { Selectors, TestResult } from './StepConfig'
import ScrapeField from './ScrapeField'

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
  advancedOpen: boolean
  onToggleAdvanced: () => void
  /** 智能分析得到的可抓取章节数。统计失败时为 0，界面显示为「—」。 */
  chapterCount: number
  /** 章节数只是目录前几页的统计（长目录书）。 */
  hasMoreChapters: boolean
  /** 需订购/购买才能读取正文的章节数。 */
  protectedChapterCount: number
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

/** 选择器来源分段的激活层位移索引，与 TabsTrigger 顺序一致。 */
const PRESET_INDEX: Record<string, number> = {
  po18: 0,
  custom: 1,
}

export default function ScrapeSetupPanel({
  item,
  preview,
  onPreviewChange,
  coverUrl,
  novelId,
  confirming,
  advancedOpen,
  onToggleAdvanced,
  chapterCount,
  hasMoreChapters,
  protectedChapterCount,
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
  const chapterText = chapterCount > 0 ? `${chapterCount}${hasMoreChapters ? '+' : ''}` : '—'

  return (
    <AdminDataPanel className="scrape-setup" ariaLabel="作品与章节配置">
      <AdminPanelHeading
        className="scrape-setup__heading"
        title={<span id="scrape-setup-title">确认作品并配置章节</span>}
        description="先保存书籍信息，再测试章节选择器。所有修改只会在点击启动后写入抓取任务。"
        actions={
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcw aria-hidden="true" />
            换一本
          </Button>
        }
      />

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
        <ScrapeField label="内容分级">
          {({ labelId }) => (
            <CustomSelect
              aria-labelledby={labelId}
              options={CONTENT_RATING_OPTIONS}
              value={preview.contentRating}
              onChange={(value) => onPreviewChange({ ...preview, contentRating: value as ContentRating })}
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
          <div className="scrape-setup__config-copy">
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

        {advancedOpen && (
          <div id={advancedId} className="scrape-setup__advanced">
            <div className="scrape-setup__preset-row">
              <span>选择器来源</span>
              <Tabs value={sitePreset} onValueChange={onSitePresetChange} className="scrape-setup__preset-tabs">
                <TabsList aria-label="选择器来源" data-active-index={PRESET_INDEX[sitePreset] ?? 0}>
                  <TabsTrigger value="po18">PO18 预设</TabsTrigger>
                  <TabsTrigger value="custom">自定义</TabsTrigger>
                </TabsList>
              </Tabs>
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

        {/* 折叠态：只留两个决定「要不要现在抓」的数字和一个开始按钮。
            完整配置项（URL / 编码 / 选择器）平时不该占据视线——它们由智能分析
            填好，只有异常时才需要人介入。 */}
        <div className="scrape-setup__run">
          <dl className="scrape-setup__run-stats">
            <div className="scrape-setup__run-stat">
              <dt>可抓章节</dt>
              <dd>{chapterText}</dd>
            </div>
            <div className="scrape-setup__run-stat">
              <dt>受保护章节</dt>
              <dd className={protectedChapterCount > 0 ? 'is-warning' : undefined}>{protectedChapterCount}</dd>
            </div>
          </dl>
          <Button className="scrape-setup__start" onClick={onStart} disabled={!novelId || !selectors.chapterContent.trim()}>
            开始抓取
          </Button>
        </div>

        {/* 选择器测试与诊断只在展开高级配置（或已产出结果）时出现。
            折叠态把主操作留给「开始抓取」，避免次要动作争夺注意力。 */}
        {(advancedOpen || testResult.data || testResult.empty || testResult.error) && (
          <div className="scrape-setup__test-row">
            <Button variant="secondary" onClick={onTest} disabled={!chapterListUrl.trim() || !selectors.chapterList.trim()}>
              <FlaskConical aria-hidden="true" />
              测试章节选择器
            </Button>
          </div>
        )}

        {testResult.loading && (
          <div className="scrape-setup__test-result" role="status">
            <span>正在读取样章并检查选择器…</span>
          </div>
        )}

        {!testResult.loading && (testResult.data || testResult.empty || testResult.error) && (
          <div className="scrape-setup__test-result" role="status">
            {links.length > 0 ? (
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
    </AdminDataPanel>
  )
}
