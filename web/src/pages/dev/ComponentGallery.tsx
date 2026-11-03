import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Code2, Copy, ExternalLink, Monitor, RotateCcw, Search, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useTheme } from '@/context/ThemeContext'
import { applyTheme } from '@/context/ThemeContext'
import { entries } from './gallery-catalog'
import { groups, stateLabels, type PreviewState } from './gallery-types'
import './gallery.css'

// File inventory is generated from the project, so additions remain visible even
// before an interactive example is written. Raw source is fetched only on demand.
const sourceModules = import.meta.glob<string>(
  ['/src/components/**/*.tsx', '/src/pages/**/*.tsx', '/src/styles/**/*.css', '!/src/**/*.test.tsx', '!/src/pages/dev/**'],
  { query: '?raw', import: 'default' },
)
const sources = Object.fromEntries(Object.entries(sourceModules).map(([path, loader]) => [path.replace('/src/', ''), loader]))
const sourcePaths = Object.keys(sources).sort()
const linkedSources = new Set(entries.flatMap((entry) => entry.sources))
const allStates = Object.keys(stateLabels) as PreviewState[]

function SourceView({ path }: { path: string }) {
  const [result, setResult] = useState<{ text?: string; error?: string }>({})
  useEffect(() => {
    let active = true
    const loader = sources[path]
    if (!loader) return
    loader().then(
      (text) => {
        if (active) setResult({ text })
      },
      () => {
        if (active) setResult({ error: '源码加载失败，请重新打开。' })
      },
    )
    return () => {
      active = false
    }
  }, [path])
  return (
    <pre className="gallery-source" tabIndex={0} aria-label={`${path} 源码`}>
      <code>{!sources[path] ? '此文件未包含在源文件索引中。' : (result.error ?? result.text ?? '正在加载源码…')}</code>
    </pre>
  )
}

function GalleryPreview() {
  const [params] = useSearchParams()
  const selection = params.get('item') || 'colors'
  const state = allStates.includes(params.get('state') as PreviewState) ? (params.get('state') as PreviewState) : 'default'
  const boundary = params.get('boundary') === '1'
  const selected = entries.filter((entry) => entry.id === selection || `group:${entry.group}` === selection)
  const theme = params.get('theme') === 'dark' ? 'dark' : 'light'
  const { theme: siteTheme } = useTheme()
  useEffect(() => {
    // Apply after the outer provider's initial effect; the URL theme is local to this document.
    const frame = requestAnimationFrame(() => applyTheme(theme))
    return () => cancelAnimationFrame(frame)
  }, [theme, siteTheme])
  return (
    <main className="gallery-preview" aria-label="组件预览">
      {selected.length === 0 && <p>未找到示例，请从组件目录重新选择。</p>}
      {selected.map((entry) => {
        const supported = state === 'default' || entry.states?.includes(state)
        const Example = entry.Example
        return (
          <section key={`${entry.id}-${state}-${boundary}`} className="gallery-example" aria-labelledby={`example-${entry.id}`}>
            <header className="gallery-example-heading">
              <div>
                <h2 id={`example-${entry.id}`}>{entry.title}</h2>
                <p>{entry.description}</p>
              </div>
              <span className="gallery-scope">{entry.group === 'pages' ? '专属样式' : entry.group === 'foundation' ? '设计变量' : '共享组件'}</span>
            </header>
            {!supported && <p className="gallery-note">此示例不适用“{stateLabels[state]}”状态，当前展示默认状态。</p>}
            <div className="gallery-example-canvas">
              <Example state={supported ? state : 'default'} boundary={boundary} />
            </div>
            <footer className="gallery-example-footer">
              <span>使用场景：{entry.usage}</span>
              <div>
                {entry.sources.map((path) => (
                  <code key={path}>{path}</code>
                ))}
              </div>
            </footer>
          </section>
        )
      })}
    </main>
  )
}

