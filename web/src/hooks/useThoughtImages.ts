import { useCallback, useEffect, useRef, useState } from 'react'
import { newOperationId, thoughtsApi, type ThoughtImageTask } from '../lib/api'
import type { Thought } from '@shared/types'

/** 任务绑定账号和章节；离开段落仍继续生成，回到章节可从服务端恢复进度。 */
export function useThoughtImages(chapterId: string, userId: string, onPublished: (thought: Thought) => void) {
  const scope = `${userId}:${chapterId}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const [state, setState] = useState<{ scope: string; allowed: boolean; task: ThoughtImageTask | null; starting: boolean; error: string }>({
    scope,
    allowed: false,
    task: null,
    starting: false,
    error: '',
  })
  const publishedRef = useRef(onPublished)
  publishedRef.current = onPublished
  const operation = useRef<{ scope: string; payload: string; id: string } | null>(null)
  const current = state.scope === scope ? state : { scope, allowed: false, task: null, starting: false, error: '' }

  useEffect(() => {
    let cancelled = false
    if (!userId || !chapterId) return
    void Promise.all([thoughtsApi.imageCapabilities(), thoughtsApi.imageTask(chapterId)])
      .then(([capabilities, result]) => {
        if (cancelled) return
        // 不覆盖初始化期间由用户刚创建的任务。
        setState((prev) => ({
          scope,
          allowed: capabilities.allowed,
          task: prev.scope === scope && prev.task ? prev.task : result.task,
          starting: prev.scope === scope && prev.starting,
          error: '',
        }))
        if (result.task?.thought) publishedRef.current(result.task.thought)
      })
      .catch(() => {
        /* 能力读取失败时保持入口关闭，普通想法不受影响。 */
      })
    return () => {
      cancelled = true
    }
  }, [scope, userId, chapterId])

  const task = current.task
  const taskId = task?.id
  const taskStatus = task?.status
  useEffect(() => {
    if (!taskId || !taskStatus || !['queued', 'running'].includes(taskStatus)) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await thoughtsApi.imageTask(chapterId, taskId)
        if (cancelled) return
        if (!result.task) {
          setState((prev) => ({ ...prev, task: null, error: '图片任务已不存在' }))
          return
        }
        setState((prev) => ({ ...prev, task: result.task, error: '' }))
        if (result.task.thought) publishedRef.current(result.task.thought)
        if (!['queued', 'running'].includes(result.task.status)) return
      } catch (err) {
        if (cancelled) return
        setState((prev) => ({ ...prev, error: `${(err as Error).message}；正在重新查询进度` }))
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 2000)
    }
    timer = setTimeout(() => void poll(), 1000)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [taskId, taskStatus, chapterId, scope])

  const generate = useCallback(
    async (input: Record<string, unknown>) => {
      const payload = JSON.stringify(input)
      if (!operation.current || operation.current.scope !== scope || operation.current.payload !== payload)
        operation.current = { scope, payload, id: newOperationId('thought-image') }
      setState((prev) => ({ ...prev, scope, starting: true, error: '' }))
      try {
        const result = await thoughtsApi.generateImage(input, operation.current.id)
        if (scopeRef.current !== scope) return
        const snapshot = await thoughtsApi.imageTask(chapterId, result.taskId)
        if (scopeRef.current !== scope) return
        if (snapshot.task?.thought) publishedRef.current(snapshot.task.thought)
        setState((prev) => ({ ...prev, task: snapshot.task, starting: false }))
        operation.current = null
      } catch (err) {
        if (scopeRef.current === scope) setState((prev) => ({ ...prev, starting: false }))
        throw err
      }
    },
    [scope, chapterId],
  )

  return {
    allowed: current.allowed,
    task,
    error: current.error,
    generating: current.starting || Boolean(task && ['queued', 'running'].includes(task.status)),
    generate,
  }
}
