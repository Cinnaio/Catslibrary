import { progressSync } from '../lib/progress-sync'

/** 阅读器只提交位置；重试和持久化由应用级同步器持有。 */
export function useProgressSync() {
  return progressSync
}
