import { FilterChip } from '@/components/ui/filter-chip'
import { ControlAppearance, ControlSurface } from '@/components/ui/control-appearance'
import '@/styles/catalog-controls.css'
import '@/styles/admin/tokens.css'
import { useState } from 'react'
import { BookOpen, Copy, Download, LoaderCircle, MoreHorizontal, Settings, Trash2 } from 'lucide-react'
import type { Novel } from '@shared/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { MotionDetails, MotionPresence, MotionView } from '@/components/ui/motion'
import { useListMotion } from '@/hooks/useListMotion'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { InitialAvatar } from '@/components/ui/initial-avatar'
import { UserAvatar } from "@/components/identity/UserAvatar"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from '@/components/ui/sidebar'
import { useToast, useConfirm } from '@/components/feedback'
import NovelCard from '@/components/NovelCard'
import NovelCoverStatus from '@/components/NovelCoverStatus'
import PageState from '@/components/PageState'
import AdminStatusBadge from '@/components/admin/AdminStatusBadge'
import AdminContentRatingBadge from '@/components/admin/AdminContentRatingBadge'
import AdminFloatingDock from '@/components/admin/AdminFloatingDock'
import AdminSelectionBar from '@/components/admin/AdminSelectionBar'
import EmptyState from "@/components/shared/EmptyState"
import FormField from "@/components/shared/FormField"
import AdminPage from '@/components/admin/AdminPage'
import { AdminDataPanel } from '@/components/admin/AdminDataPanel'
import AdminRowActions from '@/components/admin/AdminRowActions'
import { SearchField } from '@/components/shared/SearchField'
import { AdminToolbar } from '@/components/admin/AdminToolbar'
import { DialogFrame, DialogBody } from "@/components/shared/DialogFrame"
import { ReadingDialog, ReadingDialogDisclosure, ReadingDialogEditor, ReadingDialogText, ReadingDialogToolbar } from '@/components/shared/ReadingDialog'
import { LoadingState, ErrorState, InlineError } from "@/components/shared/AsyncStates"
import Pagination from "@/components/shared/Pagination"
import SearchSelect from "@/components/shared/SearchSelect"
import TimeField from "@/components/shared/TimeField"
import { SettingsControls } from '@/components/reader/SettingsControls'
import readerStyles from '../reader.module.css'
import type { ExampleProps } from './gallery-types'

const longTitle = '穿过漫长雨季之后，我们终于在那座没有名字的海边小城再次相遇'
const fixture: Novel = {
  id: 'gallery-fiction',
  title: '山海来信',
  author: 'Cat’s Library示例作者',
  description: '灯塔亮起时，她收到一封来自山那边的信。此处为组件预览使用的虚构书目。',
  categories: ['幻想', '冒险'],
  status: 'ongoing',
  contentRating: 'general',
  coverUrl: '',
  sourceUrl: '',
  chapterCount: 128,
  remoteChapterCount: 136,
  updateCheckedAt: 0,
  createdAt: 0,
  updatedAt: 0,
}

