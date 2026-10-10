import { expect, it } from 'vitest'
import { ReadingClock } from './reading-clock'
it('counts static foreground reading and stops after hiding or focus loss', () => {
  const clock = new ReadingClock(10000, 0)
  expect(clock.sample(10000, 0, true)).toBeNull()
  expect(clock.sample(11000, 1000, true)).toEqual({ start: 10000, end: 11000 })
  expect(clock.sample(11500, 1500, false)).toEqual({ start: 11000, end: 11500 })
  expect(clock.sample(12500, 2500, false)).toBeNull()
  expect(clock.sample(13500, 3500, true)).toBeNull()
  expect(clock.sample(14500, 4500, true)).toEqual({ start: 13500, end: 14500 })
})
it('does not count sleep, delayed timers or wall-clock jumps', () => {
  const clock = new ReadingClock(10000, 0)
  clock.sample(10000, 0, true)
  expect(clock.sample(70000, 60000, true)).toBeNull()
  expect(clock.sample(71000, 61000, true)).toEqual({ start: 70000, end: 71000 })
  expect(clock.sample(99000, 62000, true)).toBeNull()
})
it('pauses after five idle minutes, then resumes on reading activity', () => {
  const clock = new ReadingClock(10000, 0)
  clock.sample(10000, 0, true)
  for (let t = 1000; t <= 300000; t += 1000) clock.sample(10000 + t, t, true)
  expect(clock.sample(311000, 301000, true)).toBeNull()
  clock.activity(302000)
  expect(clock.sample(312000, 302000, true)).toBeNull()
  expect(clock.sample(313000, 303000, true)).toEqual({ start: 312000, end: 313000 })
})
