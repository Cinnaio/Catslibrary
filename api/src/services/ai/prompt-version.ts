/** 持久化提示词版本读取：缺失只为历史兼容，显式未知版本必须失败。 */
export function resolveStoredPipelineVersion(value: unknown, current: number, legacy: number): { version?: number; error?: string } {
  if (value === undefined || value === null || value === '') return { version: legacy }
  const version = Number(value)
  if (!Number.isInteger(version) || (version !== current && version !== legacy)) {
    return { error: `不支持的 AI 提示词流水线版本：${String(value)}` }
  }
  return { version }
}
