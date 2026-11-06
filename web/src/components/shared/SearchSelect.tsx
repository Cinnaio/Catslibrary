import '@/styles/select-fields.css'
/**
 * 共享下拉 —— shadcn Popover + Command Combobox，全站唯一的可搜索选择控件。
 * 表单控件、工具条筛选、弹窗内长列表（章节锚点、映射目标）都用它，
 * 不再各自维护原生 <select> 的外观与键盘行为。
 *
 * 三种形态：
 * - 默认：触发器展示选中项，内部提供搜索框（searchable）。
 * - 受控搜索（search + onSearchChange）：搜索框由调用方持有，列表按调用方给的结果渲染，
 *   适合「页面上已有搜索输入、下拉只负责选一项」的双栏布局。
 * - 折叠（collapsed）：候选超过 compactThreshold 时，浮层只渲染当前选中项附近的一个窗口，
 *   列表底部提供「展开全部 N 项」，避免几百个章节把浮层撑成整屏。
 *
 * onServerSearch 的「本地空结果才补搜」副作用原样保留。
 */
import { useEffect, useMemo, useRef, useState, type AriaAttributes, type ReactNode } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { useFieldControl } from '@/components/ui/field-context'
import './SearchSelect.css'

const SEARCH_OPTIONS_PAGE_SIZE = 100
const COMPACT_NEIGHBOURS = 4

export interface SelectOption {
  value: string
  label: string
  /** 次行元信息（如「作者 · N章」），可选 */
  sub?: string
  /** 行尾状态注记（如「本轮新增」「不可选」），与选中对勾同区 */
  note?: string
  /** 禁用单个选项，但保留其在列表中的说明 */
  disabled?: boolean
}

interface SearchSelectProps {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  compact?: boolean
  chip?: boolean
  /** 以筛选胶囊呈现：使用前置图标作为“添加筛选”提示，不显示默认下拉箭头。 */
  filterChip?: boolean
  leadingIcon?: ReactNode
  searchable?: boolean
  /** 受控搜索词；与 onSearchChange 一起使用时搜索框由调用方持有，浮层内不再渲染搜索框。 */
  search?: string
  onSearchChange?: (query: string) => void
  /** 受控模式下无结果时的提示；默认按本地筛选结果决定。 */
  emptyText?: string
  /** 浮层宽度锁定到触发器宽度；长标题下拉用它避免浮层被内容撑爆或塌缩。 */
  matchTriggerWidth?: boolean
  /** 全部展开提示的文案（collapsed 折叠时生效），支持 {count} 占位 */
  expandAllLabel?: string
  /** 折叠开关：候选数超过该值只渲染选中项附近的窗口，列表底部给「展开全部」。
   *  不传则不折叠；搜索型下拉（小说全库索引）靠输入收敛，不要传。 */
  compactThreshold?: number
  searchPlaceholder?: string
  /** 搜索过滤（title/author/拼音），默认大小写不敏感子串 */
  filter?: (option: SelectOption, q: string) => boolean
  /** 本地无命中时触发服务端补搜（如全库索引未覆盖） */
  onServerSearch?: (query: string) => void
  className?: string
  /** 浮层的场景布局类名，例如在高层级弹窗内调整堆叠顺序。 */
  popoverClassName?: string
  disabled?: boolean
  /** 触发器 id：让 <Label htmlFor> 指向按钮本身，而不是包一层 div。 */
  id?: string
  dropdownSide?: 'top' | 'right' | 'bottom' | 'left'
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-invalid'?: AriaAttributes['aria-invalid']
  'aria-describedby'?: string
}

