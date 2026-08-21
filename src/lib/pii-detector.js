// PII detector — JS port of the macOS Swift PIIDetector.swift.
// Pinned 1:1 against the macOS implementation so detection decisions
// agree across endpoints. Source of truth for the rules:
// prompt-shields-macos-widget/PromptShields.MacOS.Widget/Managers/Accessibility/PIIDetector.swift
//
// Design intent (from the Swift source):
// - Runs on every keystroke, well within the AXObserver / DOM-observer
//   debounce budget (<50ms p95 — the Moment 1 latency target).
// - Never sends anything over the network.
// - High-recall, medium-precision: false positives are acceptable
//   because the user can dismiss; false negatives defeat the pitch.
// - Category names align with the macOS detector + the policy_evaluator.py
//   PII categories so atlas analytics can correlate cross-platform.
//
// Categories supported (in evaluation order — order matters because
// earlier rules win on overlapping matches):
//   email · bitcoinAddress · jwt · apiKey · iban · ipAddress ·
//   creditCard (Luhn-validated) · ssn · phone (digit-count validated) ·
//   currency · personName (common-bigram filtered)
//
// Shipped as a global `PromptShieldsPIIDetector` so it works in
// content-script context (no module system in MV3 without a build step).

(function (root) {
  'use strict'

  var MAX_SCAN_LENGTH = 50000 // bail on huge pastes

  // ─── Validators ──────────────────────────────────────────────────

  function stripSeparators (s) {
    return s.replace(/\D/g, '')
  }

  // Luhn check — same algorithm as macOS PIIDetector.swift `luhnValid`.
  function luhnValid (digits) {
    if (digits.length < 13 || digits.length > 19) return false
    var sum = 0
    for (var i = 0; i < digits.length; i++) {
      var idx = digits.length - 1 - i
      var d = digits.charCodeAt(idx) - 48
      if (d < 0 || d > 9) return false
      if (i % 2 === 1) {
        var doubled = d * 2
        sum += doubled > 9 ? doubled - 9 : doubled
      } else {
        sum += d
      }
    }
    return sum % 10 === 0
  }

  function phoneValid (s) {
    var digits = s.replace(/\D/g, '')
    return digits.length >= 7 && digits.length <= 15
  }

  // Bigrams to suppress on the personName rule. Verbatim from
  // the Swift `commonBigrams` set.
  var COMMON_BIGRAMS = new Set([
    'united states', 'new york', 'san francisco', 'north america',
    'south america', 'hong kong', 'white house', 'wall street',
    'silicon valley', 'machine learning', 'artificial intelligence',
    'data science', 'customer service', 'product manager', 'project manager',
    'chief executive', 'best regards', 'kind regards', 'thank you',
    'lorem ipsum'
  ])

  // ─── Rules — order matters (first match wins on overlap) ─────────

  var RULES = [
    {
      category: 'email',
      regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
      validator: null,
      redaction: '[REDACTED-EMAIL]'
    },
    // Bitcoin (P2PKH/P2SH + bech32). Before generic digits.
    {
      category: 'bitcoinAddress',
      regex: /\b(?:[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-zA-HJ-NP-Z0-9]{25,62})\b/g,
      validator: null,
      redaction: '[REDACTED-BTC]'
    },
    // JWT tokens — three base64 groups.
    {
      category: 'jwt',
      regex: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\b/g,
      validator: null,
      redaction: '[REDACTED-JWT]'
    },
    // API-key-ish prefixes (OpenAI, Anthropic, Stripe, Google, AWS, GH, Slack).
    {
      category: 'apiKey',
      regex: /\b(?:sk-[a-zA-Z0-9_-]{20,}|sk_live_[a-zA-Z0-9]{20,}|pk_live_[a-zA-Z0-9]{20,}|AIza[0-9A-Za-z_-]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{20,}|xoxb-[0-9]+-[0-9]+-[A-Za-z0-9]+)\b/g,
      validator: null,
      redaction: '[REDACTED-APIKEY]'
    },
    // IBAN
    {
      category: 'iban',
      regex: /\b[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}\b/g,
      validator: null,
      redaction: '[REDACTED-IBAN]'
    },
    // IPv4 (octet-bounded).
    {
      category: 'ipAddress',
      regex: /\b(?:25[0-5]|2[0-4][0-9]|[01]?[0-9]{1,2})(?:\.(?:25[0-5]|2[0-4][0-9]|[01]?[0-9]{1,2})){3}\b/g,
      validator: null,
      redaction: '[REDACTED-IP]'
    },
    // Credit card — Luhn-validated.
    {
      category: 'creditCard',
      regex: /\b(?:\d[ -]?){13,19}\b/g,
      validator: function (s) { return luhnValid(stripSeparators(s)) },
      redaction: '[REDACTED-CARD]'
    },
    // US SSN style (3-2-4). Reused for similar national IDs.
    {
      category: 'ssn',
      regex: /\b\d{3}-\d{2}-\d{4}\b/g,
      validator: null,
      redaction: '[REDACTED-SSN]'
    },
    // Phone — E.164-ish + common spaced formats. Digit-count validated.
    {
      category: 'phone',
      regex: /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,5}/g,
      validator: phoneValid,
      redaction: '[REDACTED-PHONE]'
    },
    // Currency with explicit symbol/code — "€2.4M", "$45K", "NOK 12M".
    {
      category: 'currency',
      regex: /(?:[€£¥$]\s?\d[\d,.]*\s?(?:[KMBkmb]|thousand|million|billion)?|\b(?:USD|EUR|GBP|NOK|SEK|DKK|CHF|JPY|CNY|INR)\s?\d[\d,.]*\s?(?:[KMBkmb]|thousand|million|billion)?)\b/g,
      validator: null,
      redaction: '[REDACTED-AMOUNT]'
    },
    // Person-name soft signal. Last to run; common-bigram filter
    // catches "United States" etc.
    {
      category: 'personName',
      regex: /(?<![.!?]\s|^)\b[A-Z][a-z]{1,20}\s+[A-Z][a-z]{1,20}\b/g,
      validator: function (s) { return !COMMON_BIGRAMS.has(s.toLowerCase()) },
      redaction: '[REDACTED-NAME]'
    }
  ]

  // ─── Public API ──────────────────────────────────────────────────

  // Yes/no scan. Cheap pre-screen — short-circuits on first match.
  function containsPII (text) {
    return findMatches(text, { firstOnly: true }).length > 0
  }

  /*
   * Returns every detected match:
   *   [{ category, start, end, value, redaction }, ...]
   * Sorted by `start` ascending; later rules don't shadow earlier
   * ones (claimed-range deduplication).
   */
  function findMatches (text, opts) {
    opts = opts || {}
    var firstOnly = !!opts.firstOnly

    if (!text || typeof text !== 'string') return []
    if (text.length > MAX_SCAN_LENGTH) return []

    var hits = []
    var claimed = [] // [start, end] ranges already claimed by earlier rules

    function overlapsClaimed (start, end) {
      for (var i = 0; i < claimed.length; i++) {
        var cs = claimed[i][0]
        var ce = claimed[i][1]
        if (start < ce && end > cs) return true
      }
      return false
    }

    for (var ri = 0; ri < RULES.length; ri++) {
      var rule = RULES[ri]
      var iter = text.matchAll(rule.regex)
      var step = iter.next()
      while (!step.done) {
        var match = step.value
        var value = match[0]
        var start = match.index
        var end = start + value.length

        if (!overlapsClaimed(start, end) &&
            (!rule.validator || rule.validator(value))) {
          hits.push({
            category: rule.category,
            start: start,
            end: end,
            value: value,
            redaction: rule.redaction
          })
          claimed.push([start, end])

          if (firstOnly) return hits
        }

        step = iter.next()
      }
    }

    hits.sort(function (a, b) { return a.start - b.start })
    return hits
  }

  /*
   * Apply redactions to a string.
   * Returns { redacted, count, byCategory } where byCategory is a
   * map { category: count } useful for telemetry.
   */
  function redact (text, matches) {
    matches = matches || findMatches(text)
    if (matches.length === 0) {
      return { redacted: text, count: 0, byCategory: {} }
    }

    var byCategory = {}
    var out = ''
    var cursor = 0
    for (var i = 0; i < matches.length; i++) {
      var m = matches[i]
      out += text.slice(cursor, m.start)
      out += m.redaction
      cursor = m.end
      byCategory[m.category] = (byCategory[m.category] || 0) + 1
    }
    out += text.slice(cursor)
    return { redacted: out, count: matches.length, byCategory: byCategory }
  }

  // For tests: enumerate available categories.
  function categories () {
    return RULES.map(function (r) { return r.category })
  }

  // ─── Export ──────────────────────────────────────────────────────

  root.PromptShieldsPIIDetector = {
    containsPII: containsPII,
    findMatches: findMatches,
    redact: redact,
    categories: categories,
    MAX_SCAN_LENGTH: MAX_SCAN_LENGTH
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
