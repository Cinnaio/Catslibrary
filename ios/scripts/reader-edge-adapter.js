// Inserted inside the generated engine closure. All text and rules come from edge.ts.
// This in-memory adapter lets the existing data validator run without browser APIs.
let storedJSON = null
const localStorage = { getItem: () => storedJSON }
let session = null
const options = (values) => Object.entries(values).map(([id, value]) => ({ id, ...value }))

const nativeBridge = Object.freeze({
  catalog() {
    return JSON.stringify({
      defaults: exports.DEFAULT_EDGE_SETTINGS,
      difficulties: options(exports.EDGE_DIFFICULTIES),
      finales: options(exports.EDGE_FINALES),
      tones: options(exports.EDGE_TONES),
      categories: Object.entries(exports.EDGE_CATEGORY_LABELS).map(([id, label]) => ({ id, label })),
      acts: exports.EDGE_ACT_LABELS,
      rules: options(exports.EDGE_RULE_LABELS),
      declarations: options(exports.EDGE_DECLARE_LABELS),
      spends: options(exports.EDGE_SPEND_LABELS),
      overtimeMinSeconds: exports.EDGE_OVERTIME_MIN_SECONDS,
      overtimeMaxSeconds: exports.EDGE_OVERTIME_MAX_SECONDS,
      endings: exports.EDGE_ENDING_LABELS,
      historyLimit: exports.EDGE_HISTORY_LIMIT,
    })
  },
  loadData(raw) {
    storedJSON = raw || null
    try {
      return JSON.stringify(exports.readEdgeData('native'))
    } finally {
      storedJSON = null
    }
  },
  normalizeSettings(raw) {
    return JSON.stringify(exports.normalizeEdgeSettings(JSON.parse(raw)))
  },
  summarizeHistory(raw) {
    return JSON.stringify(exports.summarizeEdgeHistory(JSON.parse(raw)))
  },
  dispatch(raw) {
    session = exports.edgeReducer(session, JSON.parse(raw))
    return JSON.stringify(session && { ...session, feedback: exports.edgeSessionFeedback(session) })
  },
})
