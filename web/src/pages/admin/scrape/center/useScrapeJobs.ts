// ============================================================
// 抓取任务状态机 — 任务卡 CRUD / 挂载恢复 / 2s 轮询 / 终止与重试
// consumers: scrape/CenterView.tsx
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { scrapeApi } from '@/lib/api'
import { isJobRunning, isJobTerminal } from '@/lib/admin'
import { useConfirm, useToast } from '@/components/feedback'
import type { JobCard, JobStatusData } from '../types'
import { scrapePost } from '../utils'

const POLL_INTERVAL = 2000

export function useScrapeJobs() {
  const { toast } = useToast()
  const { confirm } = useConfirm()

  const [jobs, setJobs] = useState<JobCard[]>([])
  const activePolls = useRef(new Set<string>())
  const pollVersions = useRef(new Map<string, number>())
  const appliedPollVersions = useRef(new Map<string, number>())
  const retryPending = useRef(new Set<string>())
  // 重试时要读取被重试任务的标题；用 ref 避免把 jobs 挂进每个 handler 的闭包。
  const jobsRef = useRef<JobCard[]>([])
  jobsRef.current = jobs

  const track = useCallback((jobId: string, novelTitle: string) => {
    setJobs((prev) => {
      if (prev.some((c) => c.jobId === jobId)) return prev
      return [
        {
          jobId,
          novelTitle,
          status: 'starting',
          step: '任务已启动（服务器模式）',
          current: 0,
          total: 0,
          progress: 0,
          successCount: 0,
          failedCount: 0,
          skippedCount: 0,
          publicChapterCount: 0,
          protectedChapterCount: 0,
          speed: 0,
          etaSeconds: 0,
          failedItems: [],
          recentLogs: [],
          logOpen: false,
        },
        ...prev,
      ]
    })
    activePolls.current.add(jobId)
  }, [])

  const applyStatus = useCallback((jobId: string, data: JobStatusData) => {
    setJobs((prev) =>
      prev.map((c) => {
        if (c.jobId !== jobId) return c
        if (isJobTerminal(c.status) && data.status && c.status !== data.status) return c
        const summary = data.summary || {}
        return {
          ...c,
          status: data.status || c.status,
          step: data.step ?? c.step,
          current: data.current ?? c.current,
          total: data.total ?? c.total,
          progress: data.progress ?? c.progress,
          successCount: data.successCount ?? summary.successCount ?? c.successCount,
          failedCount: data.failedCount ?? summary.failedCount ?? c.failedCount,
          skippedCount: data.skippedCount ?? summary.skippedCount ?? c.skippedCount,
          publicChapterCount: data.publicChapterCount ?? summary.publicChapterCount ?? c.publicChapterCount,
          protectedChapterCount: data.protectedChapterCount ?? summary.protectedChapterCount ?? c.protectedChapterCount,
          speed: data.speed ?? summary.speed ?? c.speed,
          etaSeconds: data.etaSeconds ?? summary.etaSeconds ?? c.etaSeconds,
          failedItems: Array.isArray(data.failedItems) ? data.failedItems : c.failedItems,
          recentLogs: Array.isArray(data.recentLogs)
            ? data.recentLogs.map((l) => ({ level: l.level || 'info', message: l.message || '', detail: l.detail, createdAt: l.createdAt }))
            : c.recentLogs,
        }
      }),
    )
  }, [])

  const dismiss = useCallback((jobId: string) => {
    const version = (pollVersions.current.get(jobId) || 0) + 1
    pollVersions.current.set(jobId, version)
    appliedPollVersions.current.set(jobId, version)
    activePolls.current.delete(jobId)
    setJobs((prev) => prev.filter((c) => c.jobId !== jobId))
  }, [])

  const toggleLog = useCallback((jobId: string) => {
    setJobs((prev) => prev.map((c) => (c.jobId === jobId ? { ...c, logOpen: !c.logOpen } : c)))
  }, [])

  // 挂载时恢复仍在运行的任务
  useEffect(() => {
    let cancelled = false
    scrapeApi
      .jobs()
      .then((data) => {
        if (cancelled) return
        const running = (data as { jobs?: JobStatusData[] }).jobs || []
        running.forEach((j) => {
          if (!isJobRunning(j.status || '')) return
          const jobId = j.id || ''
          if (!jobId) return
          const novelTitle = j.novelTitle || j.novelId || ''
          track(jobId, novelTitle ? novelTitle.slice(0, 12) : jobId.slice(0, 12))
          applyStatus(jobId, j)
        })
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [track, applyStatus])

  // 轮询运行中的任务，进入终端状态即摘除；
  // 页面隐藏时暂停（不浪费请求），恢复可见立即刷新一次（与 JobsTab 的策略一致）
  useEffect(() => {
    let alive = true
    const poll = () => {
      if (document.hidden) return
      Array.from(activePolls.current).forEach((jobId) => {
        const version = (pollVersions.current.get(jobId) || 0) + 1
        pollVersions.current.set(jobId, version)
        scrapeApi
          .status(jobId)
          .then((data) => {
            if (!alive || version <= (appliedPollVersions.current.get(jobId) || 0) || !activePolls.current.has(jobId)) return
            appliedPollVersions.current.set(jobId, version)
            applyStatus(jobId, data as JobStatusData)
            if (isJobTerminal(String((data as JobStatusData).status || ''))) activePolls.current.delete(jobId)
          })
          .catch(() => {
            /* 下个周期重试 */
          })
      })
    }
    const timer = setInterval(poll, POLL_INTERVAL)
    const onVisibilityChange = () => {
      if (!document.hidden) poll()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      alive = false
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [applyStatus])

  const cancel = useCallback(
    async (jobId: string) => {
      const ok = await confirm({
        title: '终止任务',
        message: '确定终止该任务？正在运行的抓取流程会被中断。',
        okText: '终止',
        danger: true,
        items: [jobId],
      })
      if (!ok) return
      try {
        await scrapeApi.cancel(jobId)
        toast('已提交终止请求', 'default')
      } catch (err) {
        toast('终止失败: ' + (err as Error).message, 'error')
      }
    },
    [confirm, toast],
  )

  const retry = useCallback(
    async (jobId: string) => {
      if (retryPending.current.has(jobId)) return
      retryPending.current.add(jobId)
      toast('正在重试任务…', 'default')
      try {
        const data = await scrapePost({ action: 'retry', jobId })
        if (!data.jobId) throw new Error(data.error || '重试失败')
        toast('重试任务已启动', 'success')
        const old = jobsRef.current.find((c) => c.jobId === jobId)
        track(data.jobId, (old?.novelTitle || jobId.slice(0, 12)) + ' (重试)')
      } catch (err) {
        toast('重试失败: ' + (err as Error).message, 'error')
      } finally {
        retryPending.current.delete(jobId)
      }
    },
    [toast, track],
  )

  const retryFailed = useCallback(
    async (jobId: string) => {
      if (retryPending.current.has(jobId)) return
      retryPending.current.add(jobId)
      toast('正在重试失败章节…', 'default')
      try {
        const data = (await scrapeApi.retryFailed(jobId)) as { jobId?: string; error?: string }
        if (!data.jobId) throw new Error(data.error || '重试失败章节失败')
        toast('失败章节重试已启动', 'success')
        const old = jobsRef.current.find((c) => c.jobId === jobId)
        track(data.jobId, (old?.novelTitle || jobId.slice(0, 12)) + ' (失败章节重试)')
      } catch (err) {
        toast('重试失败章节失败: ' + (err as Error).message, 'error')
      } finally {
        retryPending.current.delete(jobId)
      }
    },
    [toast, track],
  )

  return { jobs, track, dismiss, toggleLog, cancel, retry, retryFailed }
}
