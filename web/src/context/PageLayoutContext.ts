import { createContext } from 'react'

/** Full-page states temporarily own the viewport; normal browsing restores the shell. */
export const PageLayoutContext = createContext<((standalone: boolean) => void) | null>(null)
