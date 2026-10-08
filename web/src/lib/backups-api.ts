import type { BackupEvent, BackupOverview, BackupPage, BackupPolicy, BackupTarget, BackupTargetInput, BackupTask, BackupVersion } from '@shared/backups'
import { request, authHeaders, url } from './api'

const root = '/admin/backups'
const operation = () => ({ operationId: crypto.randomUUID() })
export const backupsApi = {
  overview: () => request<BackupOverview>('GET', `${root}/overview`, null, true),
  versions: (page: number) => request<BackupPage<BackupVersion>>('GET', `${root}/versions?limit=20&offset=${(page - 1) * 20}`, null, true),
  logs: (page: number, taskId = '', level = '') =>
    request<BackupPage<BackupEvent>>(
      'GET',
      `${root}/logs?limit=20&offset=${(page - 1) * 20}&taskId=${encodeURIComponent(taskId)}&level=${encodeURIComponent(level)}`,
      null,
      true,
    ),
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
  restore: (id: string, body: { previewTaskId: string; previewToken: string; password: string; confirmVersion: string }) =>
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
