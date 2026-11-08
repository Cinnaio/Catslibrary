/** Short synthesized clicks, scheduled against the audio clock rather than UI renders. */
export class TempoMetronome {
  private context: AudioContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private nodes = new Map<OscillatorNode, GainNode>()
  private generation = 0

  async start(bpm: number): Promise<boolean> {
    this.stop()
    const generation = this.generation
    try {
      if (!this.context) this.context = new AudioContext()
      const context = this.context
      await context.resume()
      if (generation !== this.generation) return true
      if (context.state !== 'running') return false
      const interval = 60 / bpm
      let nextBeat = context.currentTime + 0.04
      const schedule = () => {
        if (context.state !== 'running') return
        if (nextBeat < context.currentTime) nextBeat = context.currentTime + 0.01
        while (nextBeat < context.currentTime + 0.1) {
          const oscillator = context.createOscillator()
          const gain = context.createGain()
          oscillator.frequency.value = 660
          gain.gain.setValueAtTime(0, nextBeat)
          gain.gain.linearRampToValueAtTime(0.12, nextBeat + 0.004)
          gain.gain.exponentialRampToValueAtTime(0.001, nextBeat + 0.045)
          oscillator.connect(gain)
          gain.connect(context.destination)
          this.nodes.set(oscillator, gain)
          oscillator.onended = () => {
            oscillator.disconnect()
            gain.disconnect()
            this.nodes.delete(oscillator)
          }
          oscillator.start(nextBeat)
          oscillator.stop(nextBeat + 0.05)
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

  stop(): void {
    this.generation++
    if (this.timer !== null) clearInterval(this.timer)
    this.timer = null
    for (const [oscillator, gain] of this.nodes) {
      oscillator.onended = null
      try { oscillator.stop() } catch { /* An already-ended node is harmless. */ }
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
}
