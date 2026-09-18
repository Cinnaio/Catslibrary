import CustomSelect from '@/components/admin/CustomSelect'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdminDataPanel, AdminPanelHeading } from '@/components/admin/AdminWorkspace'
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
  { value: 'link' as const, label: '链接导入' },
  { value: 'search' as const, label: '作品搜索' },
  { value: 'ranking' as const, label: '榜单发现' },
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
      <AdminPanelHeading
        className="scrape-intake__heading"
        title={<span id="scrape-intake-title">从哪里开始？</span>}
        description="找到作品后，信息确认、章节校验和任务启动会在同一条流程里完成。"
        actions={<span className="scrape-intake__shortcut">快捷键 / 聚焦搜索</span>}
      />

      <Tabs value={mode} onValueChange={(value) => onModeChange(value as IntakeMode)} className="scrape-intake__tabs">
        <TabsList aria-label="选择抓取入口" data-active-index={INTAKE_MODE_INDEX[mode]}>
          {MODES.map(({ value, label }) => (
            <TabsTrigger value={value} key={value} className="scrape-intake__tab">
              <strong>{label}</strong>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="scrape-intake__form">
        {mode === 'link' && (
          <div className="scrape-intake__field">
            <label htmlFor="scrape-source-url">小说源站链接</label>
            <div className="scrape-intake__control-row">
              <Input
                id="scrape-source-url"
                data-admin-search
                type="url"
                placeholder="https://wap.po18x.vip/book/10075/"
                value={sourceUrl}
                onChange={(event) => onSourceUrlChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSubmit()
                }}
              />
              <Button onClick={onSubmit} disabled={loading}>
                {loading ? '分析中…' : '分析链接'}
              </Button>
            </div>
            <p>支持 PO18 预设与通用 HTML 页面。分析会自动识别书名、章节数量和选择器。</p>
          </div>
        )}

        {mode === 'search' && (
          <div className="scrape-intake__field">
            <label htmlFor="scrape-search-input">搜索 PO18 作品</label>
            <div className="scrape-intake__control-row scrape-intake__control-row--search">
              <Input
                id="scrape-search-input"
                data-admin-search
                type="search"
                placeholder="输入书名或作者"
                value={searchInput}
                onChange={(event) => onSearchInputChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') onSubmit()
                }}
              />
              <Tabs value={searchType} onValueChange={onSearchTypeChange} aria-label="搜索类型">
                <TabsList
                  className="scrape-intake__search-type"
                  data-active-index={SEARCH_TYPE_INDEX[searchType as keyof typeof SEARCH_TYPE_INDEX] ?? 0}
                >
                  <TabsTrigger value="articlename">书名</TabsTrigger>
                  <TabsTrigger value="author">作者</TabsTrigger>
                </TabsList>
              </Tabs>
              <Button onClick={onSubmit} disabled={loading}>
                {loading ? '搜索中…' : '搜索作品'}
              </Button>
            </div>
            <p>搜索结果可以单本配置，也可以勾选多本后批量加入抓取队列。</p>
          </div>
        )}

        {mode === 'ranking' && (
          <div className="scrape-intake__field">
            <label htmlFor="scrape-ranking-url">榜单来源</label>
            <div className="scrape-intake__control-row scrape-intake__control-row--ranking">
              <CustomSelect
                className="scrape-intake__site"
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
              />
              <Button onClick={onSubmit} disabled={loading}>
                {loading ? '加载中…' : '加载榜单'}
              </Button>
            </div>
            <p>POPO 榜单列表可直接读取；进入作品详情与章节校验时需要源站账号或 Cookie。选择后不会立即写入书库，确认后才会创建和启动任务。</p>
          </div>
        )}
      </div>
    </AdminDataPanel>
  )
}