function GalleryShell() {
  const [params, setParams] = useSearchParams()
  const { theme, setting, setSetting } = useTheme()
  const [query, setQuery] = useState('')
  const [width, setWidth] = useState('auto')
  const [reload, setReload] = useState(0)
  const [showSource, setShowSource] = useState(false)
  const [coverage, setCoverage] = useState('all')
  const [limit, setLimit] = useState(40)
  const [copyResult, setCopyResult] = useState('')
  const selection = params.get('item') || 'colors'
  const inventory = selection === 'inventory'
  const selected = entries.find((entry) => entry.id === selection)
  const selectedGroup = groups.find((group) => `group:${group.id}` === selection || group.id === selected?.group)
  const selectedEntries = entries.filter((entry) => entry.id === selection || `group:${entry.group}` === selection)
  const state = allStates.includes(params.get('state') as PreviewState) ? (params.get('state') as PreviewState) : 'default'
  const boundary = params.get('boundary') === '1'
  const currentSource = params.get('file') || selected?.sources[0] || ''
  const q = query.trim().toLocaleLowerCase()
  const matchingEntries = entries.filter((entry) =>
    `${entry.title} ${entry.description} ${entry.sources.join(' ')} ${entry.usage}`.toLocaleLowerCase().includes(q),
  )
  const inventoryPaths = sourcePaths.filter(
    (path) => path.toLocaleLowerCase().includes(q) && (coverage === 'all' || (coverage === 'linked' ? linkedSources.has(path) : !linkedSources.has(path))),
  )
  const previewParams = new URLSearchParams({ preview: '1', item: selection, state, theme, boundary: boundary ? '1' : '0' })
  const previewUrl = `/dev/components?${previewParams}`
  const activeStates = allStates.filter((value) => value === 'default' || selectedEntries.some((entry) => entry.states?.includes(value)))

  useEffect(() => {
    document.title = '组件与样式 · 知舟'
  }, [])

  function update(values: Record<string, string | null>) {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(values)) {
      if (value === null) next.delete(key)
      else next.set(key, value)
    }
    setParams(next, { replace: true })
    setCopyResult('')
  }
  function choose(item: string) {
    update({ item, file: null, state: 'default' })
    setShowSource(false)
  }
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyResult('链接已复制')
    } catch {
      setCopyResult('复制未完成，可直接复制地址栏链接')
    }
  }

  return (
    <div className="gallery-app">
      <a href="#gallery-main" className="gallery-skip">
        跳到预览
      </a>
      <header className="gallery-topbar">
        <div className="gallery-brand">
          <Link to="/" aria-label="返回知舟">
            <ArrowLeft size={18} />
          </Link>
          <span>
            知舟<span className="gallery-brand-divider">/</span>组件与样式
          </span>
          <span className="gallery-dev-label">开发预览</span>
        </div>
        <label className="gallery-theme-label">
          主题
          <select value={setting} onChange={(event) => setSetting(event.target.value as 'light' | 'dark' | 'system')} aria-label="展示主题">
            <option value="system">跟随系统</option>
            <option value="light">亮色</option>
            <option value="dark">暗色</option>
          </select>
        </label>
      </header>
      <aside className="gallery-nav" aria-label="组件目录">
        <div className="gallery-search">
          <Search size={16} aria-hidden="true" />
          <Input
            aria-label="搜索组件或源文件"
            placeholder="搜索名称、样式或文件…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setLimit(40)
            }}
          />
        </div>
        <nav>
          {groups.map((group) => {
            const matches = matchingEntries.filter((entry) => entry.group === group.id)
            if (!matches.length && q) return null
            return (
              <div key={group.id} className="gallery-nav-group">
                <button
                  type="button"
                  className="gallery-group-button"
                  aria-current={selection === `group:${group.id}` ? 'page' : undefined}
                  onClick={() => choose(`group:${group.id}`)}
                >
                  <span>{group.label}</span>
                  <span>{matches.length}</span>
                </button>
                {matches.map((entry) => (
                  <button
                    type="button"
                    key={entry.id}
                    className="gallery-nav-item"
                    aria-current={selection === entry.id ? 'page' : undefined}
                    onClick={() => choose(entry.id)}
                  >
                    {entry.title}
                  </button>
                ))}
              </div>
            )
          })}
          {!matchingEntries.length && <p className="gallery-note">没有匹配示例，可在源文件索引中继续查找。</p>}
        </nav>
        <button type="button" className="gallery-inventory-link" aria-current={inventory ? 'page' : undefined} onClick={() => choose('inventory')}>
          <Code2 size={16} />
          <span>源文件索引</span>
          <span>{sourcePaths.length}</span>
        </button>
        <p className="gallery-nav-foot">
          {entries.length} 组交互示例 · {linkedSources.size} 个关联文件
          <br />
          其余文件可查阅源码，待补交互示例。
        </p>
      </aside>
      <main id="gallery-main" className="gallery-main" tabIndex={-1}>
        <div className="gallery-page-heading">
          <div>
            <h1>{inventory ? '源文件索引' : selected?.title || selectedGroup?.label || '未找到示例'}</h1>
            <p>
              {inventory
                ? '自动列出组件、页面与样式文件；“已关联”仅表示有对应示例，完整覆盖仍需逐项检查。'
                : selected?.description || selectedGroup?.description || '请从左侧选择一个示例。'}
            </p>
          </div>
          <div className="gallery-heading-actions">
            <Button variant="ghost" size="sm" onClick={copyLink}>
              <Copy />
              复制链接
            </Button>
            {!inventory && (
              <Button variant="ghost" size="sm" asChild>
                <a href={previewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  独立预览
                </a>
              </Button>
            )}
          </div>
        </div>
        {copyResult && (
          <p role="status" className="gallery-note">
            {copyResult}
          </p>
        )}
        {inventory ? (
          <>
            <div className="gallery-inventory-tools">
              <label>
                覆盖范围
                <select
                  aria-label="源文件覆盖范围"
                  value={coverage}
                  onChange={(event) => {
                    setCoverage(event.target.value)
                    setLimit(40)
                  }}
                >
                  <option value="all">全部文件</option>
                  <option value="linked">已关联示例</option>
                  <option value="pending">待补交互示例</option>
                </select>
              </label>
              <span>{inventoryPaths.length} 个文件</span>
            </div>
            <div className="gallery-file-list">
              {inventoryPaths.slice(0, limit).map((path) => (
                <div className="gallery-file-row" key={path}>
                  <button
                    type="button"
                    onClick={() => {
                      update({ file: path })
                      setShowSource(true)
                    }}
                    aria-pressed={showSource && currentSource === path}
                  >
                    <Code2 size={15} />
                    <span>{path}</span>
                  </button>
                  <span className="gallery-coverage">{linkedSources.has(path) ? '已关联示例' : '待补交互示例'}</span>
                  {entries
                    .filter((entry) => entry.sources.includes(path))
                    .map((entry) => (
                      <button type="button" className="gallery-example-link" key={entry.id} onClick={() => choose(entry.id)}>
                        {entry.title}
                      </button>
                    ))}
                </div>
              ))}
            </div>
            {!inventoryPaths.length && <p className="gallery-empty">没有匹配的文件。试试其他搜索词或覆盖范围。</p>}
            {inventoryPaths.length > limit && (
              <Button variant="outline" onClick={() => setLimit((value) => value + 60)}>
                继续显示（剩余 {inventoryPaths.length - limit} 个）
              </Button>
            )}
          </>
        ) : (
          <>
            <div className="gallery-controls">
              <div className="gallery-width-controls" role="group" aria-label="预览视口宽度">
                {[
                  ['auto', '自适应', Monitor],
                  ['768', '平板', Monitor],
                  ['390', '手机', Smartphone],
                ].map(([value, label, Icon]) => {
                  const WidthIcon = Icon as typeof Monitor
                  return (
                    <Button
                      key={value as string}
                      size="sm"
                      variant={width === value ? 'secondary' : 'ghost'}
                      aria-pressed={width === value}
                      onClick={() => setWidth(value as string)}
                    >
                      <WidthIcon />
                      {label as string}
                    </Button>
                  )
                })}
              </div>
              <label>
                状态
                <select aria-label="示例状态" value={state} onChange={(event) => update({ state: event.target.value })}>
                  {activeStates.map((value) => (
                    <option value={value} key={value}>
                      {stateLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gallery-boundary">
                <input type="checkbox" checked={boundary} onChange={(event) => update({ boundary: event.target.checked ? '1' : null })} />
                边界内容
              </label>
              <Button variant="ghost" size="sm" aria-label="重置预览交互" onClick={() => setReload((value) => value + 1)}>
                <RotateCcw />
                重置
              </Button>
            </div>
            <div className="gallery-viewport-caption">
              <span>{width === 'auto' ? '自适应真实视口' : `${width}px 真实视口（空间不足时缩至可用宽度）`}</span>
              <span>虚构数据 · 修改仅作用于预览</span>
            </div>
            <div className="gallery-frame-stage">
              <iframe
                key={`${previewUrl}-${reload}`}
                src={previewUrl}
                title="组件交互预览"
                className="gallery-frame"
                style={{ width: width === 'auto' ? '100%' : `${width}px` }}
              />
            </div>
            <p className="gallery-note">边界内容用于支持该选项的示例；悬停、键盘焦点与浮层可直接操作。点击分类标题可连续查看整组。</p>
            {selected && (
              <div className="gallery-source-toolbar">
                <Button variant="ghost" size="sm" aria-expanded={showSource} onClick={() => setShowSource((value) => !value)}>
                  <Code2 />
                  {showSource ? '收起源码' : '查看真实源码'}
                </Button>
                <span>{selected.usage}</span>
              </div>
            )}
          </>
        )}
        {showSource && currentSource && (
          <section className="gallery-source-panel" aria-label="源文件查看器">
            <header>
              <label>
                源文件
                <select aria-label="查看源文件" value={currentSource} onChange={(event) => update({ file: event.target.value })}>
                  {(inventory ? [currentSource] : selected?.sources || []).map((path) => (
                    <option value={path} key={path}>
                      {path}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="ghost" size="sm" onClick={() => setShowSource(false)}>
                关闭源码
              </Button>
            </header>
            <SourceView key={currentSource} path={currentSource} />
          </section>
        )}
      </main>
    </div>
  )
}

export default function ComponentGallery() {
  const [params] = useSearchParams()
  return params.get('preview') === '1' ? <GalleryPreview /> : <GalleryShell />
}
