'use client'

import * as React from 'react'
import { Switch as SwitchPrimitive } from 'radix-ui'

import { cn } from '@/lib/utils'
import styles from './switch.module.css'

function Switch({
  className,
  size = 'default',
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: 'sm' | 'default'
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        styles.switch,
        'peer group/switch inline-flex shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50',
        'data-[size=default]:h-5 data-[size=default]:w-9 data-[size=default]:p-0.5',
        'data-[size=sm]:h-4 data-[size=sm]:w-7 data-[size=sm]:p-0.5',
        'data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          styles.thumb,
          'pointer-events-none block rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2),0_1px_2px_rgba(0,0,0,0.12)] ring-0 transition-transform',
          'group-data-[size=default]/switch:size-3.5 group-data-[size=sm]/switch:size-2.5',
          'data-[state=checked]:[transform:translateX(1rem)] group-data-[size=sm]/switch:data-[state=checked]:[transform:translateX(0.75rem)] data-[state=unchecked]:[transform:translateX(0)]',
          'dark:bg-white',
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
