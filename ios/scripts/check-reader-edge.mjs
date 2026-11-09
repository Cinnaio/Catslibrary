import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

// Small cross-runtime contract check; no browser, dev server or native build required.
const resource = await readFile(new URL('../ZhiZhou/Resources/ReaderEdgeRuntime.js', import.meta.url), 'utf8')
const source = await readFile(new URL('../../web/src/lib/edge.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS,
} }).outputText
const original = { exports: {} }
vm.runInNewContext(compiled, original)
const web = original.exports
const makeBridge = () => {
  const scope = {}
  vm.runInNewContext(resource, scope)
  return scope.ReaderEdgeBridge
}
const bridge = makeBridge()
const call = (method, value) => JSON.parse(bridge[method](value))
const dispatch = (action) => call('dispatch', JSON.stringify(action))
const plain = (value) => JSON.parse(JSON.stringify(value))
const projected = (value) => value && plain({ ...value, feedback: web.edgeSessionFeedback(value) })
const catalog = call('catalog')
assert.deepEqual(catalog.defaults, plain(web.DEFAULT_EDGE_SETTINGS))
assert.equal(catalog.historyLimit, 30)
assert.equal(catalog.defaults.sound, false)
assert.equal(catalog.defaults.speech, false)
assert.deepEqual(catalog.acts, plain(web.EDGE_ACT_LABELS))
assert.equal(catalog.rules.length, 3)
assert.equal(catalog.declarations.length, 2)
assert.equal(catalog.spends.length, 3)
assert.equal(catalog.overtimeMinSeconds, 45)
assert.equal(catalog.overtimeMaxSeconds, 300)
assert.deepEqual(call('loadData', '').data, { settings: catalog.defaults, history: [] })
assert.ok(call('loadData', '{broken').error)
const invalid = { minutes: 999, holdMin: 80, holdMax: 3, customChance: -10 }
assert.deepEqual(call('normalizeSettings', JSON.stringify(invalid)), plain(web.normalizeEdgeSettings(invalid)))

// Identical seed/actions must produce the same state, including all five endings.
for (const finale of Object.keys(web.EDGE_FINALES)) {
  dispatch({ type: 'discard' })
  let expected = null
  const step = (action) => {
    expected = web.edgeReducer(expected, action)
    const actual = dispatch(action)
    assert.deepEqual(actual, projected(expected), `${finale}: ${action.type}`)
    return actual
  }
  const settings = { ...catalog.defaults, minutes: 1, finale, permitSeconds: 5, customChance: 0 }
  step({ type: 'start', id: finale, settings, now: 0, seed: 42 })
  step({ type: 'edge', now: 100 })
  assert.equal(expected.status, 'cooldown')
  step({ type: 'pause', now: 200, reason: 'manual' })
  step({ type: 'resume', now: 10_000 })
  assert.equal(expected.status, 'cooldown')
  let now = 10_000
  let pausedPermit = false
  for (let tick = 0; tick < 500 && expected.status !== 'finished'; tick++) {
    now += 1000
    step({ type: 'tick', now })
    if (expected.status === 'permit' && !pausedPermit) {
      step({ type: 'pause', now, reason: 'background' })
      now += 20_000
      step({ type: 'resume', now })
      assert.equal(expected.status, 'permit')
      pausedPermit = true
    }
  }
  assert.equal(expected.status, 'finished')
}

dispatch({ type: 'start', id: 'interruption', settings: catalog.defaults, now: 0, seed: 1 })
const interrupted = dispatch({ type: 'tick', now: 3000 })
assert.equal(interrupted.status, 'paused')
assert.equal(interrupted.pauseReason, 'interrupted')
assert.equal(interrupted.elapsedMs, 0)
assert.equal(dispatch({ type: 'discard' }), null)
const other = makeBridge()
assert.equal(JSON.parse(other.dispatch(JSON.stringify({ type: 'tick', now: 100 }))), null)

// Native feedback and all three bank actions use the shared reducer's current state.
for (const kind of ['pardon', 'time', 'permit']) {
  dispatch({ type: 'discard' })
  let expected = null
  const step = (action) => {
    expected = web.edgeReducer(expected, action)
    const actual = dispatch(action)
    assert.deepEqual(actual, projected(expected), `bank ${kind}: ${action.type}`)
    return actual
  }
  step({ type: 'start', id: `bank-${kind}`, settings: { ...catalog.defaults, minutes: 30 }, now: 0, seed: 42 })
  step({ type: 'edge', now: 100, declare: 'grind' })
  let now = 100
  for (let tick = 0; tick < 1500 && web.edgeSpendOptions(expected).find((option) => option.kind === kind).note; tick++) {
    now += 1000
    step({ type: 'tick', now })
  }
  const before = expected
  const actual = step({ type: 'spend', kind, now })
  assert.equal(actual.grinds, 1)
  assert.equal(actual.spent, web.EDGE_BANK_COST[kind])
  assert.equal(actual.bank, before.bank - web.EDGE_BANK_COST[kind])
  if (kind === 'pardon') assert.notEqual(actual.phase, 'stop')
  if (kind === 'time') assert.equal(actual.totalMs, before.totalMs - web.EDGE_BANK_TIME_MS)
  if (kind === 'permit') assert.equal(actual.status, 'permit')
}
dispatch({ type: 'discard' })
const disabled = call('normalizeSettings', JSON.stringify({ ...catalog.defaults, acts: false, bank: false, timing: false, overtimeSeconds: 15 }))
assert.deepEqual([disabled.acts, disabled.bank, disabled.timing, disabled.overtimeSeconds], [false, false, false, 45])
const oldMode = dispatch({ type: 'start', id: 'old-mode', settings: disabled, now: 0, seed: 42 })
assert.equal(oldMode.feedback.timingHint, null)
assert.equal(oldMode.act, 'grind')
assert.equal(dispatch({ type: 'edge', now: 100 }).chance, oldMode.chance + 5)

const history = Array.from({ length: 40 }, (_, index) => ({
  id: String(index), finishedAt: 1000 + index, minutes: 5, difficulty: 'easy', finale: 'always',
  elapsedMs: 2000, edges: 0, overtime: 0, ending: 'ended',
}))
const loaded = call('loadData', JSON.stringify({ settings: catalog.defaults, history: [...history, history[39], { id: 'invalid' }] }))
assert.equal(loaded.error, null)
assert.equal(loaded.data.history.length, 30)
assert.equal(loaded.data.history[0].id, '39')
assert.equal(loaded.data.history[29].id, '10')
assert.equal(loaded.data.history[0].grinds, 0)
assert.equal(loaded.data.history[0].spent, 0)
const totals = call('summarizeHistory', JSON.stringify([{ ...history[0], edges: 2, grinds: 1, spent: 5 }]))
assert.deepEqual(totals, { sessions: 1, edges: 2, grinds: 1, spent: 5, permitted: 0, longestMs: 2000 })
console.log('iOS 节拍桥接检查通过：共享反馈、三种兑现、开关兼容、历史汇总、五种结局及生命周期。')
