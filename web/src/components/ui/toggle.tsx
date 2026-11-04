import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { Toggle as TogglePrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import styles from './toggle.module.css'

const toggleVariants = cva(styles.toggle, {
  variants: {
    variant: { default: '', outline: styles.outline },
    size: { default: '', sm: styles.small, lg: styles.large },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

function Toggle({ className, variant, size, ...props }: React.ComponentProps<typeof TogglePrimitive.Root> & VariantProps<typeof toggleVariants>) {
  return <TogglePrimitive.Root data-slot="toggle" className={cn(toggleVariants({ variant, size, className }))} {...props} />
}

export { Toggle, toggleVariants }
