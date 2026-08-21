const { test, beforeEach } = require('node:test')
const assert = require('node:assert')

// ─── chrome.storage.local stub ──────────────────────────────────────
// Dual-mode: violation-reporter.js uses callback style; atlas-bundle.js
// (tested separately) awaits promises. Backed by a plain object.
let store = {}
globalThis.chrome = {
  storage: {
    local: {
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
  }
}

// ─── fetch stub ──────────────────────────────────────────────────────
let fetchCalls = []
let fetchResponder = () => okResponse({ ingested: 1, skipped: 0, skipped_reasons: [] })
globalThis.fetch = (url, opts) => {
  fetchCalls.push({ url, opts })
  return fetchResponder(url, opts)
}
function okResponse (body) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
}
function networkFailure () {
  return Promise.reject(new TypeError('network down'))
}

require('../violation-reporter.js')
const R = globalThis.PromptShieldsViolationReporter

const TELEMETRY_URL = 'https://atlas.example/api/v1/telemetry/prompt-events'
const TELEMETRY_QUEUE_KEY = 'prompt-shields:telemetry-queue'
const LEGACY_QUEUE_KEY = 'prompt-shields:violation-queue'

beforeEach(() => {
  store = {}
  fetchCalls = []
  fetchResponder = () => okResponse({ ingested: 1, skipped: 0, skipped_reasons: [] })
})

// ─── Task 1: device fingerprint ──────────────────────────────────────

test('getDeviceFingerprint generates once, persists, and is stable', async () => {
  const fp1 = await R.getDeviceFingerprint()
  assert.match(fp1, /^[0-9a-f-]{36}$/, 'fingerprint is a UUID')
  // NOTE: the module caches the fingerprint after first call; the storage
  // write happens on that first call, before any beforeEach wipes it in
  // later tests. Assert both persistence and stability inside ONE test.
  assert.strictEqual(store['atlas.deviceFingerprint'], fp1, 'persisted to storage')
  const fp2 = await R.getDeviceFingerprint()
  assert.strictEqual(fp2, fp1, 'stable across calls')
})

test('sessionId is a UUID and constant for the module lifetime', () => {
  assert.match(R.sessionId(), /^[0-9a-f-]{36}$/)
  assert.strictEqual(R.sessionId(), R.sessionId())
})

// ─── Task 2: buildPromptEvent mapper ────────────────────────────────

// sha256("hello") — known vector; crypto.subtle is real under Node.
const HELLO_HASH = '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824'

test('buildPromptEvent maps the legacy params onto the atlas wire schema', async () => {
  const ev = await R.buildPromptEvent({
    prompt: 'hello',
    eventKind: 'violation',
    actionTaken: 'redacted',
    severity: 'high',
    byCategory: { email: 2, ssn: 1 },
    host: 'chatgpt.com'
  })
  assert.strictEqual(ev.source, 'safari_extension')
  assert.strictEqual(ev.event_kind, 'violation')
  assert.strictEqual(ev.app_id, 'chatgpt')                  // applicationIdFromHost
  assert.strictEqual(ev.prompt_hash, HELLO_HASH)            // 64 lowercase hex
  assert.strictEqual(ev.action, 'redacted')                 // actionTaken → action, 1:1
  assert.strictEqual(ev.severity, 'high')                   // 1:1
  assert.deepStrictEqual(ev.pii_categories, { email: 2, ssn: 1 }) // byCategory → pii_categories
  assert.match(ev.device_fingerprint, /^[0-9a-f-]{36}$/)
  assert.strictEqual(ev.session_id, R.sessionId())
  assert.strictEqual(ev.occurrences, 1)
  assert.ok(!Number.isNaN(Date.parse(ev.occurred_at)), 'occurred_at is ISO')
})

