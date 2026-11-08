import { createContext, useContext } from 'react'
import type { EdgeController } from './useEdgeController'

interface ReaderTempoPanel {
  open: boolean
  available: boolean
  openPanel: (trigger: HTMLButtonElement) => void
  suspend: () => void
}

// Panel state is separate so timer ticks do not rerender the book or its reading effects.
export const ReaderTempoPanelContext = createContext<ReaderTempoPanel | null>(null)
export const ReaderTempoStateContext = createContext<EdgeController | null>(null)

export function useReaderTempo() {
  const panel = useContext(ReaderTempoPanelContext)
  if (!panel) throw new Error('ReaderTempoProvider is required')
  return panel
}

export function useReaderTempoState() {
  const controller = useContext(ReaderTempoStateContext)
  if (!controller) throw new Error('ReaderTempoProvider is required')
  return controller
}
