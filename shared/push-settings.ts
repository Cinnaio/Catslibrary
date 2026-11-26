export interface PushAdminSettings {
  revision: number
  source: 'local' | 'environment'
  enabled: boolean
  configured: boolean
  publicKey: string
  privateKeySet: boolean
  subject: string
}
export interface PushAdminInput {
  revision: number
  enabled: boolean
  subject: string
  keyAction: 'keep' | 'generate' | 'import'
  publicKey?: string
  privateKey?: string
  confirmRotation?: boolean
}
