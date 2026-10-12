// Organisation-defined confidential-term rules — lightweight DLP that
// works without any upstream data labelling (Purview / MIP / DSPM).
//
// An admin lists what "confidential" means for *their* organisation —
// project code names, client names, internal document-ID formats,
// classification markings — and the extension flags those terms in a
// prompt exactly like built-in PII. Rules arrive via managed policy
// (Intune / GPO, see docs/ENTERPRISE_DEPLOYMENT.md) or setAtlasConfig.
//
// Rule shape (also documented in src/managed_schema.json):
//   {
//     id:            string   — stable identifier, used in telemetry
//     label:         string   — shown to the user ("Project Falcon")
//     pattern:       string   — literal term, or a regex when regex=true
//     regex?:        boolean  — default false (literal, word-bounded)
//     caseSensitive?: boolean — default false
//     severity?:     'low' | 'medium' | 'high'   — default 'high'
//     tip?:          string   — coaching copy shown in the sidebar
//     redaction?:    string   — replacement text, default [REDACTED-<ID>]
//   }
//
// Invalid rules are dropped individually (never throw) so one typo in a
// policy file cannot disable every other rule on the fleet.

(function (root) {
  'use strict'

  var MAX_RULES = 200
  var MAX_PATTERN_LENGTH = 500
  var MAX_SCAN_LENGTH = 200000
  var MAX_MATCHES_PER_RULE = 100
  var SEVERITIES = { low: true, medium: true, high: true }

  function escapeRegex (s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  function sanitizeId (id, fallback) {
    var s = String(id || fallback).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
    return s || fallback
  }

  /*
   * compile(rules) → [{ id, label, tip, severity, redaction, re }]
   * Accepts anything; returns only the rules that are well-formed.
   */
  function compile (rules) {
    if (!Array.isArray(rules)) return []
    var out = []
    for (var i = 0; i < rules.length && out.length < MAX_RULES; i++) {
      var r = rules[i]
      if (!r || typeof r.pattern !== 'string') continue
      var pattern = r.pattern.trim()
      if (!pattern || pattern.length > MAX_PATTERN_LENGTH) continue

      var source = r.regex === true
        ? pattern
        // Literal terms are word-bounded where the term starts/ends with a
        // word character, so "ACME" does not fire inside "ACMEX".
        : (/^\w/.test(pattern) ? '\\b' : '') + escapeRegex(pattern) + (/\w$/.test(pattern) ? '\\b' : '')

      var re
      try {
        re = new RegExp(source, r.caseSensitive === true ? 'g' : 'gi')
      } catch (e) {
        continue
      }
      // A rule that matches the empty string would flag every position.
      if (re.test('')) continue

      var id = sanitizeId(r.id, 'rule' + i)
      out.push({
        id: id,
        label: typeof r.label === 'string' && r.label ? r.label.slice(0, 80) : 'Confidential term',
        tip: typeof r.tip === 'string' && r.tip ? r.tip.slice(0, 300) : null,
        severity: SEVERITIES[r.severity] ? r.severity : 'high',
        redaction: typeof r.redaction === 'string' ? r.redaction.slice(0, 80) : '[REDACTED-' + id.toUpperCase() + ']',
        re: re
      })
    }
    return out
  }

  /*
   * findMatches(text, compiled) → [{ category: 'confidentialTerm', start,
   * end, value, redaction, severity, ruleId, label, tip }]
   * Overlapping hits keep the earliest rule (policy order = priority).
   */
  function findMatches (text, compiled) {
    if (!text || typeof text !== 'string' || !compiled || compiled.length === 0) return []
    if (text.length > MAX_SCAN_LENGTH) return []

    var hits = []
    for (var i = 0; i < compiled.length; i++) {
      var rule = compiled[i]
      rule.re.lastIndex = 0
      var m
      var n = 0
      while ((m = rule.re.exec(text)) !== null && n < MAX_MATCHES_PER_RULE) {
        if (m[0].length === 0) { rule.re.lastIndex++; continue }
        var start = m.index
        var end = start + m[0].length
        var overlaps = false
        for (var j = 0; j < hits.length; j++) {
          if (start < hits[j].end && end > hits[j].start) { overlaps = true; break }
        }
        if (!overlaps) {
          hits.push({
            category: 'confidentialTerm',
            start: start,
            end: end,
            value: m[0],
            redaction: rule.redaction,
            severity: rule.severity,
            ruleId: rule.id,
            label: rule.label,
            tip: rule.tip
          })
          n++
        }
      }
    }
    hits.sort(function (a, b) { return a.start - b.start })
    return hits
  }

  /*
   * merge(primary, secondary) — union of two match lists where a
   * secondary hit is dropped if it overlaps any primary hit. Used to
   * layer custom rules / injection hits on top of the PII detector.
   */
  function merge (primary, secondary) {
    if (!secondary || secondary.length === 0) return primary.slice()
    var out = primary.slice()
    for (var i = 0; i < secondary.length; i++) {
      var s = secondary[i]
      var overlaps = false
      for (var j = 0; j < out.length; j++) {
        if (s.start < out[j].end && s.end > out[j].start) { overlaps = true; break }
      }
      if (!overlaps) out.push(s)
    }
    out.sort(function (a, b) { return a.start - b.start })
    return out
  }

  root.PromptShieldsCustomRules = {
    compile: compile,
    findMatches: findMatches,
    merge: merge,
    MAX_RULES: MAX_RULES
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
