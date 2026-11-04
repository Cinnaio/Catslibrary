import { useId } from 'react'
import { ArrowRight, Check, ChevronDown, ExternalLink, FlaskConical, RefreshCw, RotateCcw } from 'lucide-react'
import type { ContentRating } from '@shared/types'
import SearchSelect from "@/components/shared/SearchSelect"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
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
    <div className="scrape-intake scrape-setup-card" aria-label="作品与章节配置">
      {/* 头部：完全对齐 Claude 标准卡片规范 */}
      <div className="scrape-intake-card__head">
        <div className="scrape-intake-card__title-group">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h2 id="scrape-setup-title" className="scrape-intake-card__title">
              确认作品并配置章节
            </h2>
            <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 border border-stone-200/80 dark:border-stone-700/80">
              {novelId ? '已录入书库' : '待录入核对'}
            </span>
          </div>
          <p className="scrape-intake-card__subtitle">
            智能分析已填入初始信息。保存书籍基础信息后，即可配置章节规则并启动抓取任务。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onReset}
            className="h-8 rounded-lg text-xs font-medium px-3 border-[#dedcd5] hover:border-[#d97757]/60 hover:text-[#c15f3d] dark:border-[#38352f] dark:hover:bg-[#25231f] transition-all cursor-pointer"
          >
            <RotateCcw className="size-3.5 mr-1.5" aria-hidden="true" />
            换一本
          </Button>
        </div>
      </div>

      {/* 书籍信息英雄预览区 */}
      <div className="scrape-setup-hero">
        <div
          className={`scrape-setup-hero__cover ${showCover ? '' : 'is-empty'}`}
          data-letter={(preview.title || item.title || '书').slice(0, 1)}
        >
          {showCover ? (
            <img
              src={coverUrl}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
                event.currentTarget.parentElement?.classList.add('is-empty')
              }}
            />
          ) : null}
        </div>

        <div className="flex flex-col gap-2 min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap min-w-0">
            <h3 className="font-serif text-lg font-semibold text-foreground tracking-tight m-0">
              {preview.title || item.title || '待确认作品'}
            </h3>
            {novelId ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/60">
                <Check className="size-3" aria-hidden="true" />
                已保存至书库
              </span>
            ) : (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300 border border-stone-200/80 dark:border-stone-700/80">
                待导入
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="font-medium text-stone-700 dark:text-stone-300">
              {preview.author || item.author || '未知作者'}
            </span>
            <span className="text-stone-300 dark:text-stone-700 select-none">·</span>
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-mono text-muted-foreground hover:text-[#D97757] transition-colors truncate max-w-full sm:max-w-md"
              title={item.url}
            >
              <span className="truncate">{item.url}</span>
              <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            </a>
          </div>

          <div className="flex items-center gap-2 flex-wrap pt-0.5">
            {preview.status && (
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border border-amber-200/70 dark:border-amber-800/60">
                {preview.status === 'completed' ? '已完结' : '连载中'}
              </span>
            )}
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-400 border border-stone-200/80 dark:border-stone-700/80">
              {preview.contentRating === 'restricted' ? '限制级' : preview.contentRating === 'general' ? '一般' : '未标注'}
            </span>
            {chapterCount > 0 && (
              <span className="text-xs text-stone-500 dark:text-stone-400">
                源站约 <span className="font-medium text-foreground">{chapterText}</span> 章
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 分区 1：作品基础信息编辑 */}
      <section className="scrape-setup-section" aria-labelledby="scrape-setup-metadata-title">
        <div className="scrape-setup-section__head">
          <div>
            <h3 id="scrape-setup-metadata-title" className="scrape-setup-section__title">
              作品基础信息
            </h3>
            <p className="scrape-setup-section__subtitle">
              智能分析已填入初始信息。保存前，可以在这里核对并修改。
            </p>
          </div>
          {novelId && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium inline-flex items-center gap-1">
              <Check className="size-3.5" aria-hidden="true" />
              基础信息已录入
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-1">
          <ScrapeField label="书名">
            {({ id }) => (
              <Input
                id={id}
                value={preview.title}
                onChange={(event) => onPreviewChange({ ...preview, title: event.target.value })}
                className="h-9 rounded-lg px-3 text-sm bg-background border-border/80 focus-visible:border-[#D97757]/80 focus-visible:ring-1 focus-visible:ring-[#D97757]/30 transition-colors"
              />
            )}
          </ScrapeField>
          <ScrapeField label="作者">
            {({ id }) => (
              <Input
                id={id}
                value={preview.author}
                onChange={(event) => onPreviewChange({ ...preview, author: event.target.value })}
                className="h-9 rounded-lg px-3 text-sm bg-background border-border/80 focus-visible:border-[#D97757]/80 focus-visible:ring-1 focus-visible:ring-[#D97757]/30 transition-colors"
              />
            )}
          </ScrapeField>
          <ScrapeField label="分类">
            {({ id }) => (
              <Input
                id={id}
                value={preview.category}
                placeholder="其他, 强制, np"
                onChange={(event) => onPreviewChange({ ...preview, category: event.target.value })}
                className="h-9 rounded-lg px-3 text-sm bg-background border-border/80 focus-visible:border-[#D97757]/80 focus-visible:ring-1 focus-visible:ring-[#D97757]/30 transition-colors"
              />
            )}
          </ScrapeField>
          <ScrapeField label="状态">
            {({ labelId }) => (
              <SearchSelect
                aria-labelledby={labelId}
                options={STATUS_OPTIONS}
                value={preview.status}
                onChange={(value) => onPreviewChange({ ...preview, status: value })}
                className="h-9 rounded-lg"
              />
            )}
          </ScrapeField>
          <ScrapeField label="内容分级">
            {({ labelId }) => (
              <SearchSelect
                aria-labelledby={labelId}
                options={CONTENT_RATING_OPTIONS}
                value={preview.contentRating}
                onChange={(value) => onPreviewChange({ ...preview, contentRating: value as ContentRating })}
                className="h-9 rounded-lg"
              />
            )}
          </ScrapeField>
          <div className="sm:col-span-2 lg:col-span-3">
            <ScrapeField label="简介">
              {({ id }) => (
                <Textarea
                  id={id}
                  className="scrape-setup__description resize-y min-h-[5.5rem]"
                  value={preview.description}
                  onChange={(event) => onPreviewChange({ ...preview, description: event.target.value })}
                />
              )}
            </ScrapeField>
          </div>
        </div>

        <div className="scrape-setup__save-row pt-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Button
              onClick={onConfirm}
              disabled={confirming || Boolean(novelId)}
              className={
                novelId
                  ? 'rounded-full h-9 px-5 text-xs font-medium bg-emerald-600 hover:bg-emerald-600 text-white cursor-default'
                  : 'rounded-full h-9 px-5 text-xs font-medium bg-[#D97757] hover:bg-[#c56344] text-white shadow-xs cursor-pointer transition-all'
              }
            >
              {confirming ? '保存中…' : novelId ? '书籍已保存' : '保存书籍并继续'}
              {!novelId && <ArrowRight className="size-3.5 ml-1.5" aria-hidden="true" />}
            </Button>
            <span className="text-xs text-muted-foreground">
              {novelId ? '基础信息已入库，接下来可核对章节配置并启动任务。' : '保存后才能启动章节抓取任务。'}
            </span>
          </div>
        </div>
      </section>

      {/* 分区 2：章节配置与启动 */}
      <section className="scrape-setup-section" aria-labelledby="scrape-setup-config-title">
        <div className="scrape-setup-section__head">
          <div>
            <div className="flex items-center gap-2">
              <h3 id="scrape-setup-config-title" className="scrape-setup-section__title">
                章节配置
              </h3>
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-stone-100 dark:bg-stone-800 text-stone-600 dark:text-stone-300 border border-stone-200/80 dark:border-stone-700/80">
                {sitePreset === 'po18' ? 'PO18 预设' : '自定义配置'}
              </span>
            </div>
            <p className="scrape-setup-section__subtitle">
              智能分析已自动生成选择器与规则；源站结构特殊时可展开微调。
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleAdvanced}
            aria-expanded={advancedOpen}
            aria-controls={advancedId}
            className="h-8 rounded-lg text-xs font-medium px-3 text-stone-600 dark:text-stone-300 hover:text-foreground hover:bg-stone-100 dark:hover:bg-stone-800 transition-colors"
          >
            <ChevronDown className={`size-3.5 mr-1.5 transition-transform duration-200 ${advancedOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            {advancedOpen ? '收起章节选择器' : '编辑章节选择器'}
          </Button>
        </div>

        {advancedOpen && (
          <div id={advancedId} className="scrape-setup-advanced-box">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span className="text-xs font-medium text-foreground">选择器来源</span>
              <Tabs value={sitePreset} onValueChange={onSitePresetChange} className="scrape-setup__preset-tabs">
                <TabsList aria-label="选择器来源" data-active-index={PRESET_INDEX[sitePreset] ?? 0} className="rounded-lg p-1 bg-stone-200/60 dark:bg-stone-800/60">
                  <TabsTrigger value="po18" className="rounded-md h-7 px-3 text-xs font-medium">PO18 预设</TabsTrigger>
                  <TabsTrigger value="custom" className="rounded-md h-7 px-3 text-xs font-medium">自定义</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <ScrapeField label="章节列表页 URL">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="url"
                      value={chapterListUrl}
                      onChange={(event) => onChapterListUrlChange(event.target.value)}
                      className="h-9 rounded-lg px-3 text-xs font-mono bg-background border-border/80 focus-visible:border-[#D97757]/80"
                    />
                  )}
                </ScrapeField>
              </div>
              <div>
                <ScrapeField label="编码">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={encoding}
                      placeholder="utf-8 / gbk"
                      onChange={(event) => onEncodingChange(event.target.value)}
                      className="h-9 rounded-lg px-3 text-xs font-mono bg-background border-border/80 focus-visible:border-[#D97757]/80"
                    />
                  )}
                </ScrapeField>
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-1 border-t border-border/40">
              <span className="text-xs font-medium text-stone-600 dark:text-stone-300">CSS 选择器</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {SELECTOR_FIELDS.map((field) => (
                  <ScrapeField label={field.label} key={field.key}>
                    {({ id }) => (
                      <Input
                        id={id}
                        placeholder={field.placeholder}
                        value={selectors[field.key]}
                        onChange={(event) => onSelectorsChange({ ...selectors, [field.key]: event.target.value })}
                        className="h-9 rounded-lg px-3 text-xs font-mono bg-background border-border/80 focus-visible:border-[#D97757]/80"
                      />
                    )}
                  </ScrapeField>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={onTest}
                disabled={!chapterListUrl.trim() || !selectors.chapterList.trim()}
                className="h-8 rounded-lg px-3.5 text-xs font-medium border-border/80 hover:border-[#D97757]/60 hover:text-[#D97757] transition-all cursor-pointer"
              >
                <FlaskConical className="size-3.5 mr-1.5" aria-hidden="true" />
                测试章节选择器
              </Button>
              <span className="text-xs text-muted-foreground">
                实时抓取前几章链接，验证选择器准确性
              </span>
            </div>

            {testResult.loading && (
              <div className="rounded-lg p-3 bg-stone-100/70 dark:bg-stone-800/40 text-xs text-muted-foreground flex items-center gap-2" role="status">
                <RefreshCw className="size-3.5 animate-spin text-[#D97757]" aria-hidden="true" />
                正在读取样章并检查选择器…
              </div>
            )}

            {!testResult.loading && (testResult.data || testResult.empty || testResult.error) && (
              <div className="rounded-lg p-3.5 bg-stone-100/70 dark:bg-stone-800/40 border border-border/60 text-xs" role="status">
                {links.length > 0 ? (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400 border border-emerald-200/80 dark:border-emerald-800/60">
                        <Check className="size-3" aria-hidden="true" />
                        测试通过 · {links.length} 个章节链接
                      </span>
                    </div>
                    <ul className="mt-2 text-xs font-mono max-h-36 overflow-y-auto space-y-1">
                      {links.slice(0, 8).map((link, index) => (
                        <li key={index} className="text-muted-foreground truncate">{link.text || link.href}</li>
                      ))}
                    </ul>
                  </>
                ) : testResult.empty ? (
                  <span className="text-amber-600 dark:text-amber-400 font-medium">没有找到章节链接，请检查选择器</span>
                ) : testResult.error ? (
                  <span className="text-destructive font-medium">测试失败：{testResult.error}</span>
                ) : null}
              </div>
            )}
          </div>
        )}

        {/* 启动与统计底栏 */}
        <div className="scrape-setup-run-card">
          <div className="flex items-center gap-6 sm:gap-8 flex-wrap">
            <div>
              <div className="text-xs text-muted-foreground font-medium">可抓章节</div>
              <div className="font-serif text-2xl font-bold tracking-tight text-foreground">{chapterText}</div>
            </div>
            <div className="w-px h-8 bg-border/60 hidden sm:block" />
            <div>
              <div className="text-xs text-muted-foreground font-medium">受保护章节</div>
              <div className={`font-serif text-2xl font-bold tracking-tight ${protectedChapterCount > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-stone-400'}`}>
                {protectedChapterCount}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
            <span className="text-xs text-muted-foreground hidden md:inline">
              {!novelId ? '请先保存书籍信息' : !selectors.chapterContent.trim() ? '请填写正文选择器' : '配置将在启动时应用'}
            </span>
            <Button
              className="rounded-full h-10 px-6 text-xs font-semibold bg-[#D97757] hover:bg-[#c56344] text-white shadow-xs transition-all cursor-pointer disabled:opacity-40"
              onClick={onStart}
              disabled={!novelId || !selectors.chapterContent.trim()}
            >
              开始抓取
              <ArrowRight className="size-3.5 ml-1.5" aria-hidden="true" />
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted-foreground m-0">
          先保存书籍信息，再测试章节选择器。所有修改只会在点击启动后写入抓取任务；受保护章节需要 PO18 账号具备读取权限。
        </p>

        <ScrapeChecks items={testChecks} />
      </section>
    </div>
  )
}
