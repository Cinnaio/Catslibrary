import { useEffect, useRef, useState } from 'react'
import {
  edgeBaseChance, edgeInSprint, edgeSpendOptions, edgeTimingAt, formatEdgeTime,
  type EdgeDeclare, type EdgeSettings, type EdgeSpendKind, type EdgeTiming,
} from '@/lib/edge'
import { useEdgeAudio } from './useEdgeAudio'
import { useEdgeData } from './useEdgeData'
import { useEdgeSession } from './useEdgeSession'

function integer(value: string, min: number, max: number): boolean {
  return value.trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max
}

/** 换账号时由调用方重挂载；settings 里的时间类字段要在开始前落盘。 */
export function useEdgeController(scope: string, enabled = true) {
  const { data, error: storageError, updateSettings, addRecord, clearHistory, retry } = useEdgeData(scope)
  const { session, dispatch } = useEdgeSession(enabled)
  const audio = useEdgeAudio(session, data.settings)
  const [minutes, setMinutes] = useState(String(data.settings.minutes))
  const [permitSeconds, setPermitSeconds] = useState(String(data.settings.permitSeconds))
  const [holdMin, setHoldMin] = useState(String(data.settings.holdMin))
  const [holdMax, setHoldMax] = useState(String(data.settings.holdMax))
  const [customChance, setCustomChance] = useState(data.settings.customChance === null ? '' : String(data.settings.customChance))
  const recorded = useRef<string | null>(null)

  const status = session?.status ?? null
  const active = !!status && status !== 'finished'
  const minutesValid = integer(minutes, 1, 180)
  const permitValid = integer(permitSeconds, 5, 60)
  const holdMinValid = integer(holdMin, 3, 120)
  const holdMaxValid = integer(holdMax, 3, 120) && Number(holdMax) >= Number(holdMin)
  const chanceValid = customChance.trim() === '' || integer(customChance, 0, 100)
  const duration = session?.totalMs ?? (minutesValid ? Number(minutes) * 60_000 : data.settings.minutes * 60_000)
  const elapsed = session?.elapsedMs ?? 0
  const remaining = Math.max(0, duration - elapsed)
  const progress = duration > 0 ? Math.min(1, elapsed / duration) : 0
  const phaseRemaining = session ? Math.max(0, session.phaseEndsAt - elapsed) : 0

  useEffect(() => {
    if (!session || session.status !== 'finished' || recorded.current === session.id) return
    recorded.current = session.id
    addRecord({
      id: session.id,
      finishedAt: Date.now(),
      minutes: session.settings.minutes,
      difficulty: session.settings.difficulty,
      finale: session.settings.finale,
      elapsedMs: Math.round(session.elapsedMs),
      edges: session.edges,
      grinds: session.grinds,
      spent: session.spent,
      overtime: session.overtime,
      ending: session.ending ?? 'ended',
    })
  }, [session, addRecord])

  function saveNumbers(next: Partial<Record<'minutes' | 'permitSeconds' | 'holdMin' | 'holdMax' | 'customChance', string>> = {}) {
    const nextMinutes = next.minutes ?? minutes
    const nextPermit = next.permitSeconds ?? permitSeconds
    const nextHoldMin = next.holdMin ?? holdMin
    const nextHoldMax = next.holdMax ?? holdMax
    const nextChance = next.customChance ?? customChance
    if (!integer(nextMinutes, 1, 180) || !integer(nextPermit, 5, 60)) return
    if (!integer(nextHoldMin, 3, 120) || !integer(nextHoldMax, 3, 120) || Number(nextHoldMax) < Number(nextHoldMin)) return
    if (nextChance.trim() !== '' && !integer(nextChance, 0, 100)) return
    updateSettings({
      ...data.settings,
      minutes: Number(nextMinutes),
      permitSeconds: Number(nextPermit),
      holdMin: Number(nextHoldMin),
      holdMax: Number(nextHoldMax),
      customChance: nextChance.trim() === '' ? null : Number(nextChance),
    })
  }

  function changeSetting<K extends keyof EdgeSettings>(key: K, value: EdgeSettings[K]) {
    updateSettings({ ...data.settings, [key]: value })
  }

  function changeCategory(key: keyof EdgeSettings['categories'], checked: boolean) {
    updateSettings({ ...data.settings, categories: { ...data.settings.categories, [key]: checked } })
  }

  function start() {
    if (!enabled || active || !minutesValid || !permitValid || !holdMinValid || !holdMaxValid || !chanceValid) return
    saveNumbers()
    dispatch({
      type: 'start',
      id: crypto.randomUUID(),
      settings: {
        ...data.settings,
        minutes: Number(minutes),
        permitSeconds: Number(permitSeconds),
        holdMin: Number(holdMin),
        holdMax: Number(holdMax),
        customChance: customChance.trim() === '' ? null : Number(customChance),
      },
      now: performance.now(),
    })
  }

  const phaseLabel = !session ? '准备开始'
    : session.status === 'permit' ? (session.ruined ? '松手射精' : '允许时间里')
      : session.status === 'cooldown' ? '等它平息'
        : session.status === 'paused' ? '已暂停'
          : session.status === 'finished' ? '本次结束'
            : session.phase === 'go' ? '可以动' : session.phase === 'slow' ? '慢一点' : '松手'

  const hint = !session ? `这一局 ${data.settings.minutes} 分钟，按难度发指令，时间到了才决定能不能去。`
    : session.pauseReason === 'background' ? '切到后台后已暂停，准备好再继续。'
      : session.pauseReason === 'interrupted' ? '检测到设备休眠或运行中断，已暂停。'
        : session.status === 'cooldown' ? `第 ${session.edges} 次申报记下了，许可率 ${session.chance}%。手放着，等它平息。`
          : session.status === 'permit' ? (session.ruined ? '可以，但射出的瞬间要松手，之后不许再碰。' : `许可 ${session.settings.permitSeconds} 秒，用完了就结束。`)
            : session.status === 'finished' ? '结束了。想再来一次就重新开始。'
              : session.phase === 'stop' ? '不许碰。手放到一边，等指令变回来。'
                : '跟着拍子走，一拍一下。快到了就申报。'

  const timing: EdgeTiming | null = session && session.status === 'running' && session.phase !== 'stop' ? edgeTimingAt(session) : null
  const spends = session ? edgeSpendOptions(session) : []
  const sprinting = !!session && session.settings.acts && session.status === 'running' && edgeInSprint(session.totalMs, session.elapsedMs)

  return {
    data, storageError, clearHistory, retry, session, dispatch, audio,
    minutes, setMinutes, permitSeconds, setPermitSeconds, holdMin, setHoldMin, holdMax, setHoldMax,
    customChance, setCustomChance,
    status, active, minutesValid, permitValid, holdMinValid, holdMaxValid, chanceValid,
    elapsed, remaining, progress, phaseRemaining, duration, phaseLabel, hint, timing, spends, sprinting,
    act: session?.act ?? 'warmup',
    bank: session?.bank ?? 0,
    chance: session?.chance ?? edgeBaseChance(data.settings),
    saveNumbers, changeSetting, changeCategory, start,
    resume: () => dispatch({ type: 'resume', now: performance.now() }),
    pause: () => dispatch({ type: 'pause', now: performance.now(), reason: 'manual' }),
    declareEdge: (declare: EdgeDeclare = 'hold') => dispatch({ type: 'edge', now: performance.now(), declare }),
    spend: (kind: EdgeSpendKind) => dispatch({ type: 'spend', kind, now: performance.now() }),
    reportCame: () => dispatch({ type: 'came', now: performance.now() }),
    quit: () => dispatch({ type: 'quit', now: performance.now() }),
    reset: () => dispatch({ type: 'reset' }),
    formatTime: formatEdgeTime,
  }
}

export type EdgeController = ReturnType<typeof useEdgeController>
