import type {
  BackupEvent,
  BackupOverview,
  BackupPage,
  BackupPolicy,
  BackupSettings,
  BackupRehearsalInfo,
  BackupImpactReport,
  BackupImpactFreshness,
  BackupSettingsInput,
  BackupSettingsPage,
  BackupTarget,
  BackupTargetInput,
  BackupTask,
  BackupVersion,
  BackupDeployment,
  BackupDeploymentInput,
} from '@shared/backups'
import { request, authHeaders, url } from './api'

const root = '/admin/backups'
const operation = () => ({ operationId: crypto.randomUUID() })
export const backupsApi = {
  generateDeploymentKey: () => request<{ masterKey: string; keyId: string }>('POST', `${root}/deployment/key`, {}, true),
  saveDeployment: (body: BackupDeploymentInput) => request<{ deployment: BackupDeployment }>('PUT', `${root}/deployment`, body, true),
  detectDeployment: (body: BackupDeploymentInput) => request<{ deployment: BackupDeployment }>('POST', `${root}/deployment/detect`, body, true),
  settings: () => request<BackupSettingsPage>('GET', `${root}/settings`, null, true),
  saveSettings: (body: BackupSettingsInput) => request<BackupSettings>('PUT', `${root}/settings`, body, true),
  rehearsalInfo: () => request<BackupRehearsalInfo>('GET', `${root}/settings/rehearsal`, null, true),
  checkRehearsal: (revision: number) => request<BackupRehearsalInfo>('POST', `${root}/settings/rehearsal/check`, { revision }, true),
  removeRehearsal: (revision: number) => request<{ settings: BackupSettings }>('DELETE', `${root}/settings/rehearsal`, { revision }, true),
  createRehearsal: (revision: number) => request<{ settings: BackupSettings }>('POST', `${root}/settings/rehearsal`, { revision }, true),
  overview: () => request<BackupOverview>('GET', `${root}/overview`, null, true),
  versions: (page: number) => request<BackupPage<BackupVersion>>('GET', `${root}/versions?limit=20&offset=${(page - 1) * 20}`, null, true),
  logs: (page: number, taskId = '', level = '') =>
    request<BackupPage<BackupEvent>>(
      'GET',
      `${root}/logs?limit=20&offset=${(page - 1) * 20}&taskId=${encodeURIComponent(taskId)}&level=${encodeURIComponent(level)}`,
      null,
      true,
    ),
  impact: (id: string, page = 1, group = '', change = '') =>
    request<BackupImpactReport>(
      'GET',
      `${root}/tasks/${encodeURIComponent(id)}/impact?limit=20&offset=${(page - 1) * 20}&group=${encodeURIComponent(group)}&change=${encodeURIComponent(change)}`,
      null,
      true,
    ),
  checkImpact: (id: string, versionId: string) =>
    request<BackupImpactFreshness>('POST', `${root}/tasks/${encodeURIComponent(id)}/impact/check`, { versionId }, true),
  task: (id: string) => request<BackupTask>('GET', `${root}/tasks/${encodeURIComponent(id)}`, null, true),
  backup: (targetIds: string[], note: string) => request<BackupTask>('POST', `${root}/versions`, { ...operation(), targetIds, note }, true),
  saveTarget: (body: BackupTargetInput) => request<BackupTarget>('POST', `${root}/targets`, body, true),
  archiveTarget: (id: string) => request('DELETE', `${root}/targets/${id}`, null, true),
  test: (id: string) => request<BackupTask>('POST', `${root}/targets/${id}/test`, operation(), true),
  savePolicy: (body: BackupPolicy) => request<BackupPolicy>('PUT', `${root}/policy`, body, true),
  pin: (id: string, pinned: boolean) => request('PATCH', `${root}/versions/${id}`, { pinned }, true),
  retry: (id: string) => request<BackupTask>('POST', `${root}/versions/${id}/retry`, operation(), true),
  remove: (id: string) => request<BackupTask>('DELETE', `${root}/versions/${id}`, operation(), true),
  preview: (id: string) => request<BackupTask>('POST', `${root}/versions/${id}/restore-preview`, operation(), true),
  restore: (id: string, body: { previewTaskId: string; previewToken: string; password: string; confirmVersion: string; impactAcknowledged: boolean }) =>
    request<BackupTask>('POST', `${root}/versions/${id}/restore`, { ...operation(), ...body }, true),
  manifest: (id: string) => request<Record<string, unknown>>('GET', `${root}/versions/${id}/manifest`, null, true),
  async download(id: string) {
    const response = await fetch(url(`${root}/versions/${id}/download`), { headers: authHeaders(), credentials: 'include' })
    if (!response.ok) {
      const data = await response.json().catch(() => null)
      throw new Error(data?.error || '下载失败')
    }
    saveBlob(await response.blob(), `${id}.zzbackup`)
  },
}
export function saveBlob(blob: Blob, name: string) {
  const objectUrl = URL.createObjectURL(blob),
    link = document.createElement('a')
  link.href = objectUrl
  link.download = name
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(objectUrl), 10000)
}
