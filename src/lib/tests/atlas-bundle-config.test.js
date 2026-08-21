const { test, beforeEach } = require('node:test')
const assert = require('node:assert')

// atlas-bundle.js registers chrome listeners at require time and exports
// onto `self`, so both must exist BEFORE require.
globalThis.self = globalThis
let store = {}
let onMessageListener = null
globalThis.chrome = {
  storage: {
    local: {
      // Dual-mode: atlas-bundle AWAITS get() promise-style in
      // readAtlasConfig, but calls set(updates, callback) callback-style
      // in the setAtlasConfig handler. Support both.
      get (keys, cb) {
        const out = {}
        keys.forEach((k) => { if (k in store) out[k] = store[k] })
        if (cb) { cb(out); return }
        return Promise.resolve(out)
      },
      set (obj, cb) {
        Object.assign(store, obj)
        if (cb) { cb(); return }
        return Promise.resolve()
      }
    }
  },
  runtime: {
    onInstalled: { addListener () {} },
    onStartup: { addListener () {} },
    onMessage: { addListener (fn) { onMessageListener = fn } },
    getManifest: () => ({ version: '1.6' })
  },
  alarms: { create () {}, onAlarm: { addListener () {} } },
  tabs: { query (_q, cb) { cb([]) } }
}

require('../atlas-bundle.js')
const B = globalThis.PromptShieldsAtlasBundle

beforeEach(() => { store = {} })

test('readAtlasConfig surfaces atlas.telemetryUrl', async () => {
  store['atlas.telemetryUrl'] = 'https://atlas.example/api/v1/telemetry/prompt-events'
  const cfg = await B.readAtlasConfig()
  assert.strictEqual(cfg.telemetryUrl, 'https://atlas.example/api/v1/telemetry/prompt-events')
})

test('readAtlasConfig defaults telemetryUrl to null (legacy deployments unaffected)', async () => {
  const cfg = await B.readAtlasConfig()
  assert.strictEqual(cfg.telemetryUrl, null)
})

test('publicConfig exposes telemetryUrl to content scripts (and keeps the legacy endpoint mapping)', async () => {
  store['atlas.violationsUrl'] = 'https://atlas.example/api/v1/policies/violations'
  store['atlas.telemetryUrl'] = 'https://atlas.example/api/v1/telemetry/prompt-events'
  const pub = B.publicConfig(await B.readAtlasConfig())
  assert.strictEqual(pub.telemetryUrl, 'https://atlas.example/api/v1/telemetry/prompt-events')
  // pin the existing quirk: content scripts get violationsUrl as `endpoint`
  assert.strictEqual(pub.endpoint, 'https://atlas.example/api/v1/policies/violations')
})

test('setAtlasConfig message persists telemetryUrl', async () => {
  let response = null
  const handled = onMessageListener(
    { type: 'setAtlasConfig', config: { telemetryUrl: 'https://atlas.example/api/v1/telemetry/prompt-events' } },
    null,
    (r) => { response = r }
  )
  assert.strictEqual(handled, true, 'listener answers asynchronously')
  await new Promise((resolve) => setTimeout(resolve, 20)) // let the async chain settle
  assert.strictEqual(store['atlas.telemetryUrl'], 'https://atlas.example/api/v1/telemetry/prompt-events')
  assert.deepStrictEqual(response, { ok: true })
})
