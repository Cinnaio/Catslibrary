export type NotificationKind = 'reply' | 'task' | 'test' | 'chapters'
export interface LibraryNotification {
  id: string
  kind: NotificationKind
  title: string
  body: string
  createdAt: number
  readAt: number | null
}
export interface NotificationSettings {
  replies: boolean
  tasks: boolean
  preview: boolean
  quietEnabled: boolean
  quietStart: string
  quietEnd: string
  timeZone: string
  revision: number
}
export interface PushDevice {
  id: string
  name: string
  createdAt: number
  current: boolean
}
export interface NotificationConfiguration {
  settings: NotificationSettings
  devices: PushDevice[]
  publicKey: string
  pushConfigured: boolean
}