export function Colors() {
  return (
    <div className="gallery-swatches">
      {[
        ['--bg-primary', '页面'],
        ['--bg-secondary', '次级表面'],
        ['--bg-card', '卡片'],
        ['--text-primary', '正文'],
        ['--text-secondary', '次级文字'],
        ['--text-muted', '辅助文字'],
        ['--accent', '品牌'],
        ['--accent-light', '品牌浅色'],
        ['--border', '边框'],
        ['--color-success', '成功'],
        ['--color-warning', '警告'],
        ['--color-danger', '危险'],
      ].map(([token, label]) => (
        <div key={token}>
          <span className="gallery-swatch" style={{ background: `var(${token})` }} />
          <strong>{label}</strong>
          <code>{token}</code>
        </div>
      ))}
    </div>
  )
}
export function Typography({ boundary }: ExampleProps) {
  return (
    <div className="gallery-stack">
      {[
        ['2rem', '展示标题'],
        ['1.25rem', '后台页标题'],
        ['1rem', '正文'],
        ['0.875rem', '辅助文字'],
        ['0.75rem', '元信息'],
      ].map(([size, label]) => (
        <div key={size} className="gallery-type-row">
          <code>{size}</code>
          <span style={{ fontSize: size }}>
            {label} · {boundary ? longTitle : '把故事带到更远的地方'}
          </span>
        </div>
      ))}
      <p className="gallery-serif">阅读衬线 · 风从纸页之间穿过，留下故事的回声。</p>
    </div>
  )
}
export function Spacing() {
  return (
    <div className="gallery-stack">
      <div className="gallery-row">
        {['sm', 'md', 'lg', 'xl', '2xl', 'full'].map((size) => (
          <div key={size} className="gallery-radius" style={{ borderRadius: `var(--radius-${size})` }}>
            <code>{size}</code>
          </div>
        ))}
      </div>
      <div className="gallery-row">
        {[4, 8, 16, 24, 32, 48].map((size) => (
          <div className="gallery-space" key={size}>
            <span style={{ width: size, height: size }} />
            <code>{size}px</code>
          </div>
        ))}
      </div>
      <div className="gallery-row">
        {['--shadow', '--shadow-md', '--shadow-lg', '--shadow-popover'].map((token) => (
          <div key={token} className="gallery-shadow" style={{ boxShadow: `var(${token})` }}>
            <code>{token}</code>
          </div>
        ))}
      </div>
    </div>
  )
}
export function Buttons({ state, boundary }: ExampleProps) {
  const { toast } = useToast()
  return (
    <div className="gallery-stack">
      <div className="gallery-row">
        {(['default', 'secondary', 'outline', 'ghost', 'destructive', 'link'] as const).map((variant) => (
          <Button key={variant} variant={variant} disabled={state === 'disabled' || state === 'loading'} onClick={() => toast(`已点击 ${variant}`)}>
            {state === 'loading' && <LoaderCircle className="animate-spin motion-reduce:animate-none" />}
            {boundary ? '一个需要展示较长文字的操作按钮' : variant}
          </Button>
        ))}
      </div>
      <div className="gallery-row">
        {(['xs', 'sm', 'default', 'lg'] as const).map((size) => (
          <Button key={size} size={size} disabled={state === 'disabled'}>
            {size}
          </Button>
        ))}
        {(['icon-xs', 'icon-sm', 'icon', 'icon-lg'] as const).map((size) => (
          <Button
            key={size}
            size={size}
            variant="outline"
            aria-label={`设置 ${size}`}
            disabled={state === 'disabled'}
            onClick={() => toast('这是图标按钮示例')}
          >
            <Settings />
          </Button>
        ))}
      </div>
    </div>
  )
}
export function Fields({ state, boundary }: ExampleProps) {
  return (
    <div className="gallery-fields">
      <div className="gallery-stack">
        <Label htmlFor="sample-title">小说名称</Label>
        <Input
          key={`${state}-${boundary}`}
          id="sample-title"
          placeholder="输入小说名称"
          defaultValue={state === 'empty' ? '' : boundary ? longTitle : '山海来信'}
          disabled={state === 'disabled'}
          aria-invalid={state === 'error'}
          aria-describedby={state === 'error' ? 'sample-title-error' : undefined}
        />
        {state === 'error' && (
          <p id="sample-title-error" className="gallery-error">
            名称已存在，请使用其他名称。
          </p>
        )}
      </div>
      <div className="gallery-stack">
        <Label htmlFor="sample-description">简介</Label>
        <Textarea
          key={`${state}-${boundary}`}
          id="sample-description"
          placeholder="写下故事简介…"
          disabled={state === 'disabled'}
          aria-invalid={state === 'error'}
          defaultValue={state === 'empty' ? '' : boundary ? longTitle.repeat(6) : '一封来信，开启一段穿过山海的旅程。'}
        />
      </div>
    </div>
  )
}
export function Choices({ state }: ExampleProps) {
  const disabled = state === 'disabled'
  return (
    <div className="gallery-stack">
      <div className="gallery-row">
        <Label className="gallery-row">
          <Checkbox defaultChecked disabled={disabled} />
          保留阅读进度
        </Label>
        <Label className="gallery-row">
          <Checkbox disabled={disabled} />
          自动加入书架
        </Label>
        <Label className="gallery-row">
          <Switch defaultChecked disabled={disabled} />
          显示插图
        </Label>
      </div>
      <RadioGroup defaultValue="serif" disabled={disabled} aria-label="正文字体">
        <Label className="gallery-row">
          <RadioGroupItem value="serif" />
          衬线字体
        </Label>
        <Label className="gallery-row">
          <RadioGroupItem value="sans" />
          无衬线字体
        </Label>
      </RadioGroup>
      <div className="gallery-row">
        <Toggle aria-label="收藏" disabled={disabled} defaultPressed>
          <BookOpen />
          收藏
        </Toggle>
        <ToggleGroup type="single" defaultValue="standard" disabled={disabled} aria-label="行距">
          {['compact', 'standard', 'relaxed'].map((v, i) => (
            <ToggleGroupItem key={v} value={v}>
              {['紧凑', '标准', '舒展'][i]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
    </div>
  )
}
export function Selects({ state }: ExampleProps) {
  return (
    <div className="gallery-row">
      <Select defaultValue={state === 'empty' ? undefined : 'ongoing'} disabled={state === 'disabled'}>
        <SelectTrigger aria-label="连载状态" aria-invalid={state === 'error'}>
          <SelectValue placeholder="选择连载状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="ongoing">连载中</SelectItem>
          <SelectItem value="completed">已完结</SelectItem>
          <SelectItem value="disabled" disabled>
            暂不可用
          </SelectItem>
        </SelectContent>
      </Select>
      <Select defaultValue="15" disabled={state === 'disabled'}>
        <SelectTrigger size="sm" aria-label="每页条数">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {['15', '20', '50', '100'].map((v) => (
            <SelectItem key={v} value={v}>
              {v} 条
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
export function TabExample({ state }: ExampleProps) {
  return (
    <div className="gallery-stack">
      {(['default', 'line'] as const).map((variant) => (
        <Tabs defaultValue="books" key={variant}>
          <TabsList variant={variant}>
            <TabsTrigger value="books">书库</TabsTrigger>
            <TabsTrigger value="history">阅读记录</TabsTrigger>
            <TabsTrigger value="unavailable" disabled>
              暂未开放
            </TabsTrigger>
          </TabsList>
          <TabsContent value="books">{state === 'empty' ? '书库中暂无内容。' : '山海来信 · 连载中 · 128 章'}</TabsContent>
          <TabsContent value="history">尚未产生阅读记录。</TabsContent>
        </Tabs>
      ))}
    </div>
  )
}
export function Badges() {
  return (
    <div className="gallery-row">
      {(['default', 'secondary', 'destructive', 'outline', 'identity', 'ghost', 'link'] as const).map((variant) => (
        <Badge key={variant} variant={variant}>
          {variant}
        </Badge>
      ))}
    </div>
  )
}
export function Avatars() {
  return (
    <div className="gallery-row">
      <InitialAvatar name="舟" />
      <span>中文首字</span>
      <UserAvatar name="Alice" />
      <span>英文首字</span>
      <UserAvatar name="" />
      <span>空名称回退</span>
      <UserAvatar name="林" src="data:image/png;base64,invalid" />
      <span>图片损坏回退</span>
    </div>
  )
}
export function CardExample() {
  const { toast } = useToast()
  return (
    <Card className="gallery-card-example">
      <CardHeader>
        <CardTitle>继续阅读</CardTitle>
        <CardDescription>山海来信 · 第十二章</CardDescription>
      </CardHeader>
      <CardContent>
        <p>上次读到灯塔亮起的地方。</p>
      </CardContent>
      <CardFooter>
        <Button onClick={() => toast('已点击继续阅读示例')}>继续阅读示例</Button>
      </CardFooter>
    </Card>
  )
}
export function TableExample({ state, boundary }: ExampleProps) {
  const [selected, setSelected] = useState(false)
  return (
    <Table>
      <TableCaption>虚构书目，用于检查表格排版与溢出。</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>选择</TableHead>
          <TableHead>书名</TableHead>
          <TableHead>状态</TableHead>
          <TableHead>章节</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {state === 'empty' ? (
          <TableRow>
            <TableCell colSpan={4}>暂无书目</TableCell>
          </TableRow>
        ) : (
          <TableRow data-state={selected ? 'selected' : undefined}>
            <TableCell>
              <Checkbox aria-label="选择示例书目" checked={selected} onCheckedChange={(value) => setSelected(value === true)} disabled={state === 'disabled'} />
            </TableCell>
            <TableCell>{boundary ? longTitle : fixture.title}</TableCell>
            <TableCell>
              <Badge variant="secondary">连载中</Badge>
            </TableCell>
            <TableCell>{boundary ? '999,999' : '128'}</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
export function DialogExample() {
  const { toast } = useToast()
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">打开对话框</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>编辑书目信息</DialogTitle>
          <DialogDescription>这是交互示例，修改只作用于当前预览。</DialogDescription>
        </DialogHeader>
        <Label htmlFor="dialog-book-name">书名</Label>
        <Input id="dialog-book-name" defaultValue="山海来信" />
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">取消</Button>
          </DialogClose>
          <DialogClose asChild>
            <Button onClick={() => toast('示例保存成功', 'success')}>保存示例</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
export function SheetExample() {
  return (
    <div className="gallery-row">
      {(['right', 'bottom'] as const).map((side) => (
        <Sheet key={side}>
          <SheetTrigger asChild>
            <Button variant="outline">{side === 'right' ? '侧边抽屉' : '底部抽屉'}</Button>
          </SheetTrigger>
          <SheetContent side={side}>
            <SheetHeader>
              <SheetTitle>阅读目录</SheetTitle>
              <SheetDescription>检查抽屉位置、遮罩和焦点返回。</SheetDescription>
            </SheetHeader>
            <div className="gallery-stack p-4">
              {['初见', '来信', '远山'].map((title, i) => (
                <p key={title}>
                  第 {i + 1} 章 · {title}
                </p>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      ))}
    </div>
  )
}
export function Overlays() {
  const { toast } = useToast()
  return (
    <div className="gallery-row">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <MoreHorizontal />
            更多操作
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => toast('已复制示例名称')}>
            <Copy />
            复制名称
          </DropdownMenuItem>
          <DropdownMenuItem disabled>当前不可用</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => toast('示例已移除')}>
            <Trash2 />
            移除示例
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline">打开浮层</Button>
        </PopoverTrigger>
        <PopoverContent>
          <p>阅读偏好</p>
          <Separator className="my-3" />
          <Label className="gallery-row">
            <Switch />
            显示章节插图
          </Label>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="icon" aria-label="设置提示">
            <Settings />
          </Button>
        </TooltipTrigger>
        <TooltipContent>可通过鼠标悬停或键盘焦点查看</TooltipContent>
      </Tooltip>
    </div>
  )
}
export function CommandExample() {
  const { toast } = useToast()
  return (
    <Command className="gallery-command">
      <CommandInput placeholder="搜索命令…" />
      <CommandList>
        <CommandEmpty>没有匹配命令</CommandEmpty>
        <CommandGroup heading="示例命令">
          <CommandItem onSelect={() => toast('已选择书库')}>
            <BookOpen />
            打开书库
          </CommandItem>
          <CommandItem onSelect={() => toast('已选择设置')}>
            <Settings />
            阅读设置
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
function MotionListExample() {
  const [items, setItems] = useState(['第一本书', '第二本书', '第三本书'])
  const motion = useListMotion('gallery')
  return <div ref={motion.root} className="flex flex-col gap-3">
    {items.map(item => <div data-motion-item={item} key={item} className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <span>{item}</span><Button variant="ghost" onClick={async () => {
        await motion.remove(item); motion.prepare(); setItems(current => current.filter(value => value !== item))
      }}>移除{item}</Button>
    </div>)}
    {items.length < 3 && <Button data-motion-fallback variant="outline" onClick={() => setItems(['第一本书', '第二本书', '第三本书'])}>恢复示例书目</Button>}
  </div>
}

export function MotionExample() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState('overview')
  const [dirty, setDirty] = useState(false)
  return <div className="flex flex-col gap-4">
    <div className="flex flex-wrap gap-3">
      <Button variant="outline" aria-controls="gallery-motion-panel" aria-expanded={open} onClick={() => setOpen(value => !value)}>展开配置</Button>
      <Button variant="outline" onClick={() => setView(value => value === 'overview' ? 'details' : 'overview')}>切换内容</Button>
      <Button variant="outline" onClick={() => setDirty(value => !value)}>切换保存条</Button>
    </div>
    <MotionPresence open={open} asChild keepMounted mode="disclosure"><Card id="gallery-motion-panel"><CardContent className="p-5"><Input aria-label="动效示例草稿" placeholder="输入内容后反复开关，草稿仍会保留" /></CardContent></Card></MotionPresence>
    <MotionView motionKey={view}><p>{view === 'overview' ? '概览内容' : '详情内容'}</p></MotionView>
    <MotionDetails><summary>展开原生说明</summary><p className="py-4">原生折叠说明保留键盘、浏览器查找及 open 状态。</p></MotionDetails>
    <MotionListExample />
    <AdminFloatingDock open={dirty} reserveSpace><span>示例有未保存修改</span><Button onClick={() => setDirty(false)}>保存示例</Button></AdminFloatingDock>
  </div>
}

export function Disclosure() {
  return (
    <div className="gallery-stack">
      <Collapsible>
        <CollapsibleTrigger asChild>
          <Button variant="outline">展开／收起章节信息</Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <p className="py-3">章节共 128 章，最近更新 8 章。此处为虚构示例。</p>
        </CollapsibleContent>
      </Collapsible>
      <Separator />
      <ScrollArea className="gallery-scroll-area">
        <div className="gallery-stack p-3">
          {Array.from({ length: 16 }, (_, i) => (
            <p key={i}>第 {i + 1} 章 · 山海之间</p>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
export function Feedback({ state, boundary }: ExampleProps) {
  const { toast } = useToast()
  const { confirm } = useConfirm()
  const [value, setValue] = useState(48)
  return (
    <div className="gallery-stack">
      <Alert variant={state === 'error' ? 'destructive' : 'default'}>
        <BookOpen />
        <AlertTitle>{state === 'error' ? '示例导入失败' : '示例提示'}</AlertTitle>
        <AlertDescription>{state === 'error' ? '无法解析文件，请选择其他文件重试。' : '共享提示、进度和轻反馈。'}</AlertDescription>
      </Alert>
      <Progress value={state === 'loading' ? 35 : value} aria-label="示例导入进度" />
      <div className="gallery-row">
        <Button variant="outline" onClick={() => setValue((v) => (v >= 100 ? 0 : Math.min(100, v + 20)))}>
          推进进度 {value}%
        </Button>
        {(['default', 'success', 'error'] as const).map((type) => (
          <Button
            key={type}
            variant="outline"
            onClick={() => toast(type === 'error' ? '示例操作失败，请重试' : type === 'success' ? '示例保存成功' : '这是一条普通提示', type)}
          >
            {type} 提示
          </Button>
        ))}
        <Button
          variant="outline"
          onClick={async () => {
            const ok = await confirm({ title: '移除示例书目？', message: '只演示确认流程，不会更改书库。', danger: true })
            toast(ok ? '已确认示例操作' : '已取消示例操作')
          }}
        >
          打开确认弹窗
        </Button>
        <Button
          variant="outline"
          onClick={() => void confirm({
            title: '批量删除章节',
            message: '确认删除以下章节？此操作不可撤销。此处仅演示，不会更改书库。',
            items: Array.from({ length: boundary ? 40 : 4 }, (_, index) => `第${index + 1}章 · ${boundary ? longTitle : '山海来信'}`),
            danger: true,
            okText: '确认删除',
          })}
        >
          打开清单确认弹窗
        </Button>
        <Button variant="outline" onClick={() => toast('已移除示例', 'default', { action: { label: '撤销', onClick: () => toast('已撤销示例操作') } })}>
          带撤销的提示
        </Button>
      </div>
      <div aria-label="骨架屏示例" className="gallery-stack">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-1/2" />
      </div>
    </div>
  )
}
export function SidebarExample() {
  const [active, setActive] = useState('书库')
  return (
    <SidebarProvider className="gallery-sidebar-example">
      <Sidebar collapsible="none">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>示例导航</SidebarGroupLabel>
            <SidebarMenu>
              {['书库', '阅读记录', '账户设置'].map((title) => (
                <SidebarMenuItem key={title}>
                  <SidebarMenuButton isActive={active === title} onClick={() => setActive(title)}>
                    <BookOpen />
                    <span>{title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
    </SidebarProvider>
  )
}
export function NovelExample({ boundary, state }: ExampleProps) {
  const novel = {
    ...fixture,
    title: boundary ? longTitle : fixture.title,
    description: state === 'empty' ? '' : boundary ? fixture.description.repeat(10) : fixture.description,
    chapterCount: boundary ? 999999 : fixture.chapterCount,
  }
  return (
    <div className="gallery-stack">
      <p className="gallery-note">缺失封面使用真实回退样式；示例链接留在预览内。</p>
      <div className="gallery-novel-grid" onClick={(event) => event.preventDefault()}>
        <NovelCard novel={novel} />
        <div className="home-page gallery-library">
          <NovelCard novel={novel} variant="library" category="幻想" />
        </div>
      </div>
    </div>
  )
}
export function CoverExample() {
  return (
    <div className="gallery-row">
      {[1, 8, 100].map((updates) => (
        <div className="gallery-cover" key={updates}>
          <BookOpen />
          <NovelCoverStatus updates={updates} read favorite />
        </div>
      ))}
    </div>
  )
}
export function StatusExample() {
  return (
    <div className="gallery-stack">
      <div className="gallery-row">
        {(['success', 'info', 'warning', 'danger', 'accent', 'brand', 'muted', 'subtle', 'neutral'] as const).map((tone) => (
          <AdminStatusBadge key={tone} tone={tone}>
            {tone}
          </AdminStatusBadge>
        ))}
      </div>
      <div className="gallery-row">
        {(['general', 'restricted', 'unknown'] as const).map((rating) => (
          <AdminContentRatingBadge key={rating} rating={rating} />
        ))}
      </div>
    </div>
  )
}
export function PaginationExample({ state, boundary }: ExampleProps) {
  const [page, setPage] = useState(1)
  const [size, setSize] = useState(15)
  return (
    <div className="gallery-stack">
      {(['panel', 'detached', 'dialog'] as const).map((variant) => (
        <Pagination
          key={variant}
          variant={variant}
          page={page}
          totalPages={boundary ? 9999 : 8}
          onPage={setPage}
          summary={`共 ${boundary ? '149,985' : '120'} 条 · ${variant}`}
          pageSize={{ value: size, onChange: setSize }}
          busy={state === 'loading'}
        />
      ))}
    </div>
  )
}
export function BusinessFields({ state, boundary }: ExampleProps) {
  const [value, setValue] = useState('fantasy')
  const [time, setTime] = useState('03:00')
  return (
    <div className="gallery-fields">
      <FormField label="分类" hint="可搜索；包含不可选项。">
        {({ id, labelId }) => (
          <SearchSelect
            id={id}
            aria-labelledby={labelId}
            options={
              state === 'empty'
                ? []
                : [
                    { value: 'fantasy', label: boundary ? longTitle : '幻想', sub: '128 本示例书目' },
                    { value: 'history', label: '历史' },
                    { value: 'disabled', label: '暂不可选', disabled: true },
                  ]
            }
            value={value}
            onChange={setValue}
            searchable
            disabled={state === 'disabled'}
            aria-invalid={state === 'error'}
          />
        )}
      </FormField>
      <FormField label="执行时间" hint="只修改此处的示例时间。">
        {({ id, labelId }) => <TimeField presets={['00:00', '02:00', '03:00', '04:00', '12:00']} id={id} aria-labelledby={labelId} value={time} onChange={setTime} disabled={state === 'disabled'} />}
      </FormField>
    </div>
  )
}
export function AsyncExample({ state, boundary }: ExampleProps) {
  const { toast } = useToast()
  if (state === 'loading') return <LoadingState label="正在加载示例书目" />
  if (state === 'error')
    return (
      <div className="gallery-stack">
        <ErrorState message="示例加载失败" onRetry={() => toast('已触发示例重试')} />
        <InlineError message="示例更新失败，保留已有内容" onRetry={() => toast('已触发示例重试')} />
      </div>
    )
  if (state === 'empty')
    return (
      <EmptyState
        icon={<Download aria-hidden="true" />}
        message="暂无下载记录"
        hint="导出内容或下载书源配置后，记录会显示在这里。"
      />
    )
  return (
    <EmptyState
      icon={<BookOpen aria-hidden="true" />}
      message="请先选择作品"
      hint={boundary ? longTitle.repeat(3) : '从上方选择作品后，即可管理目录与正文。'}
      action={
        <Button variant="outline" onClick={() => toast('此处演示空状态操作')}>
          选择示例作品
        </Button>
      }
    />
  )
}
export function AccessExample({ boundary }: ExampleProps) {
  const { toast } = useToast()
  return (
    <PageState
      inline
      title="暂时无法阅读"
      description={boundary ? longTitle.repeat(3) : '该章节尚未收录，请稍后再试。'}
      icon={<BookOpen />}
      actions={
        <Button variant="outline" onClick={() => toast('已点击返回示例')}>
          返回书库示例
        </Button>
      }
    />
  )
}
export function AdminDialogExample() {
  return (
    <ControlAppearance appearance="management"><ControlSurface className="gallery-row">
      {(['form', 'editor', 'reading', 'preview'] as const).map((variant) => (
        <Dialog key={variant}>
          <DialogTrigger asChild>
            <Button variant="outline">{variant} 弹窗</Button>
          </DialogTrigger>
          <DialogFrame variant={variant}>
            <DialogHeader>
              <DialogTitle>后台弹窗 · {variant}</DialogTitle>
              <DialogDescription>真实外观变体，使用虚构内容。</DialogDescription>
            </DialogHeader>
            <DialogBody>
              {variant === 'reading' ? (
                <p>夜色慢慢落在山间，远处的灯塔亮了起来。她展开信纸，读到第一句话。</p>
              ) : variant === 'preview' ? (
                <div className="gallery-cover">
                  <BookOpen />
                </div>
              ) : (
                <FormField label="示例名称">{({ id }) => <Input id={id} defaultValue="山海来信" />}</FormField>
              )}
            </DialogBody>
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline">关闭示例</Button>
              </DialogClose>
            </DialogFooter>
          </DialogFrame>
        </Dialog>
      ))}
    </ControlSurface></ControlAppearance>
  )
}
export function ReadingDialogExample({ boundary, state }: ExampleProps) {
  const [editing, setEditing] = useState(false)
  const [text, setText] = useState('夜色慢慢落在山间，远处的灯塔亮了起来。她展开信纸，读到第一句话。')
  const content = state === 'empty' ? '' : boundary ? Array.from({ length: 30 }, () => text).join('\n\n') : text
  return (
    <Dialog onOpenChange={() => setEditing(false)}>
      <DialogTrigger asChild><Button variant="outline">打开阅读优先弹窗</Button></DialogTrigger>
      <ReadingDialog
        title={boundary ? longTitle : '山海来信'}
        description="第十二章 · 灯塔来信（虚构示例）"
        eyebrow={<><span>内容预览</span><Badge>示例</Badge></>}
        footer={<DialogClose asChild><Button variant="outline">关闭示例</Button></DialogClose>}
      >
        <ReadingDialogToolbar
          label="正文"
          meta={`${content.length.toLocaleString()} 字`}
          actions={<Button size="sm" variant="outline" onClick={() => setEditing(!editing)}>{editing ? '结束编辑' : '编辑示例'}</Button>}
        />
        {editing ? <ReadingDialogEditor aria-label="示例正文" value={text} onChange={(event) => setText(event.target.value)} /> : <ReadingDialogText>{content || '暂无内容'}</ReadingDialogText>}
        <ReadingDialogDisclosure label="生成依据" hint="Prompt">请根据已有章节整理回顾，保留关键事件，不添加原文没有的信息。</ReadingDialogDisclosure>
      </ReadingDialog>
    </Dialog>
  )
}

export function RowActionsExample() {
  const { toast } = useToast()
  return (
    <AdminRowActions
      label="示例书目"
      items={[
        { label: '复制名称', icon: Copy, onSelect: () => toast('已复制示例名称') },
        { label: '删除示例', icon: Trash2, danger: true, onSelect: () => toast('只演示删除菜单') },
      ]}
    >
      <Button variant="ghost" size="sm" onClick={() => toast('只演示编辑操作')}>
        编辑
      </Button>
    </AdminRowActions>
  )
}
export function FloatingActionsExample() {
  const [mode, setMode] = useState<'selection' | 'save' | null>(null)
  const { toast } = useToast()
  return (
    <ControlAppearance appearance="management"><ControlSurface className="admin-layout">
      <div className="gallery-row">
        <Button variant="outline" onClick={() => setMode('selection')}>展示批量操作条</Button>
        <Button variant="outline" onClick={() => setMode('save')}>展示保存条</Button>
      </div>
      <AdminSelectionBar
        count={mode === 'selection' ? 3 : 0}
        label={<>已选 <strong>3</strong> 部</>}
        onClear={() => setMode(null)}
        actions={[
          { label: '追更设置', placement: 'responsive', onSelect: () => toast('只演示追更入口') },
          { label: '导出 ZIP', icon: Download, placement: 'responsive', onSelect: () => toast('只演示导出入口') },
          { label: '反选', placement: 'menu', onSelect: () => toast('只演示反选入口') },
          { label: '删除所选', icon: Trash2, danger: true, placement: 'menu', onSelect: () => toast('只演示删除入口，不删除数据') },
        ]}
      >
        <Button variant="ghost" size="sm" onClick={() => toast('只演示检查更新入口')}>检查更新</Button>
      </AdminSelectionBar>
      {mode === 'save' && <AdminFloatingDock reserveSpace role="region" aria-label="示例保存操作" data-state="open">
        <span className="admin-floating-dock__status" data-dirty>有未保存的更改</span>
        <div className="admin-floating-dock__actions">
          <Button variant="outline" onClick={() => setMode(null)}>撤销更改</Button>
          <Button onClick={() => { setMode(null); toast('只演示保存，不写入配置') }}>保存更改</Button>
        </div>
      </AdminFloatingDock>}
    </ControlSurface></ControlAppearance>
  )
}

export function HomeFilters({ state }: ExampleProps) {
  const [category, setCategory] = useState('全部')
  const [sort, setSort] = useState('最近更新')
  return (
    <div className="home-page gallery-home">
      <div className="filter-panel">
        <div className="filter-row">
          <span className="filter-row__label">分类</span>
          <div className="category-filter gallery-row">
            {['全部', '幻想', '历史', '都市'].map((v) => (
              <FilterChip selected={category === v}  key={v}
type="button"
aria-pressed={category === v}
disabled={state === 'disabled'}
onClick={() => setCategory(v)}>
                {v}
              </FilterChip>
            ))}
          </div>
        </div>
      </div>
      <div className="sort-tabs-row">
        <div className="sort-tabs">
          {['最近更新', '热门阅读'].map((v) => (
            <button type="button" key={v} className={`sort-tab${sort === v ? ' sort-tab--active' : ''}`} onClick={() => setSort(v)}>
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
export function ActionButtons({ state }: ExampleProps) {
  const { toast } = useToast()
  return (
    <div className="gallery-row">
      {(['default', 'secondary', 'ghost', 'destructive'] as const).map((variant) => (
        <Button type="button" key={variant} variant={variant} disabled={state === 'disabled'} onClick={() => toast(`页面按钮 ${variant}`)}>
          {variant}
        </Button>
      ))}
    </div>
  )
}
export function AdminScaffold({ boundary }: ExampleProps) {
  const [query, setQuery] = useState('')
  const { toast } = useToast()
  return (
    <AdminPage title="小说管理" description="后台页头与工具栏的真实组合。" actions={<Button onClick={() => toast('这是示例导入入口')}>导入示例</Button>}>
      <AdminToolbar>
        <SearchField id="sample-search-field" label="搜索示例书目" placeholder="搜索书名或作者…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Badge variant="secondary">{boundary ? '999,999 本' : '128 本'}</Badge>
      </AdminToolbar>
      <div className="gallery-stack">
        <p className="gallery-note">{query ? `当前示例搜索：${query}` : '输入文字可检查搜索控件状态；下方为嵌套布局中的共享数据面板。'}</p>
        <AdminDataPanel ariaLabel="示例作品列表" columns={[{ key: 'title', label: '作品', primary: true, width: '75%' }, { key: 'status', label: '状态', width: '25%' }]} density="comfortable">
          <Table className="admin-data-table">
            <TableHeader><TableRow><TableHead scope="col">作品</TableHead><TableHead scope="col">状态</TableHead></TableRow></TableHeader>
            <TableBody><TableRow><TableCell data-primary="" data-label="作品"><strong>{boundary ? longTitle : fixture.title}</strong></TableCell><TableCell data-label="状态"><AdminStatusBadge tone="success">已发布</AdminStatusBadge></TableCell></TableRow></TableBody>
          </Table>
        </AdminDataPanel>
      </div>
    </AdminPage>
  )
}
export function ReaderSettings() {
  const [settings, setSettings] = useState<Record<string, string>>({
    fontSize: '2',
    fontFamily: 'serif',
    readerLineHeight: '1.95',
    readerParagraphSpacing: '1.4',
    readerPageWidth: 'standard',
    readerPageMode: 'scroll',
    readerTheme: 'default',
    readerAutoScrollSpeed: 'off',
    readerClickPaging: 'off',
    readerWakeLock: 'off',
  })
  return (
    <div className="reader-app gallery-reader-settings">
      <SettingsControls settings={settings} set={(key, value) => setSettings((previous) => ({ ...previous, [key]: value }))} wakeLockSupported={false} />
    </div>
  )
}
export function ReaderPaper({ boundary }: ExampleProps) {
  return (
    <div className={`${readerStyles.page} reader-app gallery-reader`}>
      <article className="reader-paper">
        <header className="reader-chapter-heading"><h2 className="reader-chapter-title">{boundary ? longTitle : '第十二章 · 远山来信'}</h2></header>
        <div className="reader-body">
          <p>傍晚，山间的雾散了。她坐在窗前，将那封未曾署名的信读了又读。</p>
          <p>{boundary ? '这是一段用来检查长段落、换行与阅读宽度的虚构文字。'.repeat(18) : '远方的灯塔依次亮起，像有人在夜色中，轻轻翻开一本书。'}</p>
        </div>
      </article>
    </div>
  )
}
