export type MailSecretSource = 'local' | 'environment' | 'site' | 'none'

/** Only configuration metadata crosses the API boundary. */
export interface MailSecuritySettings {
  revision: number
  encryptionReady: boolean
  queueSource: MailSecretSource
  queueCanInitialize: boolean
  queueIssue: 'invalid' | 'retained-payload' | null
  webhookReady: boolean
  webhookSource: MailSecretSource
  webhookInvalid: boolean
  webhookUrl: string
}

export interface MailSecuritySettingsInput {
  revision: number
  generateQueueKey: boolean
  queueEncryptionKey: string
  webhookSecret: string
  reason: string
}