export default function SearchSelect({
  options,
  value,
  onChange,
  placeholder = '请选择',
  compact,
  chip,
  filterChip,
  leadingIcon,
  searchable,
  search,
  onSearchChange,
  emptyText,
  matchTriggerWidth,
  expandAllLabel = '展开全部',
  compactThreshold,
  searchPlaceholder = '搜索…',
  filter,
  onServerSearch,
  className,
  popoverClassName,
  disabled,
  id,
  dropdownSide = 'bottom',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: SearchSelectProps) {
  const fieldProps = useFieldControl({ id, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy })
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(false)
  const [searchWindow, setSearchWindow] = useState({ query: '', count: SEARCH_OPTIONS_PAGE_SIZE })
  const serverSearched = useRef(new Set<string>())
  const triggerRef = useRef<HTMLButtonElement>(null)

  const controlled = search !== undefined && onSearchChange !== undefined
  const activeQuery = controlled ? search : query

  const selected = options.find((o) => o.value === value)

  const filtered = useMemo(() => {
    // 受控搜索由调用方决定结果集，这里只保留选中的那一项，避免它被搜索结果挤掉。
    // 受控时调用方已按自己的字段（序号、作者、拼音）过滤，不能再叠一层 label 子串过滤，
    // 否则「按序号搜到、但标题不含关键词」的候选会被二次过滤掉。
    if (controlled) return options
    if (!activeQuery.trim()) return options
    const q = activeQuery.trim().toLowerCase()
    const fn = filter || ((o: SelectOption, qq: string) => o.label.toLowerCase().includes(qq))
    return options.filter((o) => fn(o, q))
  }, [options, activeQuery, controlled, filter])

  // 搜索下拉可能承载全库索引；先挂载一批候选，允许继续显示其余匹配项。
  // 改变搜索词时从首批开始，搜索始终基于完整 filtered 结果。
  // 保留当前选项，避免已选小说不在前 100 项时打开下拉看不到选中态。
  const renderedCount = searchWindow.query === activeQuery ? searchWindow.count : SEARCH_OPTIONS_PAGE_SIZE
  const visibleOptions = useMemo(() => {
    if (!searchable || filtered.length <= renderedCount) return filtered
    const initial = filtered.slice(0, renderedCount)
    if (!value || initial.some((option) => option.value === value)) return initial
    const selectedOption = filtered.find((option) => option.value === value)
    return selectedOption ? [...initial.slice(0, renderedCount - 1), selectedOption] : initial
  }, [filtered, searchable, value, renderedCount])

  // 折叠：只渲染选中项前后各 N 项。没有选中项时从头部开始，保证长列表打开即可见。
  // 阈值必须由调用方显式声明：小说全库索引这类「靠输入收敛」的搜索下拉一旦被折叠，
  // 用户看不到全部候选，也读不到底部的「请输入关键词」提示，属于功能退化。
  const collapsed = compactThreshold !== undefined && !expanded && filtered.length > compactThreshold
  const foldedOptions = useMemo(() => {
    if (!collapsed) return visibleOptions
    const anchor = visibleOptions.findIndex((option) => option.value === value)
    const start = anchor < 0 ? 0 : Math.max(0, Math.min(anchor - COMPACT_NEIGHBOURS, visibleOptions.length - (COMPACT_NEIGHBOURS * 2 + 1)))
    return visibleOptions.slice(start, start + COMPACT_NEIGHBOURS * 2 + 1)
  }, [collapsed, visibleOptions, value])

  // 本地无命中且未补搜过 → 触发服务端补搜
  useEffect(() => {
    const q = activeQuery.trim()
    if (q && filtered.length === 0 && onServerSearch && !serverSearched.current.has(q)) {
      serverSearched.current.add(q)
      onServerSearch(q)
    }
  }, [filtered.length, activeQuery, onServerSearch])

  function pick(o: SelectOption) {
    if (disabled || o.disabled) return
    onChange(o.value)
    setOpen(false)
  }

  return (
    <Popover
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          setExpanded(false)
          setSearchWindow({ query: controlled ? activeQuery : '', count: SEARCH_OPTIONS_PAGE_SIZE })
          if (searchable && !controlled) setQuery('')
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          {...fieldProps}
          type="button"
          variant="outline"
          role="combobox"
          data-field="select"
          data-field-size={compact ? 'sm' : 'default'}
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          disabled={disabled}
          className={cn(
            'w-full max-w-[400px] justify-between font-normal',
            // compact 保留宽度上限；高度由所在表单/工具条/分页的共享尺寸决定。
            // 原实现用 max-w-none 解除约束，裸用 compact 时按钮会被 flex 容器
            // 拉满整行（实测 .admin-toolbar--inline 下各占 1440px，两个筛选器
            // 各占一行）。调用方仍可用 className 覆盖，如 w-40。
            compact && 'max-w-[var(--select-compact-width,11rem)]',
            chip && 'rounded-full',
            filterChip && 'select-filter-chip',
            className,
          )}
        >
          <span className="custom-select__value flex min-w-0 items-center gap-2">
            {leadingIcon && (
              <span className="custom-select__leading-icon flex shrink-0 items-center" aria-hidden="true">
                {leadingIcon}
              </span>
            )}
            <span className={cn('truncate', !selected && 'custom-select__placeholder text-muted-foreground')}>{selected?.label || placeholder}</span>
            {selected?.note && <span className="custom-select__note shrink-0">{selected.note}</span>}
          </span>
          {!filterChip && <ChevronsUpDown className="size-4 shrink-0 opacity-50" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side={dropdownSide}
        onCloseAutoFocus={(event) => {
          if (!event.defaultPrevented) {
            event.preventDefault()
            triggerRef.current?.focus({ preventScroll: true })
          }
        }}
        className={cn(
          'search-select-popover shared-select-content w-(--radix-popover-trigger-width) min-w-[200px] p-0',
          // 搜索框聚焦环会向上溢出触发器，折叠提示同理，顶部各留一点余量。
          ((searchable && !controlled) || collapsed) && 'pt-1',
          compact && 'w-auto',
          matchTriggerWidth && 'w-(--radix-popover-trigger-width)',
          popoverClassName,
        )}
      >
        <Command shouldFilter={false}>
          {searchable && !controlled && <CommandInput placeholder={searchPlaceholder} value={query} onValueChange={setQuery} autoFocus />}
          <CommandList>
            {filtered.length === 0 ? (
              <CommandEmpty>{emptyText || (!activeQuery.trim() && options.length === 0 ? '暂无选项' : '没有匹配的选项')}</CommandEmpty>
            ) : (
              <>
                <CommandGroup>
                  {foldedOptions.map((o) => (
                    <CommandItem
                      key={o.value}
                      value={o.value}
                      onSelect={() => pick(o)}
                      disabled={o.disabled}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate">{o.label}</span>
                        {o.sub && <span className="truncate text-xs text-muted-foreground">{o.sub}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5">
                        {o.note && <span className="custom-select__note text-xs text-muted-foreground">{o.note}</span>}
                        {o.value === value && <Check className="size-4 shrink-0" />}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
                {collapsed && (
                  <button type="button" className="custom-select__more" onClick={() => setExpanded(true)}>
                    {expandAllLabel.replace('{count}', String(visibleOptions.length))}
                  </button>
                )}
                {visibleOptions.length < filtered.length && (
                  <>
                    <p className="px-3 pb-2 text-xs text-muted-foreground" role="status">
                      已显示 {visibleOptions.length} 项，共 {filtered.length} 项
                    </p>
                    {!collapsed && (
                      <button
                        type="button"
                        className="custom-select__more"
                        onClick={() => setSearchWindow({ query: activeQuery, count: renderedCount + SEARCH_OPTIONS_PAGE_SIZE })}
                      >
                        继续显示 {Math.min(SEARCH_OPTIONS_PAGE_SIZE, filtered.length - visibleOptions.length)} 项
                      </button>
                    )}
                  </>
                )}
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