test('buildPromptEvent OMITS prompt_hash for an empty prompt (never "")', async () => {
  const ev = await R.buildPromptEvent({ prompt: '', eventKind: 'activity', actionTaken: 'allowed', host: 'claude.ai' })
  assert.ok(!('prompt_hash' in ev), 'empty hash must be omitted — atlas rejects non-64-hex')
  assert.strictEqual(ev.app_id, 'claude')
  assert.strictEqual(ev.event_kind, 'activity')
  assert.strictEqual(ev.action, 'allowed')
  assert.ok(!('severity' in ev), 'activity events carry no severity')
})

test('PRIVACY: event object contains ONLY whitelisted wire fields and no prompt text', async () => {
  const SECRET = 'my ssn is 123-45-6789, email jane.doe@corp.example'
  const ev = await R.buildPromptEvent({
    prompt: SECRET,
    eventKind: 'violation',
    actionTaken: 'flagged',
    severity: 'medium',
    byCategory: { ssn: 1, email: 1 },
    host: 'chatgpt.com'
  })
  const ALLOWED = [
    'source', 'event_kind', 'app_id', 'prompt_hash', 'action', 'severity',
    'pii_categories', 'device_fingerprint', 'session_id', 'occurrences', 'occurred_at'
  ]
  for (const k of Object.keys(ev)) {
    assert.ok(ALLOWED.includes(k), 'unexpected wire field (atlas extra="forbid" would reject): ' + k)
  }
  const serialized = JSON.stringify(ev)
  assert.ok(!serialized.includes('123-45-6789'), 'no SSN in payload')
  assert.ok(!serialized.includes('jane.doe@corp.example'), 'no email in payload')
  assert.ok(!serialized.includes(SECRET), 'no prompt text in payload')
})

// ─── Task 3: postPromptEvents / reportPromptEvent ───────────────────

test('reportPromptEvent posts a 1-element batch envelope with X-API-Key (no Bearer)', async () => {
  const res = await R.reportPromptEvent({
    telemetryUrl: TELEMETRY_URL,
    apiKey: 'aigrc_test_key',
    prompt: 'hello',
    eventKind: 'violation',
    actionTaken: 'blocked',
    severity: 'high',
    byCategory: { creditCard: 1 },
    host: 'chatgpt.com'
  })
  assert.deepStrictEqual({ delivered: res.delivered, queued: res.queued }, { delivered: true, queued: false })
  assert.strictEqual(fetchCalls.length, 1)
  const call = fetchCalls[0]
  assert.strictEqual(call.url, TELEMETRY_URL)
  assert.strictEqual(call.opts.method, 'POST')
  assert.strictEqual(call.opts.headers['X-API-Key'], 'aigrc_test_key')
  assert.ok(!('Authorization' in call.opts.headers), 'Bearer header must be gone')
  assert.strictEqual(call.opts.headers['Content-Type'], 'application/json')
  const body = JSON.parse(call.opts.body)
  assert.ok(Array.isArray(body.events) && body.events.length === 1, 'batch envelope')
  assert.strictEqual(body.events[0].action, 'blocked')
  assert.strictEqual(call.opts.keepalive, true, 'unload-path post must set keepalive to survive page unload')
})

test('reportPromptEvent queues to the telemetry queue on network failure (fail-open)', async () => {
  fetchResponder = networkFailure
  const res = await R.reportPromptEvent({
    telemetryUrl: TELEMETRY_URL, apiKey: 'aigrc_test_key',
    prompt: 'hello', eventKind: 'violation', actionTaken: 'redacted',
    severity: 'medium', byCategory: { email: 1 }, host: 'claude.ai'
  })
  assert.deepStrictEqual({ delivered: res.delivered, queued: res.queued }, { delivered: false, queued: true })
  assert.strictEqual((store[TELEMETRY_QUEUE_KEY] || []).length, 1)
  assert.strictEqual(store[TELEMETRY_QUEUE_KEY][0].event_kind, 'violation')
})

