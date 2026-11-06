export interface MailSettings {
  ready: boolean
  mode: 'smtp' | 'outbox'
  from: string
  publicOrigin: string
  source: 'environment' | 'local'
  revision: number
  host: string
  port: number
  security: 'tls' | 'starttls'
  username: string
  passwordSet: boolean
}

export interface MailSettingsInput {
  revision: number
  host: string
  port: number
  security: 'tls' | 'starttls'
  username: string
  password?: string
  clearPassword?: boolean
  from: string
  publicOrigin: string
}
