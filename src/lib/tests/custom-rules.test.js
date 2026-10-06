const { test } = require('node:test')
const assert = require('node:assert')

require('../custom-rules.js')
require('../pii-detector.js')
const R = globalThis.PromptShieldsCustomRules
const PII = globalThis.PromptShieldsPIIDetector

test('literal terms match case-insensitively on word boundaries', () => {
  const rules = R.compile([{ id: 'falcon', label: 'Project Falcon', pattern: 'Project Falcon' }])
  const hits = R.findMatches('Status of project falcon vs Project Falconer?', rules)
  assert.strictEqual(hits.length, 1)
  assert.strictEqual(hits[0].value, 'project falcon')
  assert.strictEqual(hits[0].category, 'confidentialTerm')
  assert.strictEqual(hits[0].label, 'Project Falcon')
  assert.strictEqual(hits[0].redaction, '[REDACTED-FALCON]')
  assert.strictEqual(hits[0].severity, 'high')
})

test('literal terms escape regex metacharacters', () => {
  const rules = R.compile([{ pattern: 'C++ (internal)' }])
  assert.strictEqual(R.findMatches('Our C++ (internal) SDK', rules).length, 1)
  assert.strictEqual(R.findMatches('Our C (internal) SDK', rules).length, 0)
})

test('regex rules match document-ID formats', () => {
  const rules = R.compile([{ id: 'docid', label: 'Contract ID', pattern: 'CTR-\\d{4}-\\d{3}', regex: true, caseSensitive: true }])
  const hits = R.findMatches('See CTR-2026-041 and ctr-2026-042', rules)
  assert.deepStrictEqual(hits.map((h) => h.value), ['CTR-2026-041'])
})

test('invalid, empty-matching and malformed rules are dropped individually', () => {
  const rules = R.compile([
    { pattern: '(' , regex: true },
    { pattern: 'a*', regex: true },
    { pattern: '' },
    null,
    { label: 'no pattern' },
    { pattern: 'x'.repeat(501) },
    { pattern: 'Atlas' }
  ])
  assert.strictEqual(rules.length, 1)
  assert.strictEqual(R.compile('not an array').length, 0)
})

test('unknown severity falls back to high; ids are sanitised', () => {
  const [r] = R.compile([{ id: 'bad id!<script>', pattern: 'x', severity: 'catastrophic' }])
  assert.strictEqual(r.severity, 'high')
  assert.strictEqual(r.id, 'badidscript')
})

test('merge lets custom rules claim ranges before the PII detector', () => {
  const text = 'Notes on Project Falcon for the board'
  const custom = R.findMatches(text, R.compile([{ pattern: 'Project Falcon' }]))
  const pii = PII.findMatches(text)
  assert.ok(pii.some((m) => m.category === 'personName'), 'PII detector alone sees a name')
  const merged = R.merge(custom, pii)
  assert.deepStrictEqual(merged.map((m) => m.category), ['confidentialTerm'])
})
