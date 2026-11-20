import { useCallback, useState } from 'react'
import type { AiWritingMaterials } from '@/lib/api'

interface PreparationState {
  characterText: string
  preview: { key: string; materials: AiWritingMaterials } | null
  busy: boolean
  error: string
}

/** 由工作区持有临时编辑状态，关闭参考弹窗或切书后仍可恢复。 */
export function useWritingPreparationState(novelId: string, initialCharacters: string) {
  const [drafts, setDrafts] = useState<Record<string, PreparationState>>({})
  const initial: PreparationState = { characterText: initialCharacters, preview: null, busy: false, error: '' }
  const onStateChange = useCallback((patch: Partial<PreparationState>) => {
    setDrafts(previous => ({
      ...previous,
      [novelId]: { characterText: initialCharacters, preview: null, busy: false, error: '', ...previous[novelId], ...patch },
    }))
  }, [novelId, initialCharacters])
  return { state: drafts[novelId] || initial, onStateChange }
}
