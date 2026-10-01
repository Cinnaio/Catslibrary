/** Preserve old bookmarks and AI's saved location while consolidating navigation. */
export function monitoringRedirect(tab: string | undefined, search: string, savedAiSub?: string | null): string | null {
  const params = new URLSearchParams(search)
  if (tab === 'jobs') {
    if (!params.has('view')) params.set('view', 'scrape')
    return `/admin/tasks?${params}`
  }
  if (tab !== 'ai') return null
  const sub = params.get('sub') || savedAiSub
  if (!['tasks', 'usage', 'audit'].includes(sub || '')) return null
  params.delete('sub')
  params.set('view', 'ai')
  return `/admin/${sub === 'tasks' ? 'tasks' : 'calls'}?${params}`
}
