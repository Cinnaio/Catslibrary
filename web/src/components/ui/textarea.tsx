import '@/styles/native-form-fields.css'
import '@/styles/input-fields.css'
import * as React from 'react'

import { cn } from '@/lib/utils'
import { useFieldControl } from './field-context'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  const fieldProps = useFieldControl(props)
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-input px-3 py-2 text-base transition-[color,box-shadow] outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
        className,
      )}
      {...fieldProps}
    />
  )
}

export { Textarea }
