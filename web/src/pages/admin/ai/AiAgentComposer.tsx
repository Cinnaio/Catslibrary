import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUp, ChevronDown, Square } from 'lucide-react'
import { aiApi, type AiProviderPreset } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import styles from './agent-workspace.module.css'

interface Props {
  value: string
  onChange: (value: string) => void
  onSend: () => void
  onStop: () => void
  busy: boolean
  running: boolean
  providerPresetId: string
  onProviderChange: (id: string) => void
  chatRef: RefObject<HTMLElement | null>
  feedRef: RefObject<HTMLDivElement | null>
  followBottomRef: RefObject<boolean>
}

const DEFAULT_PROVIDER = '__default__'

export default function AiAgentComposer({
  value,
  onChange,
  onSend,
  onStop,
  busy,
  running,
  providerPresetId,
  onProviderChange,
  chatRef,
  feedRef,
  followBottomRef,
}: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null)
  const form = useRef<HTMLFormElement>(null)
  const hintId = useId()
  const [presets, setPresets] = useState<AiProviderPreset[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [loadedVersion, setLoadedVersion] = useState(-1)
  const [loadError, setLoadError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const loading = loadedVersion !== refresh
  const selected = presets.find((preset) => preset.id === providerPresetId)
  const modelLabel = selected?.model || (providerPresetId ? '预设不可用' : defaultModel || '默认模型')

  useEffect(() => {
    let active = true
    void Promise.allSettled([aiApi.providerPresets(), aiApi.status()]).then(([saved, current]) => {
      if (!active) return
      if (saved.status === 'fulfilled') setPresets(saved.value.presets.filter((preset) => preset.scope === 'text'))
      if (current.status === 'fulfilled') setDefaultModel(current.value.model)
      setLoadError(saved.status === 'rejected' || current.status === 'rejected')
      setLoadedVersion(refresh)
    })
    return () => {
      active = false
    }
  }, [refresh])

  const resizeInput = useCallback(() => {
    const input = textarea.current
    if (!input || input.clientWidth === 0) return
    const computed = getComputedStyle(input)
    const maxHeight = Number.parseFloat(computed.maxHeight) || 180
    const border = (Number.parseFloat(computed.borderTopWidth) || 0) + (Number.parseFloat(computed.borderBottomWidth) || 0)
    input.style.height = '0px'
    const contentHeight = input.scrollHeight + border
    input.style.height = `${Math.min(contentHeight, maxHeight)}px`
    input.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  useLayoutEffect(() => {
    resizeInput()
  }, [value, resizeInput])

  useLayoutEffect(() => {
    const input = textarea.current
    const composer = form.current
    if (!input || !composer) return
    let width = -1
    let maxHeight = ''
    const measure = () => {
      const availableHeight = getComputedStyle(input).maxHeight
      if (input.clientWidth !== width || availableHeight !== maxHeight) {
        width = input.clientWidth
        maxHeight = availableHeight
        resizeInput()
      }
      const feed = feedRef.current
      const chat = chatRef.current
      if (feed && chat && composer.offsetHeight > 0) {
        // 同步更新占位，避免输入收缩与 React 重渲染之间临时压缩对话区。
        const height = `${composer.offsetHeight}px`
        const resized = chat.style.getPropertyValue('--agent-composer-height') !== height
        if (resized) chat.style.setProperty('--agent-composer-height', height)
        // 页面滚动时卡片可能提前贴住视口底部，按实际遮挡量为最后一条消息留白。
        const overlap = Math.max(0, feed.getBoundingClientRect().bottom - composer.getBoundingClientRect().top)
        // 对话区在折叠线下方时，留白不能反过来撑高滚动区并不断扩大遮挡量。
        const maxSpace = Math.max(0, feed.clientHeight - (Number.parseFloat(getComputedStyle(feed).paddingTop) || 0) - 8)
        const space = `${Math.ceil(Math.min(overlap + 24, maxSpace))}px`
        if (resized || feed.style.getPropertyValue('--agent-composer-space') !== space) {
          feed.style.setProperty('--agent-composer-space', space)
          if (followBottomRef.current) feed.scrollTop = feed.scrollHeight
        }
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(input)
    observer.observe(composer)
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure)
    }
  }, [chatRef, resizeInput, feedRef, followBottomRef])

  return (
    <form
      ref={form}
      className={styles.composer}
      aria-label="创作消息输入"
      onSubmit={(event) => {
        event.preventDefault()
        onSend()
      }}
    >
      <Textarea
        ref={textarea}
        rows={1}
        aria-label="发送给创作助手的消息"
        aria-describedby={hintId}
        placeholder="描述想法，或继续调整…"
        value={value}
        maxLength={8000}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault()
            onSend()
          }
        }}
      />
      <span id={hintId} className="sr-only">
        Ctrl 或 Command 加 Enter 发送，Enter 换行。所选模型用于本轮对话与文本生成。
      </span>
      <div className={styles.composerActions}>
        <DropdownMenu
          onOpenChange={(open) => {
            if (open) setRefresh((version) => version + 1)
          }}
        >
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className={styles.modelTrigger}
              disabled={busy || running}
              aria-label={`切换模型，当前${modelLabel}`}
              title={selected ? `${selected.name} · ${selected.model}` : `跟随默认 · ${modelLabel}`}
            >
              <span>{modelLabel}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="top" className={styles.modelMenu}>
            <DropdownMenuLabel>本轮对话与文本生成</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={providerPresetId || DEFAULT_PROVIDER} onValueChange={(id) => onProviderChange(id === DEFAULT_PROVIDER ? '' : id)}>
              <DropdownMenuRadioItem value={DEFAULT_PROVIDER}>
                <span className={styles.modelOption}>
                  跟随默认<small>{defaultModel || '当前文本服务'}</small>
                </span>
              </DropdownMenuRadioItem>
              {presets.map((preset) => (
                <DropdownMenuRadioItem key={preset.id} value={preset.id} disabled={!preset.hasApiKey}>
                  <span className={styles.modelOption}>
                    {preset.name}
                    <small>
                      {preset.model}
                      {!preset.hasApiKey ? ' · 未配置密钥' : ''}
                    </small>
                  </span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            {loading && <DropdownMenuLabel>正在读取模型…</DropdownMenuLabel>}
            {loadError && <DropdownMenuItem onSelect={() => setRefresh((version) => version + 1)}>模型列表读取失败，重试</DropdownMenuItem>}
            {!loading && !loadError && !presets.length && <DropdownMenuLabel>还没有保存的文本预设</DropdownMenuLabel>}
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/admin/ai?sub=config">管理模型预设</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {running ? (
          <Button type="button" size="icon" variant="secondary" aria-label="停止回复" title="停止回复" disabled={busy} onClick={onStop}>
            <Square size={15} aria-hidden="true" />
          </Button>
        ) : (
          <Button type="submit" size="icon" aria-label={busy ? '正在提交…' : '发送'} title="发送（Ctrl / ⌘ + Enter）" disabled={busy || !value.trim()}>
            <ArrowUp size={17} aria-hidden="true" />
          </Button>
        )}
      </div>
    </form>
  )
}
