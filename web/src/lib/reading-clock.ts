import { READING_IDLE_MS } from '@shared/reading-stats'
/** Testable activity clock; monotonic time protects against sleep and clock adjustments. */
export class ReadingClock {
  private wall: number
  private monotonic: number
  private active = false
  private lastActivity: number
  constructor(wall: number, monotonic: number) {
    this.wall = wall
    this.monotonic = monotonic
    this.lastActivity = monotonic
  }
  activity(monotonic: number) {
    this.lastActivity = monotonic
  }
  sample(wall: number, monotonic: number, visible: boolean): { start: number; end: number } | null {
    const delta = monotonic - this.monotonic
    const allowed = visible && monotonic - this.lastActivity < READING_IDLE_MS
    const result =
      this.active && delta > 0 && delta <= 5000 && Math.abs(wall - this.wall - delta) < 1000
        ? { start: this.wall, end: Math.min(wall, this.wall + Math.max(0, this.lastActivity + READING_IDLE_MS - this.monotonic)) }
        : null
    this.wall = wall
    this.monotonic = monotonic
    this.active = allowed
    return result && result.end > result.start ? result : null
  }
}
