import { useCallback, useEffect, useRef, useState } from 'react'
import { EdgeAudio } from '../lib/edge-audio'
import type { EdgeSession, EdgeSettings } from '../lib/edge'

const PHASE_ANNOUNCE: Record<'go' | 'slow' | 'stop', string> = {
  go: '可以动了。',
  slow: '慢一点。',
  stop: '松手。',
}

/**
 * 节拍声跟着相位走：绿色是清脆的一拍，黄色更闷，红色停掉节拍（可选低心跳）。
 * 语音只播报相位变化、申报结果和结局，不逐条念完整指令——页面上的文字才是指令本身，
 * 逐句朗读会在同一条指令停留十几秒时重复到发麻。
 */
export function useEdgeAudio(session: EdgeSession | null, settings: EdgeSettings) {
  const [audio] = useState(() => new EdgeAudio())
  const [error, setError] = useState<string | null>(null)
  const speaking = useRef<SpeechSynthesisUtterance | null>(null)
  const spokenPhase = useRef<string>('')
  const spokenStatus = useRef<string>('')
  const soundSupported = typeof AudioContext !== 'undefined'
  const speechSupported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'

  const status = session?.status
  const phase = session?.phase
  const bpm = session?.bpm ?? 0
  const edges = session?.edges ?? 0
  const ending = session?.ending ?? null

  const stopSpeech = useCallback(() => {
    if (!speaking.current || !speechSupported) return
    speaking.current = null
    speechSynthesis.cancel()
  }, [speechSupported])

  const speak = useCallback((message: string) => {
    if (!speechSupported) return
    stopSpeech()
    const utterance = new SpeechSynthesisUtterance(message)
    utterance.lang = 'zh-CN'
    const local = speechSynthesis.getVoices().find((voice) => voice.localService && /^zh\b/i.test(voice.lang))
    if (local) utterance.voice = local
    utterance.rate = 1
    utterance.volume = 0.7
    speaking.current = utterance
    utterance.onend = () => { if (speaking.current === utterance) speaking.current = null }
    utterance.onerror = (event) => {
      if (speaking.current !== utterance) return
      speaking.current = null
      if (event.error === 'interrupted' || event.error === 'canceled') return
      setError('语音提示暂时不可用，可以继续看屏幕上的指令。')
    }
    try {
      speechSynthesis.speak(utterance)
    } catch {
      speaking.current = null
      setError('语音提示暂时不可用，可以继续看屏幕上的指令。')
    }
  }, [speechSupported, stopSpeech])

  // 节拍与心跳只由相位和音量设置驱动，不跟随每次 tick 重排。
  useEffect(() => {
    if (!settings.sound || !soundSupported || !status || status === 'finished' || status === 'paused') {
      audio.stop()
      return
    }
    if (status === 'running' && phase !== 'stop' && bpm > 0) {
      audio.stopHeartbeat()
      void audio.start(bpm, phase === 'go' ? 'go' : 'slow').then((ok) => {
        if (!ok) setError('节拍声暂时不可用，指令仍会继续。可以关掉节拍声后再打开。')
      })
      return
    }
    audio.stop()
    if (settings.heartbeat && phase === 'stop') void audio.startHeartbeat()
  }, [audio, bpm, phase, settings.heartbeat, settings.sound, soundSupported, status])

  useEffect(() => {
    if (!settings.speech || !speechSupported || !status || status === 'paused' || document.hidden) {
      stopSpeech()
      spokenPhase.current = ''
      spokenStatus.current = ''
      return
    }
    const key = `${status}:${phase}:${edges}:${ending ?? ''}`
    if (spokenStatus.current === key) return
    spokenStatus.current = key
    if (status === 'finished') {
      spokenPhase.current = ''
      speak(ending === 'permitted' ? '结束了。你拿到了许可。' : ending === 'ruined' ? '结束了。射出的瞬间松手。' : ending === 'denied' ? '结束了。今天到此为止。' : '本次结束。')
      return
    }
    if (status === 'permit') { speak('可以了。现在。'); return }
    if (status === 'cooldown') { speak(`忍住了，第 ${edges} 次。松手，等它平息。`); return }
    const phaseKey = `${status}:${phase}`
    if (spokenPhase.current === phaseKey) return
    spokenPhase.current = phaseKey
    speak(PHASE_ANNOUNCE[phase as 'go' | 'slow' | 'stop'] ?? '继续。')
  }, [edges, ending, phase, settings.speech, speak, speechSupported, status, stopSpeech])

  // 离开页面或切后台立刻消音；回来由用户重新开始这一次会话的节奏。
  useEffect(() => {
    const stop = () => { audio.stop(); stopSpeech() }
    const visibility = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', stop)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', stop)
      stopSpeech()
      audio.dispose()
    }
  }, [audio, stopSpeech])

  return { error, soundSupported, speechSupported, speak }
}
