const { test } = require('node:test')
const assert = require('node:assert')

require('../page-extractor.js')
require('../pii-detector.js')
const X = globalThis.PromptShieldsPageExtractor
const PII = globalThis.PromptShieldsPIIDetector

test('cap truncates to MAX_CONTEXT_CHARS', () => {
  const long = 'a'.repeat(20000)
  assert.strictEqual(X.cap(long, X.MAX_CONTEXT_CHARS).length, X.MAX_CONTEXT_CHARS)
})

test('cap leaves short text untouched', () => {
  assert.strictEqual(X.cap('hello', X.MAX_CONTEXT_CHARS), 'hello')
})

test('context cap stays under pii-detector MAX_SCAN_LENGTH', () => {
  assert.ok(X.MAX_CONTEXT_CHARS < PII.MAX_SCAN_LENGTH)
})
