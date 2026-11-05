import { useId, type ComponentProps } from 'react'
import { cn } from '@/lib/utils'
import { Search as SearchIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import styles from './SearchField.module.css'

interface SearchFieldProps extends ComponentProps<'input'> {
  /** 读屏用的标签文字；视觉上隐藏。 */
  label: string
}

/**
 * 工具栏搜索框：在输入框内左侧嵌入放大镜图标。
 * 光秃的 Input 只有一个 placeholder 作为「这是搜索」的线索，一旦输入内容
 * 线索就消失；图标提供常驻的视觉锚点，也是搜索控件的通用惯例。
 */
export function SearchField({ label, className, id, ...props }: SearchFieldProps) {
  const generatedId = useId()
  const controlId = id ?? generatedId
  return (
    <div className={cn(styles.field, 'search-field')}>
      <SearchIcon className={styles.icon} aria-hidden="true" />
      <Label htmlFor={controlId} className="sr-only">
        {label}
      </Label>
      <Input type="search" id={controlId} className={cn(styles.input, className)} {...props} />
    </div>
  )
}
