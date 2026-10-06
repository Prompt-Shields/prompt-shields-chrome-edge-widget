// Atlas policy-bundle manager — runs in the background service worker.
//
// What this does:
//   1. Polls atlas's `GET /api/v1/policies` every 60s with
//      `If-Modified-Since` so we only fetch a body when the bundle
//      changed.
//   2. Caches the response in `chrome.storage.local` so service-worker
//      restarts don't lose state. Also caches `If-Modified-Since`.
//   3. Broadcasts a `policyUpdate` message to every active tab when
//      the bundle changes — content.js listens and resets tooltip
//      suppression so users see the new policy's first 5 detections.
//   4. Periodically flushes the violation queue via the reporter's
//      `flushQueue` (queued events from offline sessions).
//   5. Responds to `getConfig` from content.js with the merged
//      atlasConfig — endpoint, apiKey, enforcementMode, appealUrl.
//
// HARD INVARIANTS:
//   - Never blocks if atlas isn't configured. The extension's legacy
//     Auth0 + redaction flow keeps working with zero atlas integration.
//   - Never sends prompt body — atlas tracking is opt-in via APIKey.
//   - Service-worker eviction tolerant — every 60s tick re-derives
//     state from chrome.storage.local rather than module-scope vars.
//
// Config keys read from chrome.storage.local:
//   atlas.endpoint        full URL to /api/v1/policies
//   atlas.violationsUrl   full URL to /api/v1/policies/violations
//   atlas.telemetryUrl    full URL to /api/v1/telemetry/prompt-events
//                         (presence cuts violation reporting over to the
//                         unified telemetry endpoint; absent = legacy path)
//   atlas.apiKey          per-user APIKey (atlas APIKey model)
//   atlas.enforcementMode "guideline" | "strict" (default: "guideline")
//   atlas.appealUrl       optional URL the tooltip's Appeal link points at
//   atlas.injectionDetection  boolean, default true
//   atlas.customRules     array of org confidential-term rules (custom-rules.js)
//   atlas.fileGuard       upload-guard policy object (file-guard.js)
//   atlas.telemetryDisabled   boolean — true = no events ever leave the device
//
// Enterprise managed policy (chrome.storage.managed, schema in
// managed_schema.json) is overlaid on top of the local keys and always
// wins, so IT can pin an on-prem endpoint or disable telemetry via Intune /
// GPO without users being able to change it. See
// docs/ENTERPRISE_DEPLOYMENT.md.
// Cache keys (managed by this module):
//   atlas.bundle          last-fetched ActivePoliciesResponse body
//   atlas.lastModified    last If-Modified-Since header value
//   atlas.fetchedAt       ISO timestamp of last successful fetch

'use strict'

const ATLAS_POLL_ALARM = 'atlas-poll'
const ATLAS_FLUSH_ALARM = 'atlas-flush'
const POLL_PERIOD_MIN = 1   // chrome.alarms minimum is 1 minute on MV3
const FLUSH_PERIOD_MIN = 5

// ─── Config helpers ──────────────────────────────────────────────────

// Managed-policy key → config field. Each entry also says which JS type
// the value must have; anything else is ignored rather than trusted.
const MANAGED_FIELDS = {
  policyEndpoint: ['endpoint', 'string'],
  violationsUrl: ['violationsUrl', 'string'],
  telemetryUrl: ['telemetryUrl', 'string'],
  apiKey: ['apiKey', 'string'],
  enforcementMode: ['enforcementMode', 'string'],
  appealUrl: ['appealUrl', 'string'],
  injectionDetection: ['injectionDetection', 'boolean'],
  customRules: ['customRules', 'array'],
  fileGuard: ['fileGuard', 'object'],
  telemetryDisabled: ['telemetryDisabled', 'boolean']
}

function typeMatches (value, type) {
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return !!value && typeof value === 'object' && !Array.isArray(value)
  return typeof value === type
}

// chrome.storage.managed is undefined without a managed_schema and rejects
// on some platforms when no policy is set — both mean "no policy".
async function readManagedPolicy () {
  try {
    if (!chrome.storage.managed) return {}
    const out = await chrome.storage.managed.get(null)
    return out || {}
  } catch (e) {
    return {}
  }
}

