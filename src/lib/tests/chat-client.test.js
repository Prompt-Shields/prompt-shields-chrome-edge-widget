const { test } = require('node:test')
const assert = require('node:assert')

require('../pii-detector.js')
require('../chat-redactor.js')
require('../chat-client.js')
const C = globalThis.PromptShieldsChatClient

test('parser routes thinking and text deltas to the right sinks', () => {
  const thinking = []
  const textOut = []
  let done = null
  const p = C.createSSEParser({
    onThinking: (d) => thinking.push(d),
    onText: (d) => textOut.push(d),
    onDone: (m) => { done = m }
  })
  p.push('event: thinking\ndata: {"delta":"Let me "}\n\n')
  p.push('event: thinking\ndata: {"delta":"think"}\n\n')
  p.push('event: text\ndata: {"delta":"Answer"}\n\n')
  p.push('event: done\ndata: {"thinkingMs":42}\n\n')
  assert.strictEqual(thinking.join(''), 'Let me think')
  assert.strictEqual(textOut.join(''), 'Answer')
  assert.deepStrictEqual(done, { thinkingMs: 42 })
})

test('parser handles an event split across two chunks', () => {
  const textOut = []
  const p = C.createSSEParser({ onText: (d) => textOut.push(d) })
  p.push('event: text\nda')
  p.push('ta: {"delta":"Hi"}\n\n')
  assert.strictEqual(textOut.join(''), 'Hi')
})

test('parser normalizes CRLF line endings', () => {
  const textOut = []
  const p = C.createSSEParser({ onText: (d) => textOut.push(d) })
  p.push('event: text\r\ndata: {"delta":"CRLF"}\r\n\r\n')
  assert.strictEqual(textOut.join(''), 'CRLF')
})

test('graceful degrade: no thinking events fire no onThinking callback', () => {
  const thinking = []
  const textOut = []
  const p = C.createSSEParser({
    onThinking: (d) => thinking.push(d),
    onText: (d) => textOut.push(d)
  })
  p.push('event: text\ndata: {"delta":"Answer only"}\n\n')
  p.push('event: done\ndata: {}\n\n')
  assert.strictEqual(thinking.length, 0)
  assert.strictEqual(textOut.join(''), 'Answer only')
})

test('buildPayload redacts message AND context — no raw PII in serialized payload', () => {
  const payload = C.buildPayload({
    message: 'email me at jane.doe@example.com',
    contextText: 'invoice for john.smith@acme.io total due',
    history: []
  })
  const serialized = JSON.stringify(payload)
  assert.ok(!serialized.includes('jane.doe@example.com'))
  assert.ok(!serialized.includes('john.smith@acme.io'))
  assert.strictEqual(payload.messages[payload.messages.length - 1].role, 'user')
  assert.ok(payload.redactionSummary.email >= 2)
})
