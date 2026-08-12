/**
 * 管理后台自定义下拉 —— shadcn Popover + Command Combobox。
 * 接口与类名语义和旧 CustomSelect 完全一致（SelectOption 接口 + 全部 props 不变），
 * 内部改为 shadcn 组件：键盘导航/焦点管理由 cmdk 接管。
 * onServerSearch 的「本地空结果才补搜」副作用原样保留。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'

export interface SelectOption {
  value: string
  label: string
  /** 次行元信息（如「作者 · N章」），可选 */
  sub?: string
}

interface CustomSelectProps {
  options: SelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  compact?: boolean
  chip?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  /** 搜索过滤（title/author/拼音），默认大小写不敏感子串 */
  filter?: (option: SelectOption, q: string) => boolean
  /** 本地无命中时触发服务端补搜（如全库索引未覆盖） */
  onServerSearch?: (query: string) => void
  className?: string
  disabled?: boolean
  dropdownSide?: 'top' | 'right' | 'bottom' | 'left'
  'aria-label'?: string
  'aria-labelledby'?: string
}

export default function CustomSelect({
  options,
  value,
  onChange,
  placeholder = '请选择',
  compact,
  chip,
  searchable,
  searchPlaceholder = '搜索…',
  filter,
  onServerSearch,
  className,
  disabled,
  dropdownSide = 'bottom',
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: CustomSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const serverSearched = useRef(new Set<string>())

  const selected = options.find((o) => o.value === value)

  const filtered = useMemo(() => {
    if (!query.trim()) return options
    const q = query.trim().toLowerCase()
    const fn = filter || ((o: SelectOption, qq: string) => o.label.toLowerCase().includes(qq))
    return options.filter((o) => fn(o, q))
  }, [options, query, filter])

  // 本地无命中且未补搜过 → 触发服务端补搜
  useEffect(() => {
    const q = query.trim()
    if (q && filtered.length === 0 && onServerSearch && !serverSearched.current.has(q)) {
      serverSearched.current.add(q)
      onServerSearch(q)
    }
  }, [filtered.length, query, onServerSearch])

  function pick(o: SelectOption) {
    onChange(o.value)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o && searchable) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          disabled={disabled}
          className={cn(
            'w-full max-w-[400px] justify-between bg-card font-normal text-[0.9rem]',
            compact && 'h-8 max-w-none',
            chip && 'rounded-full',
            className,
          )}
        >
          <span className={cn('truncate', !selected && 'text-muted-foreground')}>
            {selected?.label || placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side={dropdownSide}
        className={cn(
          'admin-custom-select-popover w-(--radix-popover-trigger-width) min-w-[200px] p-0',
          searchable && 'pt-1',   // 顶部留白，避免搜索框聚焦环向上溢出到触发器
          compact && 'w-auto',
        )}
      >
        <Command shouldFilter={false}>
          {searchable && (
            <CommandInput
              placeholder={searchPlaceholder}
              value={query}
              onValueChange={setQuery}
              autoFocus
            />
          )}
          <CommandList>
            {filtered.length === 0 ? (
              <CommandEmpty>{!query.trim() && options.length === 0 ? '暂无选项' : '没有匹配的选项'}</CommandEmpty>
            ) : (
              <CommandGroup>
                {filtered.map((o) => (
                  <CommandItem
                    key={o.value}
                    value={o.value}
                    onSelect={() => pick(o)}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{o.label}</span>
                      {o.sub && <span className="truncate text-xs text-muted-foreground">{o.sub}</span>}
                    </span>
                    {o.value === value && <Check className="size-4 shrink-0" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
