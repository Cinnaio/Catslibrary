import { AsyncLocalStorage } from 'node:async_hooks'
import type { AiTextProgress } from '@shared/ai-text-progress'

type Observer = (progress: AiTextProgress) => void
const observers = new AsyncLocalStorage<Observer>()

export function withAiStreamObserver<T>(observer: Observer, run: () => T): T {
  return observers.run(observer, run)
}

/** Request-local previews; no raw reasoning or tool arguments leave the server. */
export function createRequestProgress() {
  const observer = observers.getStore()
  const now = Date.now()
  const state: AiTextProgress = {
    kind: 'text-progress',
    phase: 'thinking',
    preview: '',
    generatedCharacters: 0,
    reasoningCharacters: 0,
    startedAt: now,
    updatedAt: now,
  }
  let lastEmit = 0
  const emit = (force = false) => {
    if (!observer || (!force && Date.now() - lastEmit < 80)) return
    lastEmit = state.updatedAt = Date.now()
    observer({ ...state })
  }
  emit(true)
  return {
    progress(value: { phase: 'thinking' | 'writing'; reasoningCharacters: number }) {
      Object.assign(state, value)
      emit()
    },
    delta(text: string) {
      state.phase = 'writing'
      state.preview = (state.preview + text).slice(-24000)
      state.generatedCharacters += text.length
      emit()
    },
    finish() {
      emit(true)
    },
  }
}
