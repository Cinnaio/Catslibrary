import { useState } from 'react'

export function useAgentTextComparisonControls() {
  const [side, setSide] = useState('after')
  const [onlyChanges, setOnlyChanges] = useState(false)
  return { side, setSide, onlyChanges, setOnlyChanges }
}

export type AgentTextComparisonControls = ReturnType<typeof useAgentTextComparisonControls>
