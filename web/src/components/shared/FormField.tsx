import { useId, type ComponentProps, type ReactNode } from 'react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { FieldControlContext } from '@/components/ui/field-context'
import styles from './FormField.module.css'

interface FieldIds {
  id: string
  labelId: string
  describedBy?: string
}

interface FormFieldProps extends Omit<ComponentProps<'div'>, 'children'> {
  label: ReactNode
  htmlFor?: string
  labelId?: string
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode | ((ids: FieldIds) => ReactNode)
}

/** 字段的标签、控件与说明共用间距；复合控件可通过 render prop 关联标签。 */
export default function FormField({ label, htmlFor, labelId, hint, error, children, className, ...props }: FormFieldProps) {
  const generatedId = useId()
  const renderControl = typeof children === 'function'
  const id = htmlFor ?? generatedId
  const resolvedLabelId = labelId ?? `${id}-label`
  const describedBy = [hint ? `${id}-hint` : undefined, error ? `${id}-error` : undefined].filter(Boolean).join(' ') || undefined

  return (
    <div className={cn(styles.field, 'form-field', className)} {...props}>
      <Label htmlFor={id} id={resolvedLabelId}>
        {label}
      </Label>
      <FieldControlContext.Provider value={{ id, labelId: resolvedLabelId, describedBy, invalid: error ? true : undefined }}>
        {renderControl ? children({ id, labelId: resolvedLabelId, describedBy }) : children}
      </FieldControlContext.Provider>
      {hint && (
        <p id={`${id}-hint`} className={styles.hint}>
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className={styles.error}>
          {error}
        </p>
      )}
    </div>
  )
}
