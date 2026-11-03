import type { ComponentType } from 'react'

export const groups = [
  { id: 'foundation', label: '基础规范', description: '颜色、字阶与空间，跟随站点真实设计变量。' },
  { id: 'ui', label: '通用组件', description: '共享 UI 库的控件、浮层、导航与反馈。' },
  { id: 'business', label: '业务组件', description: '书库与管理后台正在使用的真实组件。' },
  { id: 'pages', label: '页面专属', description: '保留首页、后台与阅读器各自的样式和上下文。' },
] as const

export type Group = (typeof groups)[number]['id']
export type PreviewState = 'default' | 'disabled' | 'loading' | 'error' | 'empty'
export const stateLabels: Record<PreviewState, string> = {
  default: '默认',
  disabled: '禁用',
  loading: '加载',
  error: '错误',
  empty: '空内容',
}
export interface ExampleProps {
  state: PreviewState
  boundary: boolean
}
export interface GalleryEntry {
  id: string
  title: string
  group: Group
  description: string
  sources: string[]
  usage: string
  states?: PreviewState[]
  Example: ComponentType<ExampleProps>
}
