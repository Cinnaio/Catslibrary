import { AsyncLocalStorage } from 'node:async_hooks'
import { loadConfig, type AiProviderConfig } from '../../config'

const snapshots = new AsyncLocalStorage<{ text: AiProviderConfig; image: AiProviderConfig }>()

/** 一次生成及其派生的后台任务固定使用开始时的供应商。 */
export function withProviderSnapshot<T>(run: () => T): T {
  if (snapshots.getStore()) return run()
  const config = loadConfig()
  return snapshots.run({ text: { ...config.aiText }, image: { ...config.aiImage } }, run)
}

export function providerForScope(scope: 'text' | 'image'): AiProviderConfig {
  const snapshot = snapshots.getStore()
  if (snapshot) return snapshot[scope]
  const config = loadConfig()
  return scope === 'text' ? config.aiText : config.aiImage
}
