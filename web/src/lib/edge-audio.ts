/**
 * 节拍指令的合成音：绿色／黄色的节拍打在音频时钟上，红色给低心跳。
 *
 * 与 `tempo-audio.ts` 的普通计时器分开，是因为这里要两种音色和一条独立的
 * 心跳轨道：节拍不能因为界面重渲染而抖动，心跳也不能被节拍调度覆盖。
 * 所有节点都在 stop() 里断开，页面隐藏或换相位时不会留下还在响的振荡器。
 */
type Timbral = 'go' | 'slow'

export class EdgeAudio {
  private context: AudioContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private nodes = new Map<OscillatorNode, GainNode>()
  private generation = 0
  private timbre: Timbral = 'go'
  private heartbeat: ReturnType<typeof setInterval> | null = null

  async start(bpm: number, timbre: Timbral): Promise<boolean> {
    this.stop()
    const generation = this.generation
    this.timbre = timbre
    try {
      if (!this.context) this.context = new AudioContext()
      const context = this.context
      await context.resume()
      if (generation !== this.generation) return true
      if (context.state !== 'running') return false
      const frequency = timbre === 'go' ? 660 : 440
      const peak = timbre === 'go' ? 0.1 : 0.06
      const interval = 60 / Math.max(1, bpm)
      let nextBeat = context.currentTime + 0.04
      const schedule = () => {
        if (context.state !== 'running') return
        if (nextBeat < context.currentTime) nextBeat = context.currentTime + 0.01
        while (nextBeat < context.currentTime + 0.1) {
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          oscillator.frequency.value = frequency
          gain.gain.setValueAtTime(0, nextBeat)
          gain.gain.linearRampToValueAtTime(peak, nextBeat + 0.004)
          gain.gain.exponentialRampToValueAtTime(0.001, nextBeat + 0.05)
          oscillator.connect(gain)
          gain.connect(context.destination)
          this.nodes.set(oscillator, gain)
          oscillator.onended = () => {
            oscillator.disconnect()
            gain.disconnect()
            this.nodes.delete(oscillator)
          }
          oscillator.start(nextBeat)
          oscillator.stop(nextBeat + 0.06)
          nextBeat += interval
        }
      }
      schedule()
      this.timer = setInterval(schedule, 25)
      return true
    } catch {
      if (generation !== this.generation) return true
      this.stop()
      return false
    }
  }

  /** 红色相位里的低心跳；首拍立刻响，之后每秒两下。 */
  async startHeartbeat(): Promise<boolean> {
    this.stopHeartbeat()
    try {
      if (!this.context) this.context = new AudioContext()
      const context = this.context
      await context.resume()
      if (context.state !== 'running') return false
      const beat = (delay: number) => {
        if (context.state !== 'running') return
        const time = context.currentTime + delay
        const oscillator = context.createOscillator()
        const gain = context.createGain()
        oscillator.type = 'sine'
        oscillator.frequency.setValueAtTime(62, time)
        oscillator.frequency.exponentialRampToValueAtTime(38, time + 0.16)
        gain.gain.setValueAtTime(0, time)
        gain.gain.linearRampToValueAtTime(0.16, time + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28)
        oscillator.connect(gain)
        gain.connect(context.destination)
        this.nodes.set(oscillator, gain)
        oscillator.onended = () => {
          oscillator.disconnect()
          gain.disconnect()
          this.nodes.delete(oscillator)
        }
        oscillator.start(time)
        oscillator.stop(time + 0.3)
      }
      const pump = () => { beat(0); beat(0.22) }
      pump()
      this.heartbeat = setInterval(pump, 1000)
      return true
    } catch {
      this.stopHeartbeat()
      return false
    }
  }

  stopHeartbeat(): void {
    if (this.heartbeat !== null) clearInterval(this.heartbeat)
    this.heartbeat = null
  }

  stop(): void {
    this.generation++
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    this.stopHeartbeat()
    for (const [oscillator, gain] of this.nodes) {
      oscillator.onended = null
      try { oscillator.stop() } catch { /* 已经结束的节点是正常情况。 */ }
      oscillator.disconnect()
      gain.disconnect()
    }
    this.nodes.clear()
  }

  dispose(): void {
    this.stop()
    if (this.context) void this.context.close().catch(() => undefined)
    this.context = null
  }

  get timbreName(): Timbral { return this.timbre }
}
