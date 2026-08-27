/**
 * 运行时配置层 —— /install 向导写入的持久化配置。
 * 存 data/runtime-config.json（已 gitignore），仅白名单键。
 * 优先级：真实环境变量 > .env > 运行时文件（applyRuntimeConfigToEnv 仅填空）。
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// 惰性解析：允许测试在 import 后经 RUNTIME_CONFIG_DIR 重定向到临时目录
function dataDir(): string {
  return process.env.RUNTIME_CONFIG_DIR || path.join(PROJECT_ROOT, 'data')
}
function configFile(): string {
  return path.join(dataDir(), 'runtime-config.json')
}

/** 允许经向导写入的键；其余一律丢弃。 */
const ALLOWED_KEYS = [
  'DATABASE_URL',
  'AI_TEXT_BASE_URL',
  'AI_TEXT_API_KEY',
  'AI_TEXT_MODEL',
  'AI_IMAGE_BASE_URL',
  'AI_IMAGE_API_KEY',
  'AI_IMAGE_MODEL',
  'PROXY_BASE',
  'PROXY_BYPASS',
  // Retained so existing runtime files can be read and cleaned up during migration.
  'PROXY_DOMAINS',
  'CORS_ORIGINS',
  'SESSION_HASH_SALT',
  'THOUGHT_HASH_SALT',
  'SOURCE_ACCOUNT_ENCRYPTION_KEY',
] as const

export type RuntimeConfigKey = (typeof ALLOWED_KEYS)[number]

export function isAllowedRuntimeKey(key: string): key is RuntimeConfigKey {
  return (ALLOWED_KEYS as readonly string[]).includes(key)
}

export function readRuntimeConfig(): Partial<Record<RuntimeConfigKey, string>> {
  try {
    const file = configFile()
    if (!existsSync(file)) return {}
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
    const out: Partial<Record<RuntimeConfigKey, string>> = {}
    for (const key of ALLOWED_KEYS) {
      const v = raw[key]
      if (typeof v === 'string' && v.trim()) out[key] = v.trim()
    }
    return out
  } catch (err) {
    console.warn('[runtime-config] 读取失败（忽略）:', (err as Error)?.message || err)
    return {}
  }
}

/**
 * 把运行时文件的键写入 process.env —— 仅当该键当前为空。
 * 保证运维经真实环境变量 / .env 显式设定的值不被向导覆盖。
 */
export function applyRuntimeConfigToEnv(): void {
  const stored = readRuntimeConfig()
  for (const [key, value] of Object.entries(stored)) {
    if (!process.env[key]?.trim()) process.env[key] = value
  }
}

/**
 * 把 patch 同步到 process.env，遵循与安装向导相同的优先级：
 * 仅当当前 env 值为空，或与运行时层旧值一致（即来自运行时文件而非显式设定）时才覆盖。
 * 真实环境变量 / .env 显式设定的值始终优先，不被后台修改覆盖。
 * 注意：调用方须先快照旧文件值再调 writeRuntimeConfig，否则 before 已是新值，比对无意义。
 * 返回 patch 里哪些键最终被写入了 env。
 */
export function syncRuntimeConfigToEnv(before: Partial<Record<RuntimeConfigKey, string>>, patch: Partial<Record<RuntimeConfigKey, string>>): string[] {
  const applied: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    if (!isAllowedRuntimeKey(key)) continue
    const current = process.env[key]?.trim() || ''
    // env 当前值非空且与旧文件值不同 → 视为运维显式设定，跳过，不覆盖
    if (current && current !== (before as Record<string, string | undefined>)[key]) continue
    if (value) process.env[key] = value
    else delete process.env[key]
    applied.push(key)
  }
  return applied
}

/** 合并写入（patch 中空字符串表示删除该键）。写后尽力 chmod 0600。 */
export function writeRuntimeConfig(patch: Partial<Record<RuntimeConfigKey, string>>): void {
  const merged: Partial<Record<RuntimeConfigKey, string>> = { ...readRuntimeConfig() }
  for (const [key, value] of Object.entries(patch)) {
    if (!isAllowedRuntimeKey(key)) continue
    const v = typeof value === 'string' ? value.trim() : ''
    if (v) merged[key] = v
    else delete merged[key]
  }
  mkdirSync(dataDir(), { recursive: true })
  const file = configFile()
  writeFileSync(file, JSON.stringify(merged, null, 2) + '\n', 'utf8')
  try {
    chmodSync(file, 0o600)
  } catch {
    /* Windows 等平台不支持时忽略 */
  }
}

/** 供 setup/status 回显：哪些可选键已有值（不回传值本身）。 */
export function configuredRuntimeKeys(): RuntimeConfigKey[] {
  return Object.keys(readRuntimeConfig()) as RuntimeConfigKey[]
}

/** 历史默认盐；检测到即视为未配置，替换为随机值。 */
const LEGACY_DEFAULT_SALT = 'zhi-zhou'
const SALT_KEYS = ['SESSION_HASH_SALT', 'THOUGHT_HASH_SALT'] as const

/**
 * 确保两个哈希盐存在且非弱默认值：缺失或等于历史默认 'zhi-zhou' 时
 * 生成 256 位随机盐，持久化到运行时文件并注入 env（重启后稳定）。
 * 运维经环境变量 / .env 显式设定的强盐不受影响。
 * 仅在生产启动入口调用（不放模块副作用，避免测试进程写仓库 data/）。
 */
export function ensureRuntimeSalts(): void {
  const patch: Partial<Record<RuntimeConfigKey, string>> = {}
  for (const key of SALT_KEYS) {
    const current = process.env[key]?.trim() || ''
    if (current && current !== LEGACY_DEFAULT_SALT) continue
    const salt = randomBytes(32).toString('hex')
    patch[key] = salt
    process.env[key] = salt
    console.log(`[config] ${key} 未配置或为默认值，已生成随机盐并持久化`)
  }
  if (Object.keys(patch).length > 0) writeRuntimeConfig(patch)
}