test('reportPromptEvent does NOT requeue rows the server skipped (2xx with skips)', async () => {
  fetchResponder = () => okResponse({ ingested: 0, skipped: 1, skipped_reasons: ['events[0]: prompt_hash: bad'] })
  const res = await R.reportPromptEvent({
    telemetryUrl: TELEMETRY_URL, apiKey: 'aigrc_test_key',
    prompt: 'hello', eventKind: 'violation', actionTaken: 'logged',
    severity: 'low', byCategory: {}, host: 'poe.com'
  })
  assert.strictEqual(res.delivered, true, '2xx means delivered even if skipped')
  assert.strictEqual((store[TELEMETRY_QUEUE_KEY] || []).length, 0, 'server-rejected rows are final')
})

test('reportPromptEvent without telemetryUrl/apiKey is a no-op (fail-open)', async () => {
  const res = await R.reportPromptEvent({ prompt: 'hello', eventKind: 'violation', actionTaken: 'redacted' })
  assert.strictEqual(res.delivered, false)
  assert.strictEqual(res.queued, false)
  assert.strictEqual(fetchCalls.length, 0)
})

test('PRIVACY: HTTP request body never contains prompt text', async () => {
  const SECRET = 'patient record 123-45-6789 belongs to jane.doe@corp.example'
  await R.reportPromptEvent({
    telemetryUrl: TELEMETRY_URL, apiKey: 'aigrc_test_key',
    prompt: SECRET, eventKind: 'violation', actionTaken: 'redacted',
    severity: 'high', byCategory: { ssn: 1, email: 1 }, host: 'chatgpt.com'
  })
  const body = fetchCalls[0].opts.body
  assert.ok(!body.includes('123-45-6789'))
  assert.ok(!body.includes('jane.doe@corp.example'))
  assert.ok(!body.includes(SECRET))
})

// ─── Task 4: legacy queue migration ─────────────────────────────────

test('migrateLegacyQueue maps legacy-shape events and clears the old queue', async () => {
  store[LEGACY_QUEUE_KEY] = [{
    id: 'b6f7c9e2-1111-4222-8333-444455556666',
    applicationId: 'chatgpt',
    timestamp: '2026-06-10T12:00:00.000Z',
    actionTaken: 'flagged',
    severity: 'medium',
    detectorId: 'pii-detector-v1',
    promptHash: HELLO_HASH,
    evidence: { byCategory: { email: 1 }, detectorCount: 1 },
    clientKind: 'safari-extension',
    clientVersion: '1.5'
  }]
  const n = await R.migrateLegacyQueue()
  assert.strictEqual(n, 1)
  assert.deepStrictEqual(store[LEGACY_QUEUE_KEY], [], 'legacy queue cleared')
  const migrated = store[TELEMETRY_QUEUE_KEY]
  assert.strictEqual(migrated.length, 1)
  const ev = migrated[0]
  assert.strictEqual(ev.source, 'safari_extension')
  assert.strictEqual(ev.event_kind, 'violation')
  assert.strictEqual(ev.app_id, 'chatgpt')
  assert.strictEqual(ev.prompt_hash, HELLO_HASH)
  assert.strictEqual(ev.action, 'flagged')
  assert.strictEqual(ev.severity, 'medium')
  assert.deepStrictEqual(ev.pii_categories, { email: 1 })
  assert.strictEqual(ev.occurred_at, '2026-06-10T12:00:00.000Z')
  // extra="forbid": legacy-only fields must NOT survive migration
  for (const k of ['id', 'detectorId', 'clientKind', 'clientVersion', 'evidence', 'applicationId', 'promptHash', 'actionTaken', 'timestamp']) {
    assert.ok(!(k in ev), 'legacy field leaked into wire event: ' + k)
  }
})

test('migrateLegacyQueue drops a non-64-hex promptHash rather than sending it', async () => {
  store[LEGACY_QUEUE_KEY] = [{
    applicationId: 'claude', timestamp: '2026-06-10T12:00:00.000Z',
    actionTaken: 'redacted', severity: 'low', promptHash: '',
    evidence: { byCategory: {} }
  }]
  await R.migrateLegacyQueue()
  assert.ok(!('prompt_hash' in store[TELEMETRY_QUEUE_KEY][0]))
})

