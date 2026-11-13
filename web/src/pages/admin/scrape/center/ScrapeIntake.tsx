import { ArrowRight, Flame, Link2, Search } from 'lucide-react'
import SearchSelect, { type SelectOption } from "@/components/shared/SearchSelect"
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { ScrapeSourceCapability } from '@/lib/api'
import styles from '../workbench.module.css'

export type IntakeMode = 'link' | 'search' | 'ranking'

interface ScrapeIntakeProps {
  mode: IntakeMode
  onModeChange: (mode: IntakeMode) => void
  sourceUrl: string
  onSourceUrlChange: (value: string) => void
  searchSources: ScrapeSourceCapability[]
  searchSourceId: string
  onSearchSourceChange: (id: string) => void
  rankingOptions: SelectOption[]
  searchInput: string
  onSearchInputChange: (value: string) => void
  searchType: string
  onSearchTypeChange: (value: string) => void
  siteValue: string
  onSiteChange: (value: string) => void
  discoverUrl: string
  onDiscoverUrlChange: (value: string) => void
  loading: boolean
  disabled?: boolean
  onSubmit: () => void
}

const MODES = [
  { value: 'link' as const, label: '链接导入', icon: Link2 },
  { value: 'search' as const, label: '作品搜索', icon: Search },
  { value: 'ranking' as const, label: '榜单发现', icon: Flame },
]

const SEARCH_TYPE_INDEX = {
  articlename: 0,
  author: 1,
} as const

export default function ScrapeIntake({
  mode,
  onModeChange,
  sourceUrl,
  onSourceUrlChange,
  searchSources,
  searchSourceId,
  onSearchSourceChange,
  rankingOptions,
  searchInput,
  onSearchInputChange,
  searchType,
  onSearchTypeChange,
  siteValue,
  onSiteChange,
  discoverUrl,
  onDiscoverUrlChange,
  loading,
  disabled = false,
  onSubmit,
}: ScrapeIntakeProps) {
  const modes = MODES.filter(option => option.value !== 'search' || searchSources.length > 0)
  return (
    <div className={styles.intake} aria-label="抓取入口">
      <Tabs value={mode} onValueChange={(value) => onModeChange(value as IntakeMode)}>
        <TabsList aria-label="选择抓取入口" data-active-index={modes.findIndex(option => option.value === mode)} className={styles.modeList}>
          {modes.map(({ value, label, icon: Icon }) => (
            <TabsTrigger value={value} key={value} disabled={loading || disabled}>
              <Icon className="size-3.5 mr-1.5 opacity-70" aria-hidden="true" />
              <span>{label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div>
        {mode === 'link' && (
          <div className={styles.field}>
            <label htmlFor="scrape-source-url" className={styles.label}>小说源站链接</label>
            <div className={styles.controls}>
              <Input
                id="scrape-source-url"
                data-search-field
                type="url"
                placeholder="粘贴小说详情页链接"
                value={sourceUrl}
                onChange={(event) => onSourceUrlChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !loading && !disabled && !event.nativeEvent.isComposing) onSubmit()
                }}
              />
              <Button
                onClick={onSubmit}
                disabled={loading || disabled}
                aria-label={loading ? '分析中…' : '分析链接'}
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
            <p className={styles.hint}>
              分析后核对作品信息和章节规则。
            </p>
          </div>
        )}

        {mode === 'search' && (
          <div className={styles.field}>
            <label htmlFor="scrape-search-input" className={styles.label}>搜索作品</label>
            <div className={styles.controls}>
              {searchSources.length > 1 && (
                <SearchSelect
                  options={searchSources.map(source => ({ value: source.id, label: source.name }))}
                  value={searchSourceId}
                  onChange={onSearchSourceChange}
                  aria-label="搜索书源"
                />
              )}
              <Input
                id="scrape-search-input"
                data-search-field
                type="search"
                placeholder="输入书名或作者"
                value={searchInput}
                onChange={(event) => onSearchInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !loading && !disabled && !event.nativeEvent.isComposing) onSubmit()
                }}
              />
              <Tabs value={searchType} onValueChange={onSearchTypeChange} aria-label="搜索类型">
                <TabsList
                  data-active-index={SEARCH_TYPE_INDEX[searchType as keyof typeof SEARCH_TYPE_INDEX] ?? 0}
                >
                  <TabsTrigger value="articlename" disabled={loading || disabled}>书名</TabsTrigger>
                  <TabsTrigger value="author" disabled={loading || disabled}>作者</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button
                onClick={onSubmit}
                disabled={loading || disabled}
                aria-label={loading ? '搜索中…' : '搜索作品'}
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
            <p className={styles.hint}>
              选择单本核对，或勾选多本加入抓取队列。
            </p>
          </div>
        )}

        {mode === 'ranking' && (
          <div className={styles.field}>
            <label htmlFor="scrape-ranking-url" className={styles.label}>榜单来源</label>
            <div className={styles.controls}>
              {rankingOptions.length > 0 && <SearchSelect
                className={styles.site}
                options={rankingOptions}
                value={siteValue}
                onChange={onSiteChange}
                placeholder="选择榜单"
                aria-label="选择榜单来源"
              />}
              <Input
                id="scrape-ranking-url"
                type="url"
                placeholder="也可以粘贴自定义榜单 URL"
                value={discoverUrl}
                onChange={(event) => onDiscoverUrlChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !loading && !disabled && !event.nativeEvent.isComposing) onSubmit()
                }}
              />
              <Button
                onClick={onSubmit}
                disabled={loading || disabled}
                aria-label={loading ? '加载中…' : '加载榜单'}
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
            <p className={styles.hint}>
              选择榜单或粘贴榜单链接。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
