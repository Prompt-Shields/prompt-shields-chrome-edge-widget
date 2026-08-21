const { test } = require('node:test')
const assert = require('node:assert')

require('../pii-detector.js')
require('../chat-redactor.js')
const R = globalThis.PromptShieldsChatRedactor

const EMAIL = 'reach me at jane.doe@example.com'
// personName must sit mid-sentence: pii-detector suppresses a match at string
// start, so "Michael Johnson" only matches because it's preceded by "The analyst ".
const PROSE = 'The analyst Michael Johnson reviewed the Q3 plan.'

test('redactMessage uses full ruleset (redacts email)', () => {
  const out = R.redactMessage(EMAIL)
  assert.ok(!out.redacted.includes('jane.doe@example.com'))
  assert.strictEqual(out.byCategory.email, 1)
})

test('redactContext redacts structured identifiers (email)', () => {
  const out = R.redactContext('see jane.doe@example.com for details')
  assert.ok(!out.redacted.includes('jane.doe@example.com'))
})

test('redactContext does NOT apply personName (avoids prose false-positives)', () => {
  const out = R.redactContext(PROSE)
  assert.ok(out.redacted.includes('Michael Johnson'))
  assert.ok(!('personName' in out.byCategory))
})

test('redactMessage DOES apply personName', () => {
  const out = R.redactMessage(PROSE)
  assert.ok(!out.redacted.includes('Michael Johnson'))
})

test('mergeSummaries sums category counts', () => {
  const merged = R.mergeSummaries({ email: 1, phone: 2 }, { email: 3 })
  assert.deepStrictEqual(merged, { email: 4, phone: 2 })
  assert.strictEqual(R.totalCount(merged), 6)
})