test('migrateLegacyQueue is a no-op on an empty legacy queue', async () => {
  const n = await R.migrateLegacyQueue()
  assert.strictEqual(n, 0)
  assert.ok(!(TELEMETRY_QUEUE_KEY in store))
})

// ─── Task 5: classifySubmission / enqueueActivity ───────────────────

test('classifySubmission: clean prompt → allowed; redacted prompt → redacted; outstanding PII → null', () => {
  assert.strictEqual(R.classifySubmission(0, false), 'allowed')
  assert.strictEqual(R.classifySubmission(0, true), 'redacted')
  assert.strictEqual(R.classifySubmission(3, false), null, 'violation path owns prompts with live PII')
  assert.strictEqual(R.classifySubmission(1, true), null)
})

test('enqueueActivity queues an activity event without posting', async () => {
  const res = await R.enqueueActivity({
    telemetryUrl: TELEMETRY_URL, apiKey: 'aigrc_test_key',
    prompt: 'hello', actionTaken: 'allowed', host: 'chatgpt.com'
  })
  assert.strictEqual(res.queued, true)
  assert.strictEqual(fetchCalls.length, 0, 'activity is batched, never posted inline')
  const ev = store[TELEMETRY_QUEUE_KEY][0]
  assert.strictEqual(ev.event_kind, 'activity')
  assert.strictEqual(ev.action, 'allowed')
  assert.strictEqual(ev.app_id, 'chatgpt')
  assert.strictEqual(ev.prompt_hash, HELLO_HASH)
  assert.ok(!('severity' in ev), 'activity events carry no severity')
})

test('enqueueActivity is a no-op without telemetry config (fail-open)', async () => {
  const res = await R.enqueueActivity({ prompt: 'hello', actionTaken: 'allowed' })
  assert.strictEqual(res.queued, false)
  assert.ok(!(TELEMETRY_QUEUE_KEY in store))
})

// ─── Task 6: coalesceActivityEvents / flushTelemetryQueue ──────────

function activityEvent (appId, action, hash, occurredAt) {
  const ev = {
    source: 'safari_extension', event_kind: 'activity', app_id: appId,
    action, pii_categories: {}, device_fingerprint: 'fp', session_id: 's',
    occurrences: 1, occurred_at: occurredAt || '2026-06-12T10:00:00.000Z'
  }
  if (hash) ev.prompt_hash = hash
  return ev
}

test('coalesceActivityEvents merges identical (app_id, action) pairs via occurrences', () => {
  const violation = { source: 'safari_extension', event_kind: 'violation', app_id: 'chatgpt', action: 'redacted', occurrences: 1, occurred_at: '2026-06-12T10:00:00.000Z' }
  const out = R.coalesceActivityEvents([
    activityEvent('chatgpt', 'allowed', 'a'.repeat(64), '2026-06-12T10:00:00.000Z'),
    activityEvent('chatgpt', 'allowed', 'b'.repeat(64), '2026-06-12T10:05:00.000Z'),
    activityEvent('chatgpt', 'allowed', 'c'.repeat(64), '2026-06-12T10:03:00.000Z'),
    activityEvent('claude', 'allowed', 'd'.repeat(64)),
    activityEvent('chatgpt', 'redacted', 'e'.repeat(64)),
    violation
  ])
  assert.strictEqual(out.length, 4) // chatgpt/allowed ×3 merged + claude/allowed + chatgpt/redacted + violation
  const merged = out.find((e) => e.app_id === 'chatgpt' && e.action === 'allowed')
  assert.strictEqual(merged.occurrences, 3)
  assert.ok(!('prompt_hash' in merged), 'one hash cannot represent three prompts')
  assert.strictEqual(merged.occurred_at, '2026-06-12T10:05:00.000Z', 'latest timestamp wins')
  const single = out.find((e) => e.app_id === 'claude')
  assert.strictEqual(single.prompt_hash, 'd'.repeat(64), 'singletons keep their hash')
  assert.ok(out.includes(violation) || out.some((e) => e.event_kind === 'violation'), 'violations pass through untouched')
})

