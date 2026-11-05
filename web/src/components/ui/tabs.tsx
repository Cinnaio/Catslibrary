import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Tabs as TabsPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import styles from './tabs.module.css'

function Tabs({ className, orientation = 'horizontal', ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn('group/tabs flex gap-2 data-[orientation=horizontal]:flex-col', className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center justify-center rounded-[14px] p-[3px] text-muted-foreground group-data-[orientation=horizontal]/tabs:h-9 group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        default: 'bg-muted',
        line: 'gap-1 bg-transparent',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
)

function TabsList({
  className,
  variant = 'default',
  children,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const positioned = React.useRef(false)
  const [indicatorStyle, setIndicatorStyle] = React.useState<React.CSSProperties>({
    opacity: 0,
  })

  const update = React.useCallback(() => {
    if (typeof window === 'undefined') return
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-state="active"]')
    if (!active) {
      positioned.current = false
      setIndicatorStyle({ opacity: 0 })
      return
    }
    // 当元素在 jsdom 下 offsetWidth 为 0 时不显示，避免测试环境计算
    if (active.offsetWidth === 0 && active.offsetHeight === 0) {
      return
    }
    const firstPlacement = !positioned.current
    positioned.current = true
    setIndicatorStyle({
      transform: `translate3d(${active.offsetLeft}px, ${active.offsetTop}px, 0)`,
      width: `${active.offsetWidth}px`,
      height: `${active.offsetHeight}px`,
      opacity: 1,
      // 首次挂载直接落位；后续选择与尺寸变化才从上一个位置平滑过渡。
      ...(firstPlacement ? { transition: 'none' } : {}),
    })
  }, [])

  React.useLayoutEffect(() => {
    if (variant === 'line') return
    const list = listRef.current
    if (!list) return
    positioned.current = false
    let frame = 0
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    }
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    const observeSizes = () => {
      resize?.disconnect()
      resize?.observe(list)
      list.querySelectorAll<HTMLElement>('[data-slot="tabs-trigger"]').forEach((trigger) => resize?.observe(trigger))
    }
    const mutations = new MutationObserver(() => {
      observeSizes()
      schedule()
    })
    mutations.observe(list, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] })
    observeSizes()
    update()
    window.addEventListener('resize', schedule)
    return () => {
      cancelAnimationFrame(frame)
      mutations.disconnect()
      resize?.disconnect()
      window.removeEventListener('resize', schedule)
    }
  }, [update, variant])

  return (
    <TabsPrimitive.List
      ref={listRef}
      data-slot="tabs-list"
      data-variant={variant}
      data-indicator-ready={variant !== 'line' && indicatorStyle.opacity === 1}
      className={cn(styles.list, 'relative isolate', tabsListVariants({ variant }), className)}
      {...props}
    >
      {variant !== 'line' && <span data-slot="tabs-indicator" className={styles.indicator} style={indicatorStyle} aria-hidden="true" />}
      {children}
    </TabsPrimitive.List>
  )
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        styles.trigger,
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 group-data-[variant=default]/tabs-list:data-[state=active]:shadow-sm group-data-[variant=line]/tabs-list:data-[state=active]:shadow-none dark:text-muted-foreground dark:hover:text-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        'group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:border-transparent dark:group-data-[variant=line]/tabs-list:data-[state=active]:bg-transparent',
        'data-[state=active]:bg-background data-[state=active]:text-foreground dark:data-[state=active]:border-input dark:data-[state=active]:bg-input/30 dark:data-[state=active]:text-foreground',
        'after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-[orientation=horizontal]/tabs:after:inset-x-0 group-data-[orientation=horizontal]/tabs:after:bottom-[-5px] group-data-[orientation=horizontal]/tabs:after:h-0.5 group-data-[orientation=vertical]/tabs:after:inset-y-0 group-data-[orientation=vertical]/tabs:after:-right-1 group-data-[orientation=vertical]/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-[state=active]:after:opacity-100',
        className,
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content data-slot="tabs-content" className={cn('flex-1 outline-none', className)} {...props} />
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
