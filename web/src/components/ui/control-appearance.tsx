import { createContext, useContext, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import styles from './control-appearance.module.css'

export type ControlAppearanceName = 'default' | 'management'
type Appearance = ControlAppearanceName
const AppearanceContext = createContext<Appearance>('default')

/** 只传递视觉角色；React context 使 portal 与触发器采用同一尺寸。 */
export function ControlAppearance({ appearance, children }: { appearance: Appearance; children: ReactNode }) {
  return <AppearanceContext.Provider value={appearance}>{children}</AppearanceContext.Provider>
}

export function useControlAppearance() {
  const appearance = useContext(AppearanceContext)
  return { 'data-ui': appearance, className: appearance === 'management' ? styles.management : undefined }
}

/** 显式的视觉作用域；页面及展厅使用同一入口，portal 由 context 接续。 */
export function ControlSurface({ className, ...props }: ComponentProps<'div'>) {
  const appearance = useControlAppearance()
  return <div data-ui={appearance['data-ui']} className={cn(appearance.className, className)} {...props} />
}
