"use client"

import { createContext, useContext, useState } from 'react'
import { Collapsible as CollapsiblePrimitive } from "radix-ui"
import { MotionPresence } from './motion'

const Visibility = createContext(false)

function Collapsible({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.Root>) {
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const visible = open ?? localOpen
  return <Visibility.Provider value={visible}><CollapsiblePrimitive.Root data-slot="collapsible" {...props} open={visible} onOpenChange={value => {
    if (open === undefined) setLocalOpen(value)
    onOpenChange?.(value)
  }} /></Visibility.Provider>
}

function CollapsibleTrigger({
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleTrigger>) {
  return (
    <CollapsiblePrimitive.CollapsibleTrigger
      data-slot="collapsible-trigger"
      {...props}
    />
  )
}

function CollapsibleContent({
  forceMount,
  ...props
}: React.ComponentProps<typeof CollapsiblePrimitive.CollapsibleContent>) {
  const open = useContext(Visibility)
  return (
    <MotionPresence asChild open={open} mode="disclosure" keepMounted={forceMount}><CollapsiblePrimitive.CollapsibleContent
      data-slot="collapsible-content"
      {...props}
      forceMount
    /></MotionPresence>
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
