// PII pre-scan content script — runs BEFORE the legacy content.js.
//
// Why this is a separate file instead of a refactor of content.js:
//   - content.js is 1088 lines of working ActionView state-machine UI
//     for the LLM-suggestion flow. Refactoring it wholesale risks
//     breaking working features in production.
//   - This script handles the *Moment 1* UX from
//     atlas.ai/docs/promptly-atlas-experience.md § 4 — fast, local,
//     pre-LLM PII redaction with a coaching tooltip.
//   - It dispatches input events on redaction, so when content.js's
//     listeners fire, they see the already-redacted text and the
//     existing suggestion flow continues normally.
//
// Architecture:
//
//   user types
//     → input event
//     → content-prescan.js (THIS FILE) runs PromptShieldsPIIDetector
//     → if PII found, show Moment 1 tooltip
//         → user clicks Redact: writeText(target, redacted) +
//           dispatch input event
//             → content.js listener sees clean text, runs the legacy
//               LLM-suggestion flow on it
//         → user clicks Keep as-is: prescan remembers the dismissed
//           text-hash, falls through to content.js as if no PII was
//           detected
//
// Dependencies (loaded ahead of this file via manifest.json):
//   lib/pii-detector.js          → window.PromptShieldsPIIDetector
//   lib/redaction-tooltip.js     → window.PromptShieldsRedactionTooltip   (legacy fallback)
//   lib/violation-reporter.js    → window.PromptShieldsViolationReporter
//   lib/issue-sidebar.js         → window.PromptShieldsIssueSidebar       (v1.6 Grammarly-style)
//   lib/injection-detector.js    → window.PromptShieldsInjectionDetector  (optional)
//   lib/custom-rules.js          → window.PromptShieldsCustomRules        (optional)
//   lib/file-guard.js            → window.PromptShieldsFileGuard          (optional)
//
// v1.5 → v1.6: Switched the primary surface from the modal-ish
// redaction tooltip to the Grammarly-style sidebar (persistent shield
// at input corner, slide-in panel listing every issue, per-issue
// Apply/Ignore, Apply-all keyboard shortcut, Undo toast). The legacy
// tooltip module is still loaded as a fallback for headless AI sites
// where the sidebar can't render.

