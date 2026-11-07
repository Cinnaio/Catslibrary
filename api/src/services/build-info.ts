import { readdir } from 'node:fs/promises'

export interface BuildInfo {
  apiVersion: string
  webVersion: string
  releaseSha: string
  lockHash: string
  nodeVersion: string
  migrations: Array<{ version: number; name: string }> | null
}

declare const __BUILD_INFO__: BuildInfo

/** 生产值由 tsup 从同一份源码、版本文件与锁文件注入；不读取服务器旧 package.json。 */
export const buildInfo: BuildInfo = typeof __BUILD_INFO__ === 'undefined'
  ? { apiVersion: 'development', webVersion: 'development', releaseSha: 'development', lockHash: '', nodeVersion: '', migrations: null }
  : __BUILD_INFO__

export async function requiredMigrations(info = buildInfo): Promise<Array<{ version: number; name: string }>> {
  if (info.migrations) return info.migrations
  const names = await readdir(new URL('../db/migrations/', import.meta.url))
  return names.filter(name => /^\d+.*\.sql$/.test(name)).map(name => ({ version: Number.parseInt(name, 10), name }))
}
