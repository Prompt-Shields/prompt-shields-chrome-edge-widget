// Prompt-injection + hidden-text detector — runs fully on-device.
//
// Covers two attack paths that PII detection does not:
//
//   promptInjection — instruction-override phrasing ("ignore all previous
//     instructions", "reveal your system prompt", chat-template tokens).
//     Typed directly, or carried *indirectly* inside text the user pastes
//     from an email, web page or document and forwards to an AI tool.
//
//   hiddenText — characters a human cannot see but a model reads:
//     Unicode tag characters (U+E0000–U+E007F, "ASCII smuggling"),
//     zero-width runs, and bidi overrides. A pasted document that looks
//     harmless can carry a full hidden instruction this way.
//
// Same contract as pii-detector.js: findMatches(text) returns
//   [{ category, start, end, value, redaction, severity, detail? }, ...]
// so the issue sidebar and strict-mode redaction can treat these like
// any other finding. Never sends anything over the network.
//
// High-precision by design (unlike the PII detector): the phrase list is
// deliberately narrow, because a nudge users learn to ignore is worse
// than no nudge at all.

(function (root) {
  'use strict'

  var MAX_SCAN_LENGTH = 200000

  var INJECTION_REDACTION = '[REMOVED-INSTRUCTION]'

  var INJECTION_PATTERNS = [
    // "Ignore / disregard / forget all previous instructions"
    /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+|any\s+|the\s+|your\s+|of\s+)*(?:previous|prior|above|earlier|preceding|original|system)\s+(?:instructions?|prompts?|rules?|directions?|guidelines?|context)\b/gi,
    // "Reveal / print your system prompt"
    /\b(?:reveal|print|show|repeat|output|display|leak|dump)\s+(?:me\s+)?(?:your|the)\s+(?:full\s+|entire\s+|original\s+|hidden\s+)?(?:system\s+prompt|system\s+message|hidden\s+instructions|initial\s+instructions|developer\s+instructions)\b/gi,
    // Persona jailbreaks
    /\b(?:you\s+are\s+now|from\s+now\s+on\s+you\s+are|act\s+as|pretend\s+to\s+be)\s+(?:a\s+|an\s+)?(?:DAN\b|unrestricted|unfiltered|jailbroken|uncensored|in\s+developer\s+mode)/gi,
    // Concealment directives — typical of indirect injection in documents
    /\b(?:do\s+not|don't|never)\s+(?:tell|inform|alert|notify|mention\s+(?:this\s+)?to)\s+the\s+user\b/gi,
    // Raw chat-template / role tokens smuggled into content
    /<\|im_(?:start|end)\|>|\[\/?INST\]|<<\/?SYS>>|<\/?\s*system\s*>/gi
  ]

  // ─── Hidden characters ───────────────────────────────────────────

  // Unicode tag block — invisible, but decodes 1:1 to ASCII.
  var TAG_RE = /(?:\uDB40[\uDC00-\uDC7F])+/g
  // Bidi embedding / override / isolate controls ("Trojan Source").
  var BIDI_RE = /[‪-‮⁦-⁩]+/g
  // Zero-width characters. ZWJ / ZWNJ alone are legitimate (emoji
  // sequences, Persian, Indic scripts), so they only count inside a run
  // that also contains a "never legitimate mid-text" character, or as a
  // run of 3+ which is a common steganography carrier.
  var ZW_RE = /[​-‍⁠﻿]+/g

  function decodeTags (s) {
    var out = ''
    for (var i = 0; i + 1 < s.length; i += 2) {
      var cp = ((s.charCodeAt(i) - 0xD800) << 10) + (s.charCodeAt(i + 1) - 0xDC00) + 0x10000
      var ascii = cp - 0xE0000
      if (ascii >= 0x20 && ascii < 0x7F) out += String.fromCharCode(ascii)
    }
    return out
  }

  function suspiciousZeroWidth (run) {
    if (run.length >= 3) return true
    return /[​⁠﻿]/.test(run)
  }

  function hiddenMatches (text) {
    var hits = []
    var m

    TAG_RE.lastIndex = 0
    while ((m = TAG_RE.exec(text)) !== null) {
      var decoded = decodeTags(m[0])
      hits.push({
        category: 'hiddenText',
        start: m.index,
        end: m.index + m[0].length,
        value: m[0],
        redaction: '',
        severity: 'high',
        detail: decoded ? 'Hidden text: "' + decoded.slice(0, 200) + '"' : 'Invisible Unicode tag characters'
      })
    }

    BIDI_RE.lastIndex = 0
    while ((m = BIDI_RE.exec(text)) !== null) {
      hits.push({
        category: 'hiddenText',
        start: m.index,
        end: m.index + m[0].length,
        value: m[0],
        redaction: '',
        severity: 'high',
        detail: 'Bidirectional override characters can make text read differently to a model than to you'
      })
    }

    ZW_RE.lastIndex = 0
    while ((m = ZW_RE.exec(text)) !== null) {
      // A single BOM at the very start is an artefact of copying from a file.
      if (m.index === 0 && m[0] === '﻿') continue
      if (!suspiciousZeroWidth(m[0])) continue
      hits.push({
        category: 'hiddenText',
        start: m.index,
        end: m.index + m[0].length,
        value: m[0],
        redaction: '',
        severity: 'high',
        detail: m[0].length + ' zero-width character' + (m[0].length === 1 ? '' : 's')
      })
    }

    return hits
  }

  function injectionMatches (text) {
    var hits = []
    for (var i = 0; i < INJECTION_PATTERNS.length; i++) {
      var re = INJECTION_PATTERNS[i]
      re.lastIndex = 0
      var m
      while ((m = re.exec(text)) !== null) {
        if (m[0].length === 0) { re.lastIndex++; continue }
        hits.push({
          category: 'promptInjection',
          start: m.index,
          end: m.index + m[0].length,
          value: m[0],
          redaction: INJECTION_REDACTION,
          severity: 'high'
        })
      }
    }
    return hits
  }

  // Drop later hits that overlap an earlier-kept one, then sort by start.
  function dedupe (hits) {
    var kept = []
    for (var i = 0; i < hits.length; i++) {
      var h = hits[i]
      var overlaps = false
      for (var j = 0; j < kept.length; j++) {
        if (h.start < kept[j].end && h.end > kept[j].start) { overlaps = true; break }
      }
      if (!overlaps) kept.push(h)
    }
    kept.sort(function (a, b) { return a.start - b.start })
    return kept
  }

  /*
   * findMatches(text) — hidden-text hits first (they claim their ranges),
   * then instruction phrases. Returns [] for empty or oversized input.
   */
  function findMatches (text) {
    if (!text || typeof text !== 'string') return []
    if (text.length > MAX_SCAN_LENGTH) return []
    return dedupe(hiddenMatches(text).concat(injectionMatches(text)))
  }

  function containsInjection (text) {
    return findMatches(text).length > 0
  }

  root.PromptShieldsInjectionDetector = {
    findMatches: findMatches,
    containsInjection: containsInjection,
    decodeTags: decodeTags,
    MAX_SCAN_LENGTH: MAX_SCAN_LENGTH
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