(function () {
  'use strict'

  // Safari WebExtensions polyfill
  if (typeof browser === 'undefined') {
    window.browser = chrome
  }

  var Detector = window.PromptShieldsPIIDetector
  var Tooltip = window.PromptShieldsRedactionTooltip
  var Reporter = window.PromptShieldsViolationReporter
  var Sidebar = window.PromptShieldsIssueSidebar
  var Injection = window.PromptShieldsInjectionDetector
  var CustomRules = window.PromptShieldsCustomRules
  var FileGuard = window.PromptShieldsFileGuard

  if (!Detector || !Reporter || !Sidebar) {
    console.warn('[PromptShields prescan] core modules missing; prescan disabled.')
    return
  }

  // ─── Configuration ───────────────────────────────────────────────

  var atlasConfig = {
    endpoint: null,        // legacy: https://atlas-ai.com/api/v1/policies/violations
    telemetryUrl: null,    // cutover: https://atlas-ai.com/api/v1/telemetry/prompt-events
    apiKey: null,
    enforcementMode: 'guideline', // 'guideline' (log+coach) | 'strict'
    appealUrl: null,
    clientVersion: '1.4',
    injectionDetection: true,     // prompt-injection + hidden-text detector
    customRules: [],              // org-defined confidential terms (custom-rules.js)
    fileGuard: { enabled: true }, // upload guard policy (file-guard.js)
    telemetryDisabled: false      // true = nothing leaves the device
  }

  var compiledRules = []
  var fileGuardPolicy = FileGuard ? FileGuard.normalizePolicy(atlasConfig.fileGuard) : null

  function applyConfig (cfg) {
    if (!cfg || typeof cfg !== 'object') return
    Object.assign(atlasConfig, cfg)
    compiledRules = CustomRules ? CustomRules.compile(atlasConfig.customRules) : []
    if (FileGuard) fileGuardPolicy = FileGuard.normalizePolicy(atlasConfig.fileGuard)
    // Re-scan the active input under the new policy: config can land after
    // the user started typing (service-worker cold start), or change mid-
    // session when IT pushes a new managed policy.
    lastSeenText = ''
    if (lastTarget) evaluate(lastTarget)
  }

  function telemetryEnabled () {
    return !atlasConfig.telemetryDisabled && !!(atlasConfig.telemetryUrl && atlasConfig.apiKey)
  }

  // Every detector, layered: org rules and injection hits are more specific
  // than generic PII, so they claim overlapping ranges first ("Project
  // Falcon" is a confidential term, not a person name).
  function scan (text) {
    var specific = []
    if (Injection && atlasConfig.injectionDetection !== false) {
      specific = Injection.findMatches(text)
    }
    if (CustomRules && compiledRules.length) {
      specific = CustomRules.merge(specific, CustomRules.findMatches(text, compiledRules))
    }
    var pii = Detector.findMatches(text)
    if (specific.length === 0) return pii
    return CustomRules ? CustomRules.merge(specific, pii) : specific.concat(pii)
  }

  var DEBOUNCE_MS = 30
  var pendingTimer = null
  var lastTarget = null
  var lastSeenText = ''
  var dismissed = new Set() // hashes of text the user said "Keep as-is" on
  var redactedPrompts = new WeakSet() // inputs a redaction was applied to (Safari ≥15.4 has WeakSet)

  // ─── Helpers ─────────────────────────────────────────────────────

  function getEditable (event) {
    var t = event && event.target
    if (!t) return null
    if (t.tagName === 'TEXTAREA') return t
    // Text-like inputs only: a file input's value is "C:\fakepath\…", and
    // password fields must never be echoed into the sidebar excerpt.
    if (t.tagName === 'INPUT') return TEXT_INPUT_TYPES[String(t.type || 'text').toLowerCase()] ? t : null
    if (t.isContentEditable) return t
    return null
  }

  var TEXT_INPUT_TYPES = { text: true, search: true, email: true, url: true, tel: true }

  function readText (target) {
    if (!target) return ''
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return target.value || ''
    return target.textContent || ''
  }

  function writeText (target, value) {
    if (!target) return
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      target.value = value
      target.dispatchEvent(new Event('input', { bubbles: true }))
      target.dispatchEvent(new Event('change', { bubbles: true }))
    } else {
      target.textContent = value
      target.dispatchEvent(new InputEvent('input', { bubbles: true }))
    }
  }

  function quickHash (s) {
    var h = 0
    for (var i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0
    }
    return h.toString(36)
  }

  function severityFor (byCategory, matches) {
    if (matches && matches.some(function (m) { return m.severity === 'high' })) return 'high'
    if (byCategory.promptInjection || byCategory.hiddenText) return 'high'
    if (byCategory.confidentialFile || byCategory.confidentialTerm) return 'high'
    if (byCategory.apiKey || byCategory.jwt || byCategory.creditCard) return 'high'
    if (byCategory.ssn || byCategory.iban || byCategory.bitcoinAddress) return 'high'
    if (byCategory.email || byCategory.phone || byCategory.ipAddress) return 'medium'
    return 'low'
  }

  // ─── Pipeline ────────────────────────────────────────────────────
  //
  // 1. Detector runs on every keystroke (debounced 30ms).
  // 2. Sidebar.update() refreshes the persistent shield + (if open)
  //    the sidebar body.
  // 3. User clicks the shield to open the sidebar; per-issue Apply
  //    or Apply-all rebuilds the redacted string from a chosen subset.
  // 4. Strict mode bypasses the sidebar — silent redact + Undo toast.

  function evaluate (target) {
    if (!target) return
    var text = readText(target)
    if (text === lastSeenText) return
    lastSeenText = text

    var t0 = performance.now()
    var matches = scan(text)
    var ms = performance.now() - t0
    if (ms > 50) {
      console.debug('[PromptShields prescan] detection took ' + ms.toFixed(1) + 'ms on ' + text.length + ' chars')
    }

    if (matches.length === 0) {
      Sidebar.hide()
      if (Tooltip) Tooltip.hide()
      return
    }

    if (dismissed.has(quickHash(text))) {
      // User chose "Ignore all" on this exact text. Don't re-prompt;
      // legacy content.js flow can take over.
      Sidebar.hide()
      return
    }

    var mode = atlasConfig.enforcementMode === 'strict' ? 'strict' : 'guideline'

    if (mode === 'strict') {
      var snapshot = { target: target, originalText: text }
      var result = Detector.redact(text, matches)
      writeText(target, result.redacted)
      redactedPrompts.add(target)
      Sidebar.setUndoSnapshot(snapshot)
      Sidebar.notifyApplied(matches.length)
      reportViolation(text, matches, 'redacted')
      return
    }

    Sidebar.update(target, matches, {
      mode: 'guideline',
      appealUrl: atlasConfig.appealUrl,
      onResult: function (action) {
        if (action.kind === 'apply') {
          applySubset(target, text, matches, action.indexes)
        } else if (action.kind === 'ignore') {
          reportViolation(text, matches, 'flagged', action.indexes)
        } else if (action.kind === 'ignore-all') {
          dismissed.add(quickHash(text))
          reportViolation(text, matches, 'flagged')
          Sidebar.close()
        } else if (action.kind === 'undo-toast') {
          var snap = Sidebar.getUndoSnapshot()
          if (snap && snap.target) {
            writeText(snap.target, snap.originalText)
            Sidebar.setUndoSnapshot(null)
          }
        }
      }
    })
  }

  // Apply a subset of matches by index. Rebuilds the redacted string
  // in one pass over the original; leaves untouched matches in place.
  function applySubset (target, originalText, matches, indexes) {
    if (!indexes || indexes.length === 0) return
    var indexSet = new Set(indexes)
    var picked = matches.filter(function (_, i) { return indexSet.has(i) })

    var out = ''
    var cursor = 0
    var byCategory = {}
    for (var i = 0; i < picked.length; i++) {
      var m = picked[i]
      out += originalText.slice(cursor, m.start)
      out += m.redaction
      cursor = m.end
      byCategory[m.category] = (byCategory[m.category] || 0) + 1
    }
    out += originalText.slice(cursor)

    writeText(target, out)
    redactedPrompts.add(target)
    Sidebar.setUndoSnapshot({ target: target, originalText: originalText })
    Sidebar.notifyApplied(picked.length)
    reportViolationSubset(originalText, picked, byCategory, 'redacted')

    lastSeenText = '' // force re-scan
    evaluate(target)
  }

  function reportViolationSubset (originalText, picked, byCategory, actionTaken) {
    sendViolation(originalText, picked, byCategory, actionTaken)
  }

  function reportViolation (originalText, matches, actionTaken, onlyIndexes) {
    var subset = matches
    if (onlyIndexes && onlyIndexes.length) {
      var idxSet = new Set(onlyIndexes)
      subset = matches.filter(function (_, i) { return idxSet.has(i) })
    }
    var byCategory = {}
    for (var i = 0; i < subset.length; i++) {
      var c = subset[i].category
      byCategory[c] = (byCategory[c] || 0) + 1
    }
    sendViolation(originalText, subset, byCategory, actionTaken)
  }

  // Cutover: when atlas.telemetryUrl is configured, violations go ONLY
  // to the unified telemetry endpoint (X-API-Key, batch wire format).
  // Otherwise the legacy /api/v1/policies/violations path runs unchanged.
  function sendViolation (originalText, subset, byCategory, actionTaken) {
    if (telemetryEnabled()) {
      Reporter.reportPromptEvent({
        telemetryUrl: atlasConfig.telemetryUrl,
        apiKey: atlasConfig.apiKey,
        prompt: originalText,
        eventKind: 'violation',
        actionTaken: actionTaken,
        severity: severityFor(byCategory, subset),
        byCategory: byCategory
      }).catch(function () { /* swallow — reporter queues offline */ })
      return
    }
    if (atlasConfig.telemetryDisabled || !atlasConfig.endpoint || !atlasConfig.apiKey) return
    Reporter.report({
      endpoint: atlasConfig.endpoint,
      apiKey: atlasConfig.apiKey,
      prompt: originalText,
      actionTaken: actionTaken,
      severity: severityFor(byCategory, subset),
      matches: subset,
      byCategory: byCategory,
      detectorId: 'pii-detector-v1',
      clientKind: 'safari-extension',
      clientVersion: atlasConfig.clientVersion
    }).catch(function () { /* swallow — reporter queues offline */ })
  }

  // PRO-15: activity events. Enter (without Shift) is the submit signal
  // on the supported chat UIs; capture phase runs before the site clears
  // the input. Clean text → 'allowed'; clean-after-redaction → 'redacted';
  // outstanding PII → no activity event (the violation path owns it).
  // Events are queued and ride the background's 5-minute flush alarm,
  // where identical (app_id, action) pairs coalesce via `occurrences`.
  function recordSubmission (target) {
    if (!telemetryEnabled()) return
    var text = readText(target)
    if (!text || !text.trim()) return
    var matches = scan(text)
    var wasRedacted = redactedPrompts.has(target)
    var action = Reporter.classifySubmission(matches.length, wasRedacted)
    if (!action) return
    redactedPrompts.delete(target)
    Reporter.enqueueActivity({
      telemetryUrl: atlasConfig.telemetryUrl,
      apiKey: atlasConfig.apiKey,
      prompt: text,
      actionTaken: action
    }).catch(function () { /* fail-open */ })
  }

  // ─── Wiring ──────────────────────────────────────────────────────

  function onInput (event) {
    var target = getEditable(event)
    if (!target) return
    lastTarget = target
    if (pendingTimer) clearTimeout(pendingTimer)
    pendingTimer = setTimeout(function () { evaluate(target) }, DEBOUNCE_MS)
  }

  function onWindowResize () {
    if (Tooltip && Tooltip.reposition) Tooltip.reposition()
    if (Sidebar && Sidebar.reposition) Sidebar.reposition()
  }

  // Use capture phase so we run before the legacy content.js listeners
  // (which use bubble phase). Critical for the Moment 1 latency budget
  // — we need to redact before the suggestion flow fetches anything.
  document.addEventListener('input', onInput, true)
  document.addEventListener('paste', function (e) {
    var t = getEditable(e)
    if (!t) return
    lastTarget = t
    setTimeout(function () { evaluate(t) }, 0)
  }, true)
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.isComposing || e.repeat) return
    var t = getEditable(e) || lastTarget
    if (!t) return
    if (e.metaKey || e.ctrlKey) evaluate(t) // existing pre-submit re-scan
    if (e.shiftKey) return                  // newline, not a submission
    recordSubmission(t)
  }, true)
  window.addEventListener('resize', onWindowResize, true)

  // Upload guard: confidential file names + hidden instructions in text
  // files. Reports only the hashed file name and category counts.
  if (FileGuard) {
    FileGuard.install({
      getPolicy: function () { return fileGuardPolicy },
      getMode: function () { return atlasConfig.enforcementMode === 'strict' ? 'strict' : 'guideline' },
      getAppealUrl: function () { return atlasConfig.appealUrl },
      scan: scan,
      onDecision: function (d) {
        sendViolation(d.fileName || '', [], d.byCategory, d.actionTaken)
      }
    })
  }
  window.addEventListener('scroll', onWindowResize, { passive: true, capture: true })

  // ─── Comms with background script ────────────────────────────────
  //
  // Safari background scripts (not service workers) manage the policy
  // bundle. Same message contract as Chrome.

  if (browser && browser.runtime && browser.runtime.onMessage) {
    browser.runtime.onMessage.addListener(function (msg, _sender, sendResponse) {
      if (!msg || !msg.type) return false
      if (msg.type === 'configUpdate') {
        if (msg.config) applyConfig(msg.config)
        sendResponse && sendResponse({ ok: true })
      } else if (msg.type === 'policyUpdate') {
        if (Tooltip && Tooltip.resetSuppression) Tooltip.resetSuppression()
        if (Sidebar && Sidebar.resetSuppression) Sidebar.resetSuppression()
        sendResponse && sendResponse({ ok: true })
      } else if (msg.type === 'flushQueue') {
        if (telemetryEnabled()) {
          // Cutover: drains the telemetry queue AND migrates any
          // pre-cutover legacy-queue leftovers through the new endpoint.
          Reporter.flushTelemetryQueue(atlasConfig.telemetryUrl, atlasConfig.apiKey).then(function (n) {
            sendResponse && sendResponse({ ok: true, flushed: n })
          })
          return true
        }
        if (!atlasConfig.telemetryDisabled && atlasConfig.endpoint && atlasConfig.apiKey) {
          Reporter.flushQueue(atlasConfig.endpoint, atlasConfig.apiKey).then(function (n) {
            sendResponse && sendResponse({ ok: true, flushed: n })
          })
          return true
        }
        sendResponse && sendResponse({ ok: false, reason: 'not configured' })
      }
      return false
    })

    // Hydrate config on load.
    try {
      browser.runtime.sendMessage({ type: 'getConfig' }, function (config) {
        if (config && typeof config === 'object') applyConfig(config)
      })
    } catch (e) { /* ignore — atlas not configured */ }
  }
})()
