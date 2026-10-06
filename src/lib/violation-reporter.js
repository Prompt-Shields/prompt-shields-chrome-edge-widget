// Violation reporter — sends PolicyViolation events to atlas's
// `POST /api/v1/policies/violations` endpoint.
//
// HARD GUARANTEE: never sends the prompt body, the response, or
// extracted secret values. Only sends:
//   - promptHash (SHA-256 hex of the original prompt)
//   - matched detector category
//   - actionTaken (redacted | flagged | blocked)
//   - timestamp
//   - applicationId (the AI host — chatgpt.com, claude.ai, etc.)
//
// The atlas backend hard-rejects payloads where promptHash isn't a
// 64-char hex digest (DB CHECK + API validation). Defence in depth.
//
// Wire-format reference:
//   atlas.ai/frontend/src/lib/policy-types.ts (PolicyViolation type)
//   atlas.ai/backend/app/services/policy_evaluator.py (input shape)

(function (root) {
  'use strict'

  // SHA-256 → hex via Web Crypto. Returns a Promise<string> (64 chars).
  function sha256Hex (text) {
    if (!text) return Promise.resolve('')
    var bytes = new TextEncoder().encode(text)
    return crypto.subtle.digest('SHA-256', bytes).then(function (buf) {
      var arr = new Uint8Array(buf)
      var hex = ''
      for (var i = 0; i < arr.length; i++) {
        var h = arr[i].toString(16)
        hex += h.length === 1 ? ('0' + h) : h
      }
      return hex
    })
  }

  function uuid () {
    if (crypto && crypto.randomUUID) return crypto.randomUUID()
    // Fallback for old runtimes (Safari < 15.4 etc.)
    var s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    return s.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0
      var v = c === 'x' ? r : ((r & 0x3) | 0x8)
      return v.toString(16)
    })
  }

  // ─── Device fingerprint & session ─────────────────────────────────
  //
  // No heartbeat fingerprint exists in this client (unlike the macOS
  // widget), so we mint one: a UUID generated on first use, persisted
  // in chrome.storage.local so it is stable across page loads and
  // browser restarts. Joins to grc.prompt_events.device_fingerprint.

  var FINGERPRINT_KEY = 'atlas.deviceFingerprint'
  var cachedFingerprint = null

  function getDeviceFingerprint () {
    if (cachedFingerprint) return Promise.resolve(cachedFingerprint)
    return new Promise(function (resolve) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([FINGERPRINT_KEY], function (out) {
          var fp = out && out[FINGERPRINT_KEY]
          if (fp) { cachedFingerprint = fp; return resolve(fp) }
          fp = uuid()
          var obj = {}; obj[FINGERPRINT_KEY] = fp
          chrome.storage.local.set(obj, function () {
            cachedFingerprint = fp
            resolve(fp)
          })
        })
      } else {
        try {
          var fp = localStorage.getItem(FINGERPRINT_KEY)
          if (!fp) { fp = uuid(); localStorage.setItem(FINGERPRINT_KEY, fp) }
          cachedFingerprint = fp
          resolve(fp)
        } catch (e) { resolve(uuid()) }
      }
    })
  }

  // One session id per content-script load (≈ one page visit).
  var SESSION_ID = uuid()

  // Determine the application identifier from the host. The atlas
  // Application table keys on these — see
  // atlas.ai/frontend/src/lib/curated-demo-data.ts for the canonical set.
  function applicationIdFromHost (host) {
    var h = (host || '').toLowerCase()
    if (h.indexOf('chatgpt.com') !== -1 || h.indexOf('chat.openai.com') !== -1 || h.indexOf('openai.com') !== -1) return 'chatgpt'
    if (h.indexOf('claude.ai') !== -1 || h.indexOf('anthropic.com') !== -1) return 'claude'
    if (h.indexOf('gemini.google.com') !== -1) return 'gemini'
    if (h.indexOf('copilot.microsoft.com') !== -1) return 'copilot-ms'
    if (h.indexOf('perplexity.ai') !== -1) return 'perplexity'
    if (h.indexOf('deepseek.com') !== -1) return 'deepseek'
    if (h.indexOf('poe.com') !== -1) return 'poe'
    return 'unknown'
  }

  // ─── Queue (offline-tolerant) ────────────────────────────────────
  //
  // PEPs sometimes run offline. The macOS PEP plan calls for queueing
  // violations and flushing on reconnect. We use chrome.storage.local
  // (or window.localStorage in Safari) so the queue survives a
  // service-worker restart.

  var QUEUE_KEY = 'prompt-shields:violation-queue'        // legacy wire format (single-event POSTs)
  var TELEMETRY_QUEUE_KEY = 'prompt-shields:telemetry-queue' // atlas prompt-event wire format (batched)
  var QUEUE_MAX = 500 // cap so an offline session can't OOM storage

  function readQueueKey (key) {
    return new Promise(function (resolve) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get([key], function (out) {
          resolve((out && out[key]) || [])
        })
      } else {
        try { resolve(JSON.parse(localStorage.getItem(key) || '[]')) }
        catch (e) { resolve([]) }
      }
    })
  }

  function writeQueueKey (key, queue) {
    return new Promise(function (resolve) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        var obj = {}; obj[key] = queue
        chrome.storage.local.set(obj, function () { resolve() })
      } else {
        try { localStorage.setItem(key, JSON.stringify(queue)) } catch (e) { /* quota / private mode */ }
        resolve()
      }
    })
  }

  function readQueue () { return readQueueKey(QUEUE_KEY) }
  function writeQueue (queue) { return writeQueueKey(QUEUE_KEY, queue) }

  // ─── Core report ─────────────────────────────────────────────────
  //
  // Returns Promise<void>. Posts to the configured atlas endpoint.
  // On any network failure, queues the event for later retry.

  function buildEvent (params) {
    return sha256Hex(params.prompt || '').then(function (hash) {
      // Per-category breakdown for the evidence object — caller already
      // computed this via PIIDetector.redact().byCategory.
      var evidence = {
        byCategory: params.byCategory || {},
        detectorCount: params.matches ? params.matches.length : 0
      }
      return {
        id: uuid(),
        applicationId: applicationIdFromHost(params.host || (location && location.hostname) || ''),
        timestamp: new Date().toISOString(),
        actionTaken: params.actionTaken,           // 'redacted' | 'flagged' | 'blocked' | 'logged'
        severity: params.severity || 'medium',     // 'low' | 'medium' | 'high'
        detectorId: params.detectorId || 'pii-detector-v1',
        promptHash: hash,                          // 64-char hex SHA-256
        evidence: evidence,
        clientKind: params.clientKind || 'browser-extension',
        clientVersion: params.clientVersion || '1.5'
      }
    })
  }

  // ─── Atlas prompt-event wire format ───────────────────────────────
  //
  // POST {atlas}/api/v1/telemetry/prompt-events with X-API-Key.
  // Schema: atlas.ai backend/app/schemas/telemetry.py (PromptEventIn,
  // extra="forbid" — any field not listed below rejects the row, which
  // is also the privacy backstop: prompt text CANNOT be added without
  // the server skipping the event).
  //
  // HARD GUARANTEE (unchanged from the legacy path): never sends the
  // prompt body. Only the SHA-256 hash + category counts + metadata.

  function defaultHost () {
    return (typeof location !== 'undefined' && location && location.hostname) || ''
  }

  function buildPromptEvent (params) {
    return sha256Hex(params.prompt || '').then(function (hash) {
      return getDeviceFingerprint().then(function (fingerprint) {
        var event = {
          source: 'safari_extension',
          event_kind: params.eventKind,                       // 'violation' | 'activity'
          app_id: applicationIdFromHost(params.host || defaultHost()),
          pii_categories: params.byCategory || {},
          device_fingerprint: fingerprint,
          session_id: SESSION_ID,
          occurrences: params.occurrences || 1,
          occurred_at: new Date().toISOString()
        }
        // Omit, never '': atlas requires exactly 64 lowercase hex when present.
        if (hash) event.prompt_hash = hash
        // actionTaken vocabulary maps 1:1: redacted|flagged|blocked|logged
        // (violations) and allowed|redacted (activity).
        if (params.actionTaken) event.action = params.actionTaken
        // low|medium|high map 1:1 into the atlas enum (which adds 'critical'
        // for the macOS client). Activity events pass no severity.
        if (params.severity) event.severity = params.severity
        return event
      })
    })
  }

  var BATCH_MAX = 500 // atlas envelope cap (1–500 events per request)

  // opts.keepalive — set true ONLY on the unload-path (single-event posts via
  // reportPromptEvent). The Fetch spec caps in-flight keepalive request bodies
  // at 64 KiB total; flush-path batches can reach ~200 KiB (500 events × ~400
  // bytes), so keepalive would cause them to reject immediately, requeue whole,
  // and retry forever — a silent telemetry deadlock. Flush runs from the
  // 5-minute alarm, not unload, so it neither needs nor can afford keepalive.
  function postPromptEvents (telemetryUrl, apiKey, events, opts) {
    return fetch(telemetryUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': apiKey
      },
      body: JSON.stringify({ events: events }),
      keepalive: !!(opts && opts.keepalive)
    }).then(function (res) {
      if (!res.ok) throw new Error('atlas telemetry returned ' + res.status)
      return res.json().catch(function () {
        return { ingested: events.length, skipped: 0, skipped_reasons: [] }
      })
    })
  }

  function enqueueTelemetryEvent (event) {
    return readQueueKey(TELEMETRY_QUEUE_KEY).then(function (queue) {
      if (queue.length >= QUEUE_MAX) queue = queue.slice(queue.length - QUEUE_MAX + 1)
      queue.push(event)
      return writeQueueKey(TELEMETRY_QUEUE_KEY, queue)
    })
  }

  // ─── Legacy queue migration ───────────────────────────────────────
  //
  // Pre-cutover deployments may have legacy-shape events queued under
  // QUEUE_KEY from offline sessions. Once atlas.telemetryUrl is set,
  // nothing drains that queue — so map the events into the new wire
  // format and move them to the telemetry queue. Legacy-only fields
  // (id, detectorId, clientKind, clientVersion, evidence) are dropped:
  // the atlas schema is extra="forbid" and would reject them.

  var HASH_RE = /^[0-9a-f]{64}$/

  function legacyToPromptEvent (legacy, fingerprint) {
    var event = {
      source: 'safari_extension',
      event_kind: 'violation',
      app_id: legacy.applicationId || 'unknown',
      pii_categories: (legacy.evidence && legacy.evidence.byCategory) || {},
      device_fingerprint: fingerprint,
      occurrences: 1,
      occurred_at: legacy.timestamp || new Date().toISOString()
    }
    if (legacy.promptHash && HASH_RE.test(legacy.promptHash)) event.prompt_hash = legacy.promptHash
    if (legacy.actionTaken) event.action = legacy.actionTaken
    if (legacy.severity) event.severity = legacy.severity
    return event
  }

  function migrateLegacyQueue () {
    return readQueueKey(QUEUE_KEY).then(function (legacyQueue) {
      if (legacyQueue.length === 0) return 0
      return getDeviceFingerprint().then(function (fingerprint) {
        return readQueueKey(TELEMETRY_QUEUE_KEY).then(function (queue) {
          for (var i = 0; i < legacyQueue.length; i++) {
            queue.push(legacyToPromptEvent(legacyQueue[i], fingerprint))
          }
          if (queue.length > QUEUE_MAX) queue = queue.slice(queue.length - QUEUE_MAX)
          return writeQueueKey(TELEMETRY_QUEUE_KEY, queue).then(function () {
            return writeQueueKey(QUEUE_KEY, []).then(function () {
              return legacyQueue.length
            })
          })
        })
      })
    })
  }

  // ─── Activity events (clean / resolved prompt submissions) ────────

  // Decide whether a submitted prompt yields an activity event.
  //   matchCount  — detector matches present in the text at submit time
  //   wasRedacted — a redaction was applied to this input this round
  // Returns 'redacted' | 'allowed' | null. null = no activity event:
  // outstanding PII is the violation path's responsibility.
  function classifySubmission (matchCount, wasRedacted) {
    if (matchCount > 0) return null
    return wasRedacted ? 'redacted' : 'allowed'
  }

  // Enqueue only — activity events ride the 5-minute flush alarm and
  // are coalesced by (app_id, action) at flush time (occurrences).
  function enqueueActivity (params) {
    if (!params || !params.telemetryUrl || !params.apiKey) {
      return Promise.resolve({ queued: false })
    }
    var p = {
      prompt: params.prompt,
      eventKind: 'activity',
      actionTaken: params.actionTaken, // 'allowed' | 'redacted'
      host: params.host
      // no severity, no byCategory: clean prompts have neither
    }
    return buildPromptEvent(p).then(function (event) {
      return enqueueTelemetryEvent(event).then(function () { return { queued: true } })
    })
  }

  // Coalesce queued activity events that share (app_id, action) into a
  // single event with summed occurrences. Groups of one keep their
  // prompt_hash; merged groups drop it (a single hash cannot represent
  // several prompts) and keep the latest occurred_at. Violations pass
  // through untouched, order preserved.
  function coalesceActivityEvents (events) {
    var out = []
    var groups = {} // "app_id action" -> index into out
    for (var i = 0; i < events.length; i++) {
      var ev = events[i]
      if (ev.event_kind !== 'activity') { out.push(ev); continue }
      var key = String(ev.app_id) + ' ' + String(ev.action)
      if (groups[key] === undefined) {
        groups[key] = out.length
        // A merged group keeps the first event's session_id, so session_id is
        // approximate for merged rows (same caveat as dropping prompt_hash above).
        out.push(Object.assign({}, ev))
      } else {
        var agg = out[groups[key]]
        agg.occurrences = (agg.occurrences || 1) + (ev.occurrences || 1)
        delete agg.prompt_hash
        if (ev.occurred_at > agg.occurred_at) agg.occurred_at = ev.occurred_at
      }
    }
    return out
  }

  // Drain the telemetry queue: migrate legacy leftovers, coalesce
  // activity, chunk at the 500-event envelope cap, post. Failed batches
  // (network / non-2xx) go back on the queue; rows the server skipped
  // are final. Returns total ingested count.
  function flushTelemetryQueue (telemetryUrl, apiKey) {
    return migrateLegacyQueue().then(function () {
      return readQueueKey(TELEMETRY_QUEUE_KEY).then(function (queue) {
        if (queue.length === 0) return 0
        var events = coalesceActivityEvents(queue)
        var batches = []
        for (var i = 0; i < events.length; i += BATCH_MAX) {
          batches.push(events.slice(i, i + BATCH_MAX))
        }
        var delivered = 0
        var remaining = []
        var idx = 0
        // NOTE: read-modify-write window — events enqueued by another tab between
        // the readQueueKey above and the final writeQueueKey below can be lost.
        // This is the same pre-existing race as the legacy flushQueue; documented,
        // not fixed here.
        function next () {
          if (idx >= batches.length) {
            return writeQueueKey(TELEMETRY_QUEUE_KEY, remaining).then(function () { return delivered })
          }
          var batch = batches[idx++]
          return postPromptEvents(telemetryUrl, apiKey, batch)
            .then(function (body) { delivered += body.ingested || 0; return next() })
            .catch(function () { remaining = remaining.concat(batch); return next() })
        }
        return next()
      })
    })
  }

  /*
   * reportPromptEvent(params) — fire-and-forget reporter for the atlas
   * prompt-telemetry endpoint. Same shape as report() but new wire format.
   *
   * params: {
   *   telemetryUrl: 'https://<atlas>/api/v1/telemetry/prompt-events',
   *   apiKey: string,                      // sent as X-API-Key
   *   prompt: string,                      // hashed only, never sent
   *   eventKind: 'violation' | 'activity',
   *   actionTaken: 'redacted'|'flagged'|'blocked'|'logged'|'allowed',
   *   severity?: 'low'|'medium'|'high',
   *   byCategory?: { [category]: count },
   *   host?: string
   * }
   * Returns Promise<{ delivered, queued }>.
   * Network failure → telemetry queue. Server-side per-row skips are
   * FINAL (the row failed validation; retrying would loop forever).
   */
  function reportPromptEvent (params) {
    if (!params || !params.telemetryUrl || !params.apiKey) {
      return Promise.resolve({ delivered: false, queued: false, error: 'missing telemetryUrl or apiKey' })
    }
    return buildPromptEvent(params).then(function (event) {
      return postPromptEvents(params.telemetryUrl, params.apiKey, [event], { keepalive: true })
        .then(function (body) {
          return { delivered: true, queued: false, ingested: body.ingested, skipped: body.skipped }
        })
        .catch(function () {
          return enqueueTelemetryEvent(event).then(function () {
            return { delivered: false, queued: true }
          })
        })
    })
  }

  function postEvent (endpoint, apiKey, event) {
    return fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey
      },
      body: JSON.stringify(event),
      keepalive: true // survives page unload
    }).then(function (res) {
      if (!res.ok) throw new Error('atlas ingest returned ' + res.status)
      return res
    })
  }

  function flushQueue (endpoint, apiKey) {
    return readQueue().then(function (queue) {
      if (queue.length === 0) return 0
      var attempts = queue.slice()
      var remaining = []
      var idx = 0

      function next () {
        if (idx >= attempts.length) return writeQueue(remaining).then(function () { return attempts.length - remaining.length })
        var ev = attempts[idx++]
        return postEvent(endpoint, apiKey, ev)
          .then(function () { return next() })
          .catch(function () { remaining.push(ev); return next() })
      }
      return next()
    })
  }

  function queueEvent (event) {
    return readQueue().then(function (queue) {
      // Drop oldest if over cap.
      if (queue.length >= QUEUE_MAX) queue = queue.slice(queue.length - QUEUE_MAX + 1)
      queue.push(event)
      return writeQueue(queue)
    })
  }

  /*
   * report(params) — fire-and-forget violation reporter.
   *
   * params: {
   *   endpoint: 'https://atlas-ai.com/api/v1/policies/violations',
   *   apiKey: string,
   *   prompt: string,                     // hashed only, never sent
   *   actionTaken: 'redacted' | 'flagged' | 'blocked' | 'logged',
   *   severity?: 'low' | 'medium' | 'high',
   *   matches?: PIIDetector match[],
   *   byCategory?: { [category]: count }
   * }
   *
   * Returns Promise<{ delivered: boolean, queued: boolean }>.
   */
  function report (params) {
    if (!params || !params.endpoint || !params.apiKey) {
      return Promise.resolve({ delivered: false, queued: false, error: 'missing endpoint or apiKey' })
    }
    return buildEvent(params).then(function (event) {
      return postEvent(params.endpoint, params.apiKey, event)
        .then(function () { return { delivered: true, queued: false } })
        .catch(function () {
          return queueEvent(event).then(function () {
            return { delivered: false, queued: true }
          })
        })
    })
  }

  // ─── Export ──────────────────────────────────────────────────────

  root.PromptShieldsViolationReporter = {
    report: report,
    flushQueue: flushQueue,
    sha256Hex: sha256Hex,
    applicationIdFromHost: applicationIdFromHost,
    // atlas prompt-telemetry (new wire format)
    getDeviceFingerprint: getDeviceFingerprint,
    sessionId: function () { return SESSION_ID },
    buildPromptEvent: buildPromptEvent,
    postPromptEvents: postPromptEvents,
    reportPromptEvent: reportPromptEvent,
    enqueueTelemetryEvent: enqueueTelemetryEvent,
    legacyToPromptEvent: legacyToPromptEvent,
    migrateLegacyQueue: migrateLegacyQueue,
    classifySubmission: classifySubmission,
    enqueueActivity: enqueueActivity,
    coalesceActivityEvents: coalesceActivityEvents,
    flushTelemetryQueue: flushTelemetryQueue
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