test('flushTelemetryQueue posts coalesced batch, clears queue, returns ingested count', async () => {
  store[TELEMETRY_QUEUE_KEY] = [
    activityEvent('chatgpt', 'allowed', 'a'.repeat(64)),
    activityEvent('chatgpt', 'allowed', 'b'.repeat(64))
  ]
  fetchResponder = () => okResponse({ ingested: 1, skipped: 0, skipped_reasons: [] })
  const n = await R.flushTelemetryQueue(TELEMETRY_URL, 'aigrc_test_key')
  assert.strictEqual(n, 1)
  assert.strictEqual(fetchCalls.length, 1)
  const body = JSON.parse(fetchCalls[0].opts.body)
  assert.strictEqual(body.events.length, 1)
  assert.strictEqual(body.events[0].occurrences, 2)
  assert.deepStrictEqual(store[TELEMETRY_QUEUE_KEY], [], 'queue drained')
})

test('flushTelemetryQueue keeps events on network failure', async () => {
  store[TELEMETRY_QUEUE_KEY] = [activityEvent('chatgpt', 'allowed', 'a'.repeat(64))]
  fetchResponder = networkFailure
  const n = await R.flushTelemetryQueue(TELEMETRY_URL, 'aigrc_test_key')
  assert.strictEqual(n, 0)
  assert.strictEqual(store[TELEMETRY_QUEUE_KEY].length, 1, 'unsent batch requeued')
})

test('flushTelemetryQueue migrates legacy-queue leftovers first', async () => {
  store[LEGACY_QUEUE_KEY] = [{
    applicationId: 'gemini', timestamp: '2026-06-10T09:00:00.000Z',
    actionTaken: 'blocked', severity: 'high', promptHash: 'f'.repeat(64),
    evidence: { byCategory: { apiKey: 1 } }
  }]
  fetchResponder = () => okResponse({ ingested: 1, skipped: 0, skipped_reasons: [] })
  const n = await R.flushTelemetryQueue(TELEMETRY_URL, 'aigrc_test_key')
  assert.strictEqual(n, 1)
  const body = JSON.parse(fetchCalls[0].opts.body)
  assert.strictEqual(body.events[0].app_id, 'gemini')
  assert.strictEqual(body.events[0].action, 'blocked')
  assert.deepStrictEqual(store[LEGACY_QUEUE_KEY], [], 'legacy queue drained through new endpoint')
})

test('flushTelemetryQueue chunks at 500 events per request', async () => {
  // 501 distinct violations (never coalesced) → two POSTs
  const many = []
  for (let i = 0; i < 501; i++) {
    many.push({ source: 'safari_extension', event_kind: 'violation', app_id: 'app' + i, action: 'flagged', occurrences: 1, occurred_at: '2026-06-12T10:00:00.000Z' })
  }
  store[TELEMETRY_QUEUE_KEY] = many
  fetchResponder = (url, opts) => okResponse({ ingested: JSON.parse(opts.body).events.length, skipped: 0, skipped_reasons: [] })
  const n = await R.flushTelemetryQueue(TELEMETRY_URL, 'aigrc_test_key')
  assert.strictEqual(fetchCalls.length, 2)
  assert.strictEqual(JSON.parse(fetchCalls[0].opts.body).events.length, 500)
  assert.strictEqual(JSON.parse(fetchCalls[1].opts.body).events.length, 1)
  assert.strictEqual(n, 501)
  assert.ok(fetchCalls.every((c) => !c.opts.keepalive), 'flush-path posts must NOT set keepalive — 64KiB body cap would deadlock large batches')
})
