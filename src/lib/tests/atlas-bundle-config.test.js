const { test, beforeEach } = require('node:test')
const assert = require('node:assert')

// atlas-bundle.js registers chrome listeners at require time and exports
// onto `self`, so both must exist BEFORE require.
globalThis.self = globalThis
let store = {}
let managedStore = {}
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
    },
    // Enterprise policy (Intune / GPO) surface.
    managed: {
      get () { return Promise.resolve(Object.assign({}, managedStore)) }
    },
    onChanged: { addListener () {} }
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

beforeEach(() => { store = {}; managedStore = {} })

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

test('managed policy overrides local settings and is reported as managed', async () => {
  store['atlas.telemetryUrl'] = 'https://cloud.example/api/v1/telemetry/prompt-events'
  store['atlas.enforcementMode'] = 'guideline'
  managedStore = {
    telemetryUrl: 'https://atlas.corp.internal/api/v1/telemetry/prompt-events',
    enforcementMode: 'strict',
    customRules: [{ id: 'falcon', pattern: 'Project Falcon' }]
  }
  const cfg = await B.readAtlasConfig()
  assert.strictEqual(cfg.telemetryUrl, 'https://atlas.corp.internal/api/v1/telemetry/prompt-events')
  assert.strictEqual(cfg.enforcementMode, 'strict')
  assert.deepStrictEqual(cfg.customRules, [{ id: 'falcon', pattern: 'Project Falcon' }])
  assert.deepStrictEqual(cfg.managedKeys.sort(), ['customRules', 'enforcementMode', 'telemetryUrl'])
})

test('managed values of the wrong type are ignored, not trusted', async () => {
  managedStore = { telemetryDisabled: 'yes', customRules: 'Project Falcon', enforcementMode: 'lenient' }
  const cfg = await B.readAtlasConfig()
  assert.strictEqual(cfg.telemetryDisabled, false)
  assert.deepStrictEqual(cfg.customRules, [])
  assert.strictEqual(cfg.enforcementMode, 'guideline', 'unknown modes fall back to guideline')
})

test('a local write cannot loosen a managed setting', async () => {
  managedStore = { telemetryDisabled: true }
  onMessageListener({ type: 'setAtlasConfig', config: { telemetryDisabled: false } }, null, () => {})
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.strictEqual(store['atlas.telemetryDisabled'], false)
  const cfg = await B.readAtlasConfig()
  assert.strictEqual(cfg.telemetryDisabled, true)
})

test('telemetryDisabled strips every reporting destination from content config', async () => {
  store['atlas.endpoint'] = 'https://atlas.example/api/v1/policies'
  store['atlas.violationsUrl'] = 'https://atlas.example/api/v1/policies/violations'
  store['atlas.telemetryUrl'] = 'https://atlas.example/api/v1/telemetry/prompt-events'
  store['atlas.apiKey'] = 'k'
  managedStore = { telemetryDisabled: true }
  const pub = B.contentConfig(await B.readAtlasConfig())
  assert.strictEqual(pub.endpoint, null)
  assert.strictEqual(pub.telemetryUrl, null)
  assert.strictEqual(pub.apiKey, null)
  assert.strictEqual(pub.telemetryDisabled, true)
  assert.deepStrictEqual(await B.flushQueueViaTabs(), { ok: false, reason: 'telemetry disabled by policy' })
})

test('getConfig delivers local policy even when Atlas reporting is not configured', async () => {
  managedStore = { customRules: [{ pattern: 'Project Falcon' }], injectionDetection: false }
  store['atlas.telemetryUrl'] = 'https://atlas.example/api/v1/telemetry/prompt-events' // no apiKey / endpoint
  let response
  const handled = onMessageListener({ type: 'getConfig' }, null, (r) => { response = r })
  assert.strictEqual(handled, true)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepStrictEqual(response.customRules, [{ pattern: 'Project Falcon' }])
  assert.strictEqual(response.injectionDetection, false)
  assert.strictEqual(response.telemetryUrl, null, 'no destination until Atlas is configured')
  assert.strictEqual(response.apiKey, null)
})

test('missing chrome.storage.managed means no policy', async () => {
  const saved = globalThis.chrome.storage.managed
  delete globalThis.chrome.storage.managed
  try {
    assert.deepStrictEqual(await B.readManagedPolicy(), {})
  } finally {
    globalThis.chrome.storage.managed = saved
  }
})
