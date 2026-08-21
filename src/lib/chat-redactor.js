// Redaction policy for chat: full ruleset on the user's message, a reduced
// ruleset (structured identifiers only, no personName) on page context to
// avoid masking ordinary capitalised words in prose.
(function (root) {
  'use strict'

  function detector () { return root.PromptShieldsPIIDetector }

  function redactWith (text, allowed) {
    if (!text || typeof text !== 'string') return { redacted: text || '', byCategory: {} }
    var d = detector()
    var matches = d.findMatches(text)
    if (allowed) {
      matches = matches.filter(function (m) { return allowed.indexOf(m.category) !== -1 })
    }
    var res = d.redact(text, matches)
    return { redacted: res.redacted, byCategory: res.byCategory }
  }

  function redactMessage (text) {
    return redactWith(text, null) // null = all categories
  }

  // Memoized: redactContext is called on every keystroke by the panel's
  // redaction-preview chip, so the allowed-category list is computed once.
  var contextAllowed = null
  function redactContext (text) {
    if (!contextAllowed) {
      contextAllowed = detector().categories().filter(function (c) { return c !== 'personName' })
    }
    return redactWith(text, contextAllowed)
  }

  function mergeSummaries (a, b) {
    var out = {}
    ;[a, b].forEach(function (m) {
      if (!m) return
      Object.keys(m).forEach(function (k) { out[k] = (out[k] || 0) + m[k] })
    })
    return out
  }

  function totalCount (summary) {
    if (!summary) return 0
    return Object.keys(summary).reduce(function (n, k) { return n + summary[k] }, 0)
  }

  root.PromptShieldsChatRedactor = {
    redactMessage: redactMessage,
    redactContext: redactContext,
    mergeSummaries: mergeSummaries,
    totalCount: totalCount
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
