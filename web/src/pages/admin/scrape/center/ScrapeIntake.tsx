import { ArrowRight, Flame, Globe, Link2, Search, Sparkles } from 'lucide-react'
import SearchSelect from "@/components/shared/SearchSelect"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdminDataPanel } from '@/components/admin/AdminDataPanel'
import { RANKING_SITES } from '../utils'

export type IntakeMode = 'link' | 'search' | 'ranking'

interface ScrapeIntakeProps {
  mode: IntakeMode
  onModeChange: (mode: IntakeMode) => void
  sourceUrl: string
  onSourceUrlChange: (value: string) => void
  searchInput: string
  onSearchInputChange: (value: string) => void
  searchType: string
  onSearchTypeChange: (value: string) => void
  siteValue: string
  onSiteChange: (value: string) => void
  discoverUrl: string
  onDiscoverUrlChange: (value: string) => void
  loading: boolean
  onSubmit: () => void
}

const MODES = [
  { value: 'link' as const, label: '链接导入', icon: Link2 },
  { value: 'search' as const, label: '作品搜索', icon: Search },
  { value: 'ranking' as const, label: '榜单发现', icon: Flame },
]

const INTAKE_MODE_INDEX: Record<IntakeMode, number> = {
  link: 0,
  search: 1,
  ranking: 2,
}

const SEARCH_TYPE_INDEX = {
  articlename: 0,
  author: 1,
} as const

export default function ScrapeIntake({
  mode,
  onModeChange,
  sourceUrl,
  onSourceUrlChange,
  searchInput,
  onSearchInputChange,
  searchType,
  onSearchTypeChange,
  siteValue,
  onSiteChange,
  discoverUrl,
  onDiscoverUrlChange,
  loading,
  onSubmit,
}: ScrapeIntakeProps) {
  return (
    <AdminDataPanel className="scrape-intake" ariaLabel="抓取入口">
      <div className="scrape-intake-card__head">
        <div className="scrape-intake-card__title-group">
          <h2 id="scrape-intake-title" className="scrape-intake-card__title">
            从哪里开始？
          </h2>
          <p className="scrape-intake-card__subtitle">
            输入小说链接、检索源站作品，或直接选择榜单进入抓取工作流。
          </p>
        </div>

        <Tabs value={mode} onValueChange={(value) => onModeChange(value as IntakeMode)} className="scrape-intake-card__tabs">
          <TabsList aria-label="选择抓取入口" data-active-index={INTAKE_MODE_INDEX[mode]} className="scrape-intake-card__mode-tabs">
            {MODES.map(({ value, label, icon: Icon }) => (
              <TabsTrigger value={value} key={value} className="scrape-intake-card__tab">
                <Icon className="size-3.5 mr-1.5 opacity-70" aria-hidden="true" />
                <span>{label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="scrape-intake-card__body">
        {mode === 'link' && (
          <div className="scrape-intake-card__field">
            <label htmlFor="scrape-source-url" className="scrape-intake-card__label">小说源站链接</label>
            <div className="scrape-intake-card__control-row">
              <Input
                id="scrape-source-url"
                data-search-field
                type="url"
                placeholder="https://wap.po18x.vip/book/10075/"
                value={sourceUrl}
                onChange={(event) => onSourceUrlChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSubmit()
                }}
                className="scrape-intake-card__input"
              />
              <Button
                onClick={onSubmit}
                disabled={loading}
                aria-label={loading ? '分析中…' : '分析链接'}
                className="scrape-intake-card__btn-primary"
              >
                {loading ? (
                  '分析中…'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    分析链接
                    <ArrowRight className="size-3.5 opacity-80" aria-hidden="true" />
                  </span>
                )}
              </Button>
            </div>
            <p className="scrape-intake-card__hint">
              支持 PO18.tw 预设与通用 HTML；自动识别书名、章节目录与正文选择器。
            </p>
          </div>
        )}

        {mode === 'search' && (
          <div className="scrape-intake-card__field">
            <label htmlFor="scrape-search-input" className="scrape-intake-card__label">搜索 PO18 作品</label>
            <div className="scrape-intake-card__control-row scrape-intake-card__control-row--search">
              <Input
                id="scrape-search-input"
                data-search-field
                type="search"
                placeholder="输入书名或作者"
                value={searchInput}
                onChange={(event) => onSearchInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSubmit()
                }}
                className="scrape-intake-card__input"
              />
              <Tabs value={searchType} onValueChange={onSearchTypeChange} aria-label="搜索类型">
                <TabsList
                  className="scrape-intake-card__type-pill"
                  data-active-index={SEARCH_TYPE_INDEX[searchType as keyof typeof SEARCH_TYPE_INDEX] ?? 0}
                >
                  <TabsTrigger value="articlename" className="scrape-intake-card__type-btn">书名</TabsTrigger>
                  <TabsTrigger value="author" className="scrape-intake-card__type-btn">作者</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button
                onClick={onSubmit}
                disabled={loading}
                aria-label={loading ? '搜索中…' : '搜索作品'}
                className="scrape-intake-card__btn-primary"
              >
                {loading ? (
                  '搜索中…'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    搜索作品
                    <ArrowRight className="size-3.5 opacity-80" aria-hidden="true" />
                  </span>
                )}
              </Button>
            </div>
            <p className="scrape-intake-card__hint">
              搜索 PO18 原创书库；结果可单本配置，也可勾选多本后批量加入抓取队列。
            </p>
          </div>
        )}

        {mode === 'ranking' && (
          <div className="scrape-intake-card__field">
            <label htmlFor="scrape-ranking-url" className="scrape-intake-card__label">榜单来源</label>
            <div className="scrape-intake-card__ranking-row">
              <SearchSelect
                className="scrape-intake-card__site"
                options={RANKING_SITES}
                value={siteValue}
                onChange={onSiteChange}
                placeholder="选择 POPO / PO18 榜单"
                aria-label="选择榜单来源"
              />
              <Input
                id="scrape-ranking-url"
                type="url"
                placeholder="也可以粘贴自定义榜单 URL"
                value={discoverUrl}
                onChange={(event) => onDiscoverUrlChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSubmit()
                }}
                className="scrape-intake-card__input"
              />
              <Button
                onClick={onSubmit}
                disabled={loading}
                aria-label={loading ? '加载中…' : '加载榜单'}
                className="scrape-intake-card__btn-primary"
              >
                {loading ? (
                  '加载中…'
                ) : (
                  <span className="inline-flex items-center gap-1.5">
                    加载榜单
                    <ArrowRight className="size-3.5 opacity-80" aria-hidden="true" />
                  </span>
                )}
              </Button>
            </div>
            <p className="scrape-intake-card__hint">
              POPO 榜单可直接免密读取目录；详情与章节校验需登录或 Cookie。确认前不会写入书库或创建任务。
            </p>
          </div>
        )}
      </div>
    </AdminDataPanel>
  )
}
