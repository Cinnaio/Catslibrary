import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll } from 'vitest'

// 在应用模块加载前隔离部署文件，避免本机密钥启用真实数据库维护连接。
// 每个测试文件有独立目录；需要真实 PostgreSQL 的集成用例仍显式提供连接。
const root = mkdtempSync(path.join(tmpdir(), 'zhi-zhou-test-'))
process.env.ENV_FILE = path.join(root, '.env')
process.env.RUNTIME_CONFIG_DIR = root
process.env.BACKUP_CONFIG_FILE = path.join(root, 'backup-config.json')
process.env.BACKUP_ROOT = path.join(root, 'backups')
for (const name of [
  'DATABASE_URL',
  'BACKUP_ENCRYPTION_KEY',
  'BACKUP_KEY_ID',
  'BACKUP_ALLOWED_HOSTS',
  'BACKUP_REHEARSAL_DATABASE_URL',
  'BACKUP_PG_DUMP_PATH',
  'BACKUP_PG_RESTORE_PATH',
  'BACKUP_PSQL_PATH',
  'BACKUP_RCLONE_PATH',
  'SOURCE_ACCOUNT_ENCRYPTION_KEY',
  'SITE_SETTINGS_ENCRYPTION_KEY',
  'AI_TEXT_API_KEY',
  'AI_IMAGE_API_KEY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'all_proxy',
  'no_proxy',
  'PROXY_BASE',
  'PROXY_BYPASS',
])
  delete process.env[name]

afterAll(() => rmSync(root, { recursive: true, force: true }))
