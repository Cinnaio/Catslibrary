import { createContext, useContext, type AriaAttributes } from 'react'

/** 一个字段容器只关联主控件；显式设置其他 id 的辅助控件保留自己的语义。 */
export interface FieldControl {
  id: string
  labelId: string
  describedBy?: string
  invalid?: AriaAttributes['aria-invalid']
}

export const FieldControlContext = createContext<FieldControl | null>(null)

export function useFieldControl(props: { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: AriaAttributes['aria-invalid'] }) {
  const field = useContext(FieldControlContext)
  if (!field || (props.id && props.id !== field.id)) return props
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby':
      [...new Set([props['aria-describedby'], field.describedBy].flatMap((value) => value?.split(/\s+/).filter(Boolean) ?? []))].join(' ') || undefined,
    'aria-invalid': props['aria-invalid'] ?? field.invalid,
  }
}
