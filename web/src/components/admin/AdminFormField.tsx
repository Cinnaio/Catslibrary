import { useId, type ComponentProps, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

interface FieldIds {
  id: string
  labelId: string
}

interface AdminFormFieldProps extends Omit<ComponentProps<'div'>, 'children'> {
  label: ReactNode
  htmlFor?: string
  labelId?: string
  hint?: ReactNode
  children: ReactNode | ((ids: FieldIds) => ReactNode)
}

/** 字段的标签、控件与说明共用间距；复合控件可通过 render prop 关联标签。 */
export default function AdminFormField({ label, htmlFor, labelId, hint, children, className, ...props }: AdminFormFieldProps) {
  const generatedId = useId()
  const renderControl = typeof children === 'function'
  const id = htmlFor ?? generatedId
  const resolvedLabelId = labelId ?? (renderControl ? `${id}-label` : undefined)

  return (
    <div className={cn('admin-form-field', className)} {...props}>
      <Label htmlFor={htmlFor ?? (renderControl ? id : undefined)} id={resolvedLabelId}>
        {label}
      </Label>
      {renderControl ? children({ id, labelId: resolvedLabelId! }) : children}
      {hint && <p className="admin-form-field__hint text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
