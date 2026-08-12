import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyRuntimeConfigToEnv } from './runtime-config'

/** 应用配置：读取根目录 .env（真实环境变量优先）。 */
export interface AiProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface AppConfig {
  port: number
  databaseUrl: string
  configured: boolean
  corsOrigins: string[]
  sessionHashSalt: string
  /** 是否信任反向代理的转发头（CF-Connecting-IP / X-Forwarded-For / X-Real-IP）。 */
  trustProxy: boolean
  proxyBase: string
  proxyDomains: string
  aiText: AiProviderConfig
  aiImage: AiProviderConfig
}

const PROJECT_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENV_FILE = process.env.ENV_FILE || path.join(PROJECT_ROOT, '.env')

if (existsSync(ENV_FILE) && typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile(ENV_FILE)
  } catch (err) {
    console.warn('[config] 无法读取 .env:', (err as Error)?.message || err)
  }
}

// 运行时配置（/install 向导写入的 data/runtime-config.json）仅填补空缺键：
// 真实环境变量 > .env > 运行时文件
applyRuntimeConfigToEnv()

export function loadConfig(): AppConfig {
  const databaseUrl = process.env.DATABASE_URL?.trim() || ''
  const corsOrigins = (process.env.CORS_ORIGINS || process.env.CORS_ORIGIN || '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)

  return {
    port: Number.parseInt(process.env.PORT || '8787', 10),
    databaseUrl,
    configured: Boolean(databaseUrl),
    corsOrigins,
    sessionHashSalt: process.env.SESSION_HASH_SALT?.trim() || 'zhi-zhou',
    trustProxy: /^(1|true|yes)$/i.test(process.env.TRUST_PROXY?.trim() || ''),
    proxyBase: process.env.PROXY_BASE?.trim() || '',
    proxyDomains: process.env.PROXY_DOMAINS?.trim() || process.env.PROXY_ALLOW_HOSTS?.trim() || '',
    aiText: {
      baseUrl: process.env.AI_TEXT_BASE_URL?.trim() || '',
      apiKey: process.env.AI_TEXT_API_KEY?.trim() || '',
      model: process.env.AI_TEXT_MODEL?.trim() || 'deepseek-v4-flash',
    },
    aiImage: {
      baseUrl: process.env.AI_IMAGE_BASE_URL?.trim() || '',
      apiKey: process.env.AI_IMAGE_API_KEY?.trim() || '',
      model: process.env.AI_IMAGE_MODEL?.trim() || 'mimo-v2.5',
    },
  }
}