async function readAtlasConfig () {
  const out = await chrome.storage.local.get([
    'atlas.endpoint', 'atlas.violationsUrl', 'atlas.telemetryUrl', 'atlas.apiKey',
    'atlas.enforcementMode', 'atlas.appealUrl',
    'atlas.injectionDetection', 'atlas.customRules', 'atlas.fileGuard', 'atlas.telemetryDisabled',
    'atlas.bundle', 'atlas.lastModified', 'atlas.fetchedAt'
  ])
  const cfg = {
    endpoint: out['atlas.endpoint'] || null,
    violationsUrl: out['atlas.violationsUrl'] || null,
    telemetryUrl: out['atlas.telemetryUrl'] || null,
    apiKey: out['atlas.apiKey'] || null,
    enforcementMode: out['atlas.enforcementMode'] || 'guideline',
    appealUrl: out['atlas.appealUrl'] || null,
    injectionDetection: out['atlas.injectionDetection'] !== false,
    customRules: Array.isArray(out['atlas.customRules']) ? out['atlas.customRules'] : [],
    fileGuard: out['atlas.fileGuard'] || { enabled: true },
    telemetryDisabled: out['atlas.telemetryDisabled'] === true,
    managedKeys: [],
    bundle: out['atlas.bundle'] || null,
    lastModified: out['atlas.lastModified'] || null,
    fetchedAt: out['atlas.fetchedAt'] || null
  }

  const managed = await readManagedPolicy()
  Object.keys(MANAGED_FIELDS).forEach(function (key) {
    const field = MANAGED_FIELDS[key][0]
    const type = MANAGED_FIELDS[key][1]
    if (key in managed && typeMatches(managed[key], type)) {
      cfg[field] = managed[key]
      cfg.managedKeys.push(field)
    }
  })
  if (cfg.enforcementMode !== 'strict') cfg.enforcementMode = 'guideline'
  return cfg
}

function isConfigured (cfg) {
  return !!(cfg.endpoint && cfg.apiKey)
}

// Configuration the content script consumes — strips internal cache fields.
// telemetryDisabled strips every reporting destination, so the content
// script has nowhere to send events even if a code path forgot to check.
function publicConfig (cfg) {
  const offline = cfg.telemetryDisabled === true
  return {
    endpoint: offline ? null : cfg.violationsUrl,
    telemetryUrl: offline ? null : cfg.telemetryUrl,
    apiKey: offline ? null : cfg.apiKey,
    enforcementMode: cfg.enforcementMode,
    appealUrl: cfg.appealUrl,
    injectionDetection: cfg.injectionDetection !== false,
    customRules: cfg.customRules || [],
    fileGuard: cfg.fileGuard || { enabled: true },
    telemetryDisabled: offline,
    clientVersion: chrome.runtime.getManifest().version
  }
}

// What getConfig / configUpdate deliver. Local policy (detectors, custom
// rules, upload guard) applies even when Atlas reporting is not set up;
// reporting destinations are only handed out once Atlas is configured.
function contentConfig (cfg) {
  const pub = publicConfig(cfg)
  if (!isConfigured(cfg)) {
    pub.endpoint = null
    pub.telemetryUrl = null
    pub.apiKey = null
  }
  return pub
}

function broadcastConfig () {
  readAtlasConfig().then(function (cfg) {
    const config = contentConfig(cfg)
    chrome.tabs.query({}, function (tabs) {
      tabs.forEach(function (t) {
        if (t.id == null) return
        chrome.tabs.sendMessage(t.id, { type: 'configUpdate', config }, function () {
          void chrome.runtime.lastError
        })
      })
    })
  })
}

// ─── Polling ────────────────────────────────────────────────────────

async function pollBundle () {
  const cfg = await readAtlasConfig()
  if (!isConfigured(cfg)) return { ok: false, reason: 'not configured' }

  try {
    const headers = {
      'Accept': 'application/json',
      'Authorization': 'Bearer ' + cfg.apiKey
    }
    if (cfg.lastModified) headers['If-Modified-Since'] = cfg.lastModified

    const res = await fetch(cfg.endpoint, { method: 'GET', headers })
    if (res.status === 304) return { ok: true, changed: false }
    if (!res.ok) return { ok: false, reason: 'HTTP ' + res.status }

    const body = await res.json()
    const lastModified = res.headers.get('Last-Modified') || new Date().toUTCString()
    const fetchedAt = new Date().toISOString()

    await chrome.storage.local.set({
      'atlas.bundle': body,
      'atlas.lastModified': lastModified,
      'atlas.fetchedAt': fetchedAt
    })

    // Tell every active tab the bundle changed so they reset
    // tooltip suppression.
    broadcastPolicyUpdate()
    return { ok: true, changed: true }
  } catch (err) {
    return { ok: false, reason: String(err) }
  }
}

function broadcastPolicyUpdate () {
  chrome.tabs.query({}, function (tabs) {
    for (let i = 0; i < tabs.length; i++) {
      const tabId = tabs[i].id
      if (tabId == null) continue
      chrome.tabs.sendMessage(tabId, { type: 'policyUpdate' }, function () {
        // Tab may not have a content script — chrome.runtime.lastError
        // is expected and ignored.
        void chrome.runtime.lastError
      })
    }
  })
}

// ─── Flush queue ────────────────────────────────────────────────────
//
// The content-side reporter writes failed events to chrome.storage.local
// under `prompt-shields:violation-queue`. Here we ask each active tab to
// flush its in-memory copy, then directly drain the on-disk queue.

