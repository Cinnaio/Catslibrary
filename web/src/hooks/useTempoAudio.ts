import { useCallback, useEffect, useRef, useState } from 'react'
import { TempoMetronome } from '../lib/tempo-audio'
import type { TempoSession, TempoSettings } from '../lib/tempo'

export function useTempoAudio(session: TempoSession | null, settings: TempoSettings) {
  const [metronome] = useState(() => new TempoMetronome())
  const [error, setError] = useState<string | null>(null)
  const speaking = useRef<SpeechSynthesisUtterance | null>(null)
  const running = session?.status === 'running'
  const soundSupported = typeof AudioContext !== 'undefined'
  const speechSupported = typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined'

  const stopSpeech = useCallback(() => {
    if (!speaking.current || !speechSupported) return
    speaking.current = null
    speechSynthesis.cancel()
  }, [speechSupported])

  const startSound = useCallback((speed: number) => {
    setError(null)
    void metronome.start(speed).then(ok => {
      if (!ok) setError('节拍声暂时不可用，计时仍会继续。可关闭后重新开启节拍声。')
    })
  }, [metronome])

  // Called directly by click handlers, so audio activation retains the user gesture.
  const activate = useCallback((speed: number, enabled: boolean) => {
    if (enabled && soundSupported) startSound(speed)
    else metronome.stop()
  }, [metronome, soundSupported, startSound])

  useEffect(() => {
    if (!running || !settings.sound) metronome.stop()
  }, [running, settings.sound, metronome])

  const minute = Math.floor((session?.elapsedMs ?? 0) / 60_000)
  const status = session?.status
  useEffect(() => {
    stopSpeech()
    if (!settings.speech || !speechSupported || !status || document.hidden) return
    const message = status === 'running'
      ? minute > 0 ? `已进行 ${minute} 分钟，保持自己的节奏。` : '计时进行中，跟着节拍，轻松开始。'
      : status === 'paused' ? '计时已暂停。' : status === 'completed' ? '本次计时完成，休息一下吧。' : '本次计时已结束。'
    const utterance = new SpeechSynthesisUtterance(message)
    utterance.lang = 'zh-CN'
    const localVoice = speechSynthesis.getVoices().find(voice => voice.localService && /^zh\b/i.test(voice.lang))
    if (localVoice) utterance.voice = localVoice
    utterance.rate = 1
    utterance.volume = 0.7
    speaking.current = utterance
    utterance.onend = () => { if (speaking.current === utterance) speaking.current = null }
    utterance.onerror = event => {
      if (speaking.current !== utterance) return
      speaking.current = null
      if (event.error === 'interrupted' || event.error === 'canceled') return
      setError('语音提示暂时不可用，可以继续使用屏幕计时。')
    }
    try {
      speechSynthesis.speak(utterance)
    } catch {
      speaking.current = null
      setError('语音提示暂时不可用，可以继续使用屏幕计时。')
    }
    return stopSpeech
  }, [status, minute, settings.speech, speechSupported, stopSpeech])

  useEffect(() => {
    const stop = () => { metronome.stop(); stopSpeech() }
    const visibility = () => { if (document.hidden) stop() }
    document.addEventListener('visibilitychange', visibility)
    window.addEventListener('pagehide', stop)
    return () => {
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', stop)
      stopSpeech()
      metronome.dispose()
    }
  }, [metronome, stopSpeech])

  return { activate, error, soundSupported, speechSupported }
}
