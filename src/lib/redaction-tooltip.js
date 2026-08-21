// Redaction tooltip — Moment 1 UX, per the Promptly + atlas
// experience spec (atlas.ai/docs/promptly-atlas-experience.md § 4).
//
// Customer-feedback-driven design rules:
//   1. Tooltip wording leads with WHAT was caught, then WHY it was
//      redacted, then a coaching tip. Never blames the user.
//   2. Frequency suppression: after 5 detections per category, fall
//      back to a tiny status icon (UX-2). User can still click to
//      see details.
//   3. Latency target: <50ms p95 from keystroke → on-screen
//      redaction. This module renders synchronously.
//   4. Dismissable but default-shown. Keyboard-friendly (ESC to
//      dismiss).
//   5. Accent colour follows the policy mode:
//        Guideline (log/coach) → blue (informational)
//        Strict (block/redact) → amber (action taken)
//
// Shipped as a global `PromptShieldsRedactionTooltip` so it works
// in content-script context without a build step.

(function (root) {
  'use strict'

  // ─── Category copy ───────────────────────────────────────────────
  //
  // The wording for each detector. Top-level keys = `category` from
  // PIIDetector. `noun` is what the tooltip says was caught; `tip` is
  // the coaching nudge. Customer-facing strings only — keep short.

  var COPY = {
    email: {
      noun: 'an email address',
      tip: 'Use the contact\'s reference number or initials instead.'
    },
    phone: {
      noun: 'a phone number',
      tip: 'AI tools log every prompt — drop the number and refer to "the contact".'
    },
    creditCard: {
      noun: 'a credit-card number',
      tip: 'Cardholder data should never reach a third-party AI tool.'
    },
    ssn: {
      noun: 'a US SSN',
      tip: 'Use the customer\'s anonymised reference instead of their SSN.'
    },
    apiKey: {
      noun: 'an API key',
      tip: 'Rotate this key now — assume it\'s exposed.'
    },
    jwt: {
      noun: 'a JWT token',
      tip: 'Tokens leak the holder\'s identity. Refer to the user by role.'
    },
    iban: {
      noun: 'an IBAN',
      tip: 'Bank account identifiers don\'t belong in an AI prompt.'
    },
    bitcoinAddress: {
      noun: 'a Bitcoin address',
      tip: 'Wallet identifiers are linkable to real-world identity.'
    },
    ipAddress: {
      noun: 'an IP address',
      tip: 'IPs can identify your network. Use a generic placeholder.'
    },
    currency: {
      noun: 'a monetary amount',
      tip: 'Confidential financial figures shouldn\'t reach external AI.'
    },
    personName: {
      noun: 'a person\'s name',
      tip: 'Use a role or reference number instead of a real name.'
    }
  }

  // ─── Suppression state (UX-2) ────────────────────────────────────
  //
  // Per-category counter. After SUPPRESS_AFTER detections in this
  // session, the tooltip collapses to a tiny status icon. Reset on
  // policy update (caller invokes resetSuppression()).

  var SUPPRESS_AFTER = 5
  var detectionCounts = Object.create(null)

  function shouldSuppress (categories) {
    for (var i = 0; i < categories.length; i++) {
      if ((detectionCounts[categories[i]] || 0) < SUPPRESS_AFTER) return false
    }
    return true
  }

  function recordDetection (categories) {
    for (var i = 0; i < categories.length; i++) {
      detectionCounts[categories[i]] = (detectionCounts[categories[i]] || 0) + 1
    }
  }

  function resetSuppression () {
    detectionCounts = Object.create(null)
  }

  // ─── DOM ─────────────────────────────────────────────────────────

  var tooltipEl = null
  var statusIconEl = null
  var lastTarget = null
  var onAction = null // { redact, dismiss, appeal }

  function el (tag, className, text) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (text != null) n.textContent = text
    return n
  }

  function buildTooltip (matches, mode, ctx) {
    // Group matches by category for the summary line.
    var byCat = {}
    for (var i = 0; i < matches.length; i++) {
      var c = matches[i].category
      byCat[c] = (byCat[c] || 0) + 1
    }
    var categoriesHit = Object.keys(byCat)
    var primary = categoriesHit[0]
    var summary = COPY[primary] ? COPY[primary] : { noun: 'sensitive data', tip: '' }

    var box = el('div', 'ps-tooltip ps-tooltip--' + (mode === 'strict' ? 'strict' : 'guideline'))
    box.setAttribute('role', 'alertdialog')
    box.setAttribute('aria-label', 'Prompt Shields detected sensitive data')

    // Header
    var header = el('div', 'ps-tooltip__header')
    var dot = el('span', 'ps-tooltip__dot')
    var title = el('span', 'ps-tooltip__title',
      mode === 'strict' ? 'Atlas redacted ' + summary.noun : 'Atlas detected ' + summary.noun)
    var dismiss = el('button', 'ps-tooltip__dismiss', '×')
    dismiss.setAttribute('aria-label', 'Dismiss')
    dismiss.addEventListener('click', function () { close('dismiss') })
    header.appendChild(dot)
    header.appendChild(title)
    header.appendChild(dismiss)

    // Body
    var body = el('div', 'ps-tooltip__body')
    if (matches.length > 1) {
      var detailLine = el('div', 'ps-tooltip__detail',
        matches.length + ' items detected · ' + categoriesHit.join(', '))
      body.appendChild(detailLine)
    }
    if (summary.tip) {
      var tip = el('div', 'ps-tooltip__tip', 'Tip: ' + summary.tip)
      body.appendChild(tip)
    }

    // Actions (Guideline mode only — Strict has already redacted)
    if (mode !== 'strict') {
      var actions = el('div', 'ps-tooltip__actions')
      var redactBtn = el('button', 'ps-tooltip__btn ps-tooltip__btn--primary', 'Redact')
      redactBtn.addEventListener('click', function () { close('redact') })
      var keepBtn = el('button', 'ps-tooltip__btn', 'Keep as-is')
      keepBtn.addEventListener('click', function () { close('dismiss') })
      actions.appendChild(redactBtn)
      actions.appendChild(keepBtn)
      body.appendChild(actions)
    }

    // Appeal link (always available — safety valve per Moment 1 spec)
    if (ctx && ctx.appealUrl) {
      var appeal = el('a', 'ps-tooltip__appeal', 'Appeal')
      appeal.href = ctx.appealUrl
      appeal.target = '_blank'
      appeal.rel = 'noopener'
      body.appendChild(appeal)
    }

    box.appendChild(header)
    box.appendChild(body)
    return box
  }

  function buildStatusIcon () {
    var icon = el('div', 'ps-status-icon')
    icon.setAttribute('aria-label', 'Prompt Shields active')
    icon.setAttribute('role', 'button')
    icon.setAttribute('tabindex', '0')
    icon.addEventListener('click', function () { resetSuppression(); close('icon-click') })
    return icon
  }

  function position (anchor, node) {
    var rect = anchor.getBoundingClientRect()
    node.style.position = 'absolute'
    node.style.zIndex = '2147483647' // top of stack
    node.style.maxWidth = Math.max(rect.width, 320) + 'px'
    document.body.appendChild(node)
    var nodeRect = node.getBoundingClientRect()
    var top = window.scrollY + rect.top - nodeRect.height - 10
    if (top < 8) top = window.scrollY + rect.bottom + 10
    node.style.top = top + 'px'
    node.style.left = (window.scrollX + rect.left) + 'px'
  }

  function close (reason) {
    if (tooltipEl) { tooltipEl.remove(); tooltipEl = null }
    if (statusIconEl) { statusIconEl.remove(); statusIconEl = null }
    if (onAction) {
      var fn = onAction
      onAction = null
      fn(reason)
    }
  }

  function onKeydown (e) {
    if (e.key === 'Escape' && (tooltipEl || statusIconEl)) close('escape')
  }

  // ─── Public API ──────────────────────────────────────────────────

  /*
   * show(target, matches, opts)
   *
   * target  — input/textarea/contenteditable element the user typed in
   * matches — output of PromptShieldsPIIDetector.findMatches()
   * opts    — {
   *     mode: 'guideline' | 'strict',  // default 'guideline'
   *     appealUrl: string,             // optional; renders an Appeal link
   *     onResult: (action) => void     // 'redact' | 'dismiss' | 'icon-click' | 'escape'
   *   }
   */
  function show (target, matches, opts) {
    opts = opts || {}
    var mode = opts.mode === 'strict' ? 'strict' : 'guideline'
    var categoriesHit = matches.map(function (m) { return m.category })

    close('replaced') // any prior surface
    onAction = opts.onResult || null
    lastTarget = target

    if (shouldSuppress(categoriesHit)) {
      statusIconEl = buildStatusIcon()
      position(target, statusIconEl)
    } else {
      tooltipEl = buildTooltip(matches, mode, { appealUrl: opts.appealUrl })
      position(target, tooltipEl)
    }
    recordDetection(categoriesHit)

    document.addEventListener('keydown', onKeydown)
  }

  function hide () { close('manual-hide') }

  function reposition () {
    if (lastTarget && tooltipEl) position(lastTarget, tooltipEl)
    if (lastTarget && statusIconEl) position(lastTarget, statusIconEl)
  }

  // ─── Export ──────────────────────────────────────────────────────

  root.PromptShieldsRedactionTooltip = {
    show: show,
    hide: hide,
    reposition: reposition,
    resetSuppression: resetSuppression,
    SUPPRESS_AFTER: SUPPRESS_AFTER
  }
})(typeof window !== 'undefined' ? window : globalThis)
