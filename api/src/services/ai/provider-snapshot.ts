import { AsyncLocalStorage } from 'node:async_hooks'
import { loadConfig, type AiProviderConfig } from '../../config'

type ProviderSnapshot = { text: AiProviderConfig; image: AiProviderConfig }
const snapshots = new AsyncLocalStorage<ProviderSnapshot>()

/** 一次生成及其派生的后台任务固定使用开始时的供应商。 */
export function withProviderSnapshot<T>(run: () => T, overrides?: Partial<ProviderSnapshot>): T {
  const current = snapshots.getStore()
  if (current && !overrides) return run()
  const config = current ? null : loadConfig()
  return snapshots.run(
    { text: { ...(overrides?.text ?? current?.text ?? config!.aiText) }, image: { ...(overrides?.image ?? current?.image ?? config!.aiImage) } },
    run,
  )
}

export function providerForScope(scope: 'text' | 'image'): AiProviderConfig {
  const snapshot = snapshots.getStore()
  if (snapshot) return snapshot[scope]
  const config = loadConfig()
  return scope === 'text' ? config.aiText : config.aiImage
}