async function flushQueueViaTabs () {
  const cfg = await readAtlasConfig()
  if (!isConfigured(cfg)) return { ok: false, reason: 'not configured' }
  if (cfg.telemetryDisabled) return { ok: false, reason: 'telemetry disabled by policy' }
  return new Promise(function (resolve) {
    chrome.tabs.query({ active: true }, function (tabs) {
      let pending = tabs.length
      let totalFlushed = 0
      if (pending === 0) return resolve({ ok: true, flushed: 0 })
      tabs.forEach(function (tab) {
        if (tab.id == null) { pending--; if (pending === 0) resolve({ ok: true, flushed: totalFlushed }); return }
        chrome.tabs.sendMessage(tab.id, { type: 'flushQueue' }, function (resp) {
          void chrome.runtime.lastError
          if (resp && typeof resp.flushed === 'number') totalFlushed += resp.flushed
          pending--
          if (pending === 0) resolve({ ok: true, flushed: totalFlushed })
        })
      })
    })
  })
}

// ─── Wiring ─────────────────────────────────────────────────────────

// Set up alarms once on install / startup. chrome.alarms tolerates the
// service worker being evicted between ticks.
function ensureAlarms () {
  chrome.alarms.create(ATLAS_POLL_ALARM, { periodInMinutes: POLL_PERIOD_MIN })
  chrome.alarms.create(ATLAS_FLUSH_ALARM, { periodInMinutes: FLUSH_PERIOD_MIN })
}

chrome.runtime.onInstalled.addListener(function () {
  ensureAlarms()
  pollBundle().then(function () { /* fire-and-forget first poll */ })
})

chrome.runtime.onStartup.addListener(function () {
  ensureAlarms()
})

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === ATLAS_POLL_ALARM) pollBundle()
  else if (alarm.name === ATLAS_FLUSH_ALARM) flushQueueViaTabs()
})

// An admin pushing a new Intune / GPO policy takes effect in open tabs
// without a browser restart.
if (chrome.storage.onChanged) {
  chrome.storage.onChanged.addListener(function (_changes, area) {
    if (area === 'managed') broadcastConfig()
  })
}

// Message handler — content.js sends `getConfig` on load, popup.js may
// send `setAtlasConfig` to update endpoint/apiKey/etc.
chrome.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
  if (!msg || !msg.type) return false

  if (msg.type === 'getConfig') {
    readAtlasConfig().then(function (cfg) {
      sendResponse(contentConfig(cfg))
    })
    return true // async
  }

  if (msg.type === 'setAtlasConfig' && msg.config) {
    const updates = {}
    if (typeof msg.config.endpoint === 'string') updates['atlas.endpoint'] = msg.config.endpoint
    if (typeof msg.config.violationsUrl === 'string') updates['atlas.violationsUrl'] = msg.config.violationsUrl
    if (typeof msg.config.telemetryUrl === 'string') updates['atlas.telemetryUrl'] = msg.config.telemetryUrl
    if (typeof msg.config.apiKey === 'string') updates['atlas.apiKey'] = msg.config.apiKey
    if (typeof msg.config.enforcementMode === 'string') updates['atlas.enforcementMode'] = msg.config.enforcementMode
    if (typeof msg.config.appealUrl === 'string') updates['atlas.appealUrl'] = msg.config.appealUrl
    if (typeof msg.config.injectionDetection === 'boolean') updates['atlas.injectionDetection'] = msg.config.injectionDetection
    if (Array.isArray(msg.config.customRules)) updates['atlas.customRules'] = msg.config.customRules
    if (msg.config.fileGuard && typeof msg.config.fileGuard === 'object') updates['atlas.fileGuard'] = msg.config.fileGuard
    if (typeof msg.config.telemetryDisabled === 'boolean') updates['atlas.telemetryDisabled'] = msg.config.telemetryDisabled
    // Managed-policy values still win at read time (readAtlasConfig), so a
    // local write can never loosen what IT has pinned.
    chrome.storage.local.set(updates, function () {
      pollBundle().then(function () {
        // Push the new config to every tab immediately.
        broadcastConfig()
        sendResponse({ ok: true })
      })
    })
    return true
  }

  if (msg.type === 'pollNow') {
    pollBundle().then(function (r) { sendResponse(r) })
    return true
  }

  return false
})

// Expose a tiny test surface so unit tests / dev tools can drive the
// module without sending messages.
self.PromptShieldsAtlasBundle = {
  pollBundle: pollBundle,
  flushQueueViaTabs: flushQueueViaTabs,
  readAtlasConfig: readAtlasConfig,
  readManagedPolicy: readManagedPolicy,
  isConfigured: isConfigured,
  publicConfig: publicConfig,
  contentConfig: contentConfig
}
