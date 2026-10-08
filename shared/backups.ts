export type BackupState = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'interrupted'
export type BackupKind = 'backup' | 'test' | 'retry' | 'preview' | 'restore' | 'delete'
export interface BackupTarget {
  id: string
  name: string
  type: 'sftp' | 'webdav' | 's3'
  enabled: boolean
  required: boolean
  host: string
  port: number
  path: string
  username: string
  hostKey: string
  bucket: string
  region: string
  credentialSet: boolean
  revision: number
  retention: number
}
export interface BackupTargetInput extends Omit<BackupTarget, 'id' | 'credentialSet' | 'revision'> {
  id?: string
  revision?: number
  password?: string
  privateKey?: string
  clearCredential?: boolean
}
export interface BackupPolicy {
  enabled: boolean
  schedule: 'daily' | 'weekly' | 'interval'
  time: string
  timezone: string
  weekday: number
  intervalHours: number
  targetIds: string[]
  localRetention: number
  nextRunAt: number
  revision: number
}
export interface BackupCopy {
  targetId: string
  name: string
  state: string
  verifiedAt: number
  error: string
}
export interface BackupVersion {
  id: string
  createdAt: number
  snapshotAt: number
  state: BackupState
  size: number
  digest: string
  note: string
  pinned: boolean
  protection: boolean
  trigger: string
  migrationVersion: number
  copies: BackupCopy[]
}
export interface BackupTask {
  id: string
  kind: BackupKind
  versionId: string
  state: BackupState
  stage: string
  actor: string
  createdAt: number
  finishedAt: number
  error: string
  result: { previewToken?: string; expiresAt?: number; administrators?: string[]; protectionId?: string } | null
}
export interface BackupEvent {
  id: number
  taskId: string
  level: string
  message: string
  createdAt: number
}
export interface BackupOverview {
  policy: BackupPolicy
  targets: BackupTarget[]
  capabilities: { encryption: boolean; dump: boolean; restore: boolean; transfer: boolean; rehearsal: boolean; allowedHosts: string[] }
  maintenance: boolean
  tasks: BackupTask[]
}
export interface BackupPage<T> {
  items: T[]
  total: number
}
