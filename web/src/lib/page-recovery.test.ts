import { beforeEach, expect, it, vi } from 'vitest'
import { isPageResourceError, recoverPageResource } from './page-recovery'

beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

it.each([
  'Failed to fetch dynamically imported module: /assets/Novel-old.js',
  'error loading dynamically imported module: /assets/Novel-old.js',
  'Importing a module script failed.',
  'Unable to preload CSS for /assets/Novel-old.css',
])('recognizes browser resource failure: %s', message => {
  expect(isPageResourceError(new TypeError(message))).toBe(true)
})

it('reloads once across repeated failures and permits recovery after the cooldown', () => {
  const reload = vi.fn()
  const error = new TypeError('Failed to fetch dynamically imported module: /assets/Novel.js')
  expect(recoverPageResource(error, reload, 1000000)).toBe(true)
  expect(recoverPageResource(error, reload, 1000001)).toBe(false)
  expect(recoverPageResource(error, reload, 1299999)).toBe(false)
  expect(reload).toHaveBeenCalledTimes(1)
  expect(recoverPageResource(error, reload, 1300000)).toBe(true)
})

it('does not reload rendering errors or non-error values', () => {
  const reload = vi.fn()
  for (const error of [new Error('Cannot read properties of undefined'), null, {}]) {
    expect(recoverPageResource(error, reload)).toBe(false)
  }
  expect(reload).not.toHaveBeenCalled()
})

it('keeps the fallback when recovery storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
  const reload = vi.fn()
  expect(recoverPageResource(new Error('Importing a module script failed.'), reload)).toBe(false)
  expect(reload).not.toHaveBeenCalled()
})
