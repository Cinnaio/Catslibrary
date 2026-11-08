import { useEffect, useRef, useState } from 'react'
import { formatTempoTime, type TempoSettings } from '@/lib/tempo'
import { useTempoAudio } from './useTempoAudio'
import { useTempoData } from './useTempoData'
import { useTempoSession } from './useTempoSession'

function validNumber(value: string, min: number, max: number): boolean {
  return value.trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= min && Number(value) <= max
}

/** Remount when the confirmed account changes; closing controls does not end a session. */
export function useTempoController(scope: string) {
  const { data, error: storageError, updateSettings, addRecord, clearHistory, retry } = useTempoData(scope)
  const { session, dispatch } = useTempoSession()
  const audio = useTempoAudio(session, data.settings)
  const [minutes, setMinutes] = useState(String(data.settings.minutes))
  const [bpm, setBpm] = useState(String(data.settings.bpm))
  const recorded = useRef<string | null>(null)
  const running = session?.status === 'running'
  const active = running || session?.status === 'paused'
  const minutesValid = validNumber(minutes, 1, 180)
  const bpmValid = validNumber(bpm, 30, 180)
  const duration = (session?.minutes ?? (minutesValid ? Number(minutes) : data.settings.minutes)) * 60_000
  const elapsed = session?.elapsedMs ?? 0
  const remaining = duration - elapsed
  const progress = Math.min(1, elapsed / duration)
  const currentBpm = session?.bpm ?? (bpmValid ? Number(bpm) : data.settings.bpm)
  const statusText = !session ? '准备开始' : running ? '跟着自己的节奏' : session.status === 'completed'
    ? '这一段时间，完成了' : session.status === 'ended' ? '本次已结束' : '计时已暂停'
  const hint = session?.pauseReason === 'background' ? '切到后台后已自动暂停，准备好再继续。'
    : session?.pauseReason === 'interrupted' ? '检测到设备休眠或运行中断，已暂停计时。'
      : session?.status === 'completed' ? '慢下来，给自己一点休息的时间。'
        : session?.status === 'ended' ? `本次进行了 ${formatTempoTime(elapsed)}，可以重新安排时间。`
          : '轻敲手指、练习节奏，或专注完成一件小事。'

  useEffect(() => {
    if (!session || (session.status !== 'completed' && session.status !== 'ended') || recorded.current === session.id) return
    recorded.current = session.id
    addRecord({ id: session.id, finishedAt: Date.now(), minutes: session.minutes, bpm: session.bpm, elapsedMs: Math.round(session.elapsedMs), completed: session.status === 'completed' })
  }, [session, addRecord])

  function saveNumbers(nextMinutes = minutes, nextBpm = bpm) {
    if (!validNumber(nextMinutes, 1, 180) || !validNumber(nextBpm, 30, 180)) return
    updateSettings({ ...data.settings, minutes: Number(nextMinutes), bpm: Number(nextBpm) })
  }

  function changeMinutes(value: string) {
    setMinutes(value)
    dispatch({ type: 'reset' })
  }

  function changeBpm(value: string) {
    setBpm(value)
    dispatch({ type: 'reset' })
  }

  function start() {
    if (active || !minutesValid || !bpmValid) return
    saveNumbers()
    audio.activate(Number(bpm), data.settings.sound)
    dispatch({ type: 'start', id: crypto.randomUUID(), settings: { ...data.settings, minutes: Number(minutes), bpm: Number(bpm) }, now: performance.now() })
  }

  function resume() {
    if (session?.status !== 'paused') return
    audio.activate(session.bpm, data.settings.sound)
    dispatch({ type: 'resume', now: performance.now() })
  }

  function toggleSetting(name: 'sound' | 'speech', checked: boolean) {
    const settings: TempoSettings = { ...data.settings, [name]: checked }
    updateSettings(settings)
    if (name === 'sound') audio.activate(session?.bpm ?? settings.bpm, checked && running)
  }

  return {
    data, storageError, clearHistory, retry, session, dispatch, audio,
    minutes, bpm, running, active, minutesValid, bpmValid, elapsed, remaining, progress,
    currentBpm, statusText, hint, saveNumbers, changeMinutes, changeBpm, start, resume, toggleSetting,
  }
}

export type TempoController = ReturnType<typeof useTempoController>
