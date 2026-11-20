import { beforeEach, describe, expect, it } from 'vitest'
import type { AgentTask } from '@shared/ai-agent'
import { setStorageUser } from '@/lib/storage'
import { currentAgentTask, pendingAgentKey, readPendingAgentMessage, savePendingAgentMessage } from './agent-task-state'

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  setStorageUser(null)
})

describe('saved agent state', () => {
  it('retains chapter plan mode and revision while rejecting malformed or ambiguous receipts', () => {
    const key = 'plan-receipt'
    const request = { id: 'plan_request', content: '确认', providerPresetId: '' }
    sessionStorage.setItem(key, JSON.stringify({ ...request, chapterPlanRevision: 3 }))
    expect(readPendingAgentMessage(key)?.chapterPlanRevision).toBe(3)
    sessionStorage.setItem(key, JSON.stringify({ ...request, planningOnly: true }))
    expect(readPendingAgentMessage(key)?.planningOnly).toBe(true)
    for (const value of [{ chapterPlanRevision: -1 }, { chapterPlanRevision: '3' }, { planningOnly: true, chapterPlanRevision: 3 }, { planningOnly: 'true' }]) {
      sessionStorage.setItem(key, JSON.stringify({ ...request, ...value }))
      expect(readPendingAgentMessage(key)).toBeNull()
    }
  })
  const running: AgentTask = { id: 'task', kind: 'agent_chat', status: 'running', current: 0, total: 1, step: '处理中', error: '', updatedAt: 20 }
  it('never hides terminal state behind a stale running packet in either direction', () => {
    const failed: AgentTask = { ...running, status: 'failed', updatedAt: 10 }
    expect(currentAgentTask(failed, running)).toEqual(failed)
    expect(currentAgentTask(running, failed)).toEqual(failed)
    expect(currentAgentTask(running, { ...running, updatedAt: 10 })).toEqual(running)
    expect(currentAgentTask(running, { ...failed, id: 'another' })).toEqual(running)
  })
  it('isolates uncertain sends by verified account, novel and conversation', () => {
    expect(pendingAgentKey('book', 'session')).toBe('')
    localStorage.setItem('user_session_marker', 'marker')
    expect(pendingAgentKey('book', 'session')).toBe('')
    setStorageUser('one')
    const key = pendingAgentKey('book', 'session')
    savePendingAgentMessage(key, { id: 'request_123', content: '未确认送达', providerPresetId: 'text-preset' })
    expect(readPendingAgentMessage(key)?.content).toBe('未确认送达')
    expect(readPendingAgentMessage(pendingAgentKey('book-2', 'session'))).toBeNull()
    expect(readPendingAgentMessage(pendingAgentKey('book', 'session-2'))).toBeNull()
    setStorageUser('two')
    expect(readPendingAgentMessage(pendingAgentKey('book', 'session'))).toBeNull()
    localStorage.setItem('user_session_marker', 'new-login')
    expect(pendingAgentKey('book', 'session')).toBe('')
    sessionStorage.setItem(key, JSON.stringify({ id: 'invalid identifier', content: '损坏', providerPresetId: '' }))
    expect(readPendingAgentMessage(key)).toBeNull()
  })
})
