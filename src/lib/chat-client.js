// Chat orchestration for the content script:
//  - createSSEParser: stateful parser for the pinned named-event SSE stream
//  - buildPayload: redacts message + context, assembles the request body
//  - send: opens the chat-stream Port and routes deltas to the panel
(function (root) {
  'use strict'

  function safeJSON (s) { try { return JSON.parse(s) } catch (e) { return null } }

  function createSSEParser (handlers) {
    var buf = ''
    function dispatch (raw) {
      var event = 'message', data = ''
      raw.split('\n').forEach(function (line) {
        if (line.indexOf('event:') === 0) event = line.slice(6).trim()
        else if (line.indexOf('data:') === 0) data += line.slice(5).trim()
      })
      var payload = data ? safeJSON(data) : null
      if (event === 'thinking' && handlers.onThinking) handlers.onThinking((payload && payload.delta) || '')
      else if (event === 'text' && handlers.onText) handlers.onText((payload && payload.delta) || '')
      else if (event === 'done' && handlers.onDone) handlers.onDone(payload || {})
      else if (event === 'error' && handlers.onError) handlers.onError(payload || {})
    }
    function push (chunk) {
      // Normalize CRLF: our background.js relays raw TextDecoder bytes, and SSE
      // servers may use \r\n. Without this the \n\n event delimiter is never found.
      buf += String(chunk).replace(/\r\n/g, '\n')
      var idx
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        var raw = buf.slice(0, idx)
        buf = buf.slice(idx + 2)
        if (raw.trim()) dispatch(raw)
      }
    }
    return { push: push }
  }

  function buildPayload (opts) {
    var redactor = root.PromptShieldsChatRedactor
    var msg = redactor.redactMessage(opts.message || '')
    var ctx = redactor.redactContext(opts.contextText || '')
    var history = (opts.history || []).slice()
    history.push({ role: 'user', content: msg.redacted })
    return {
      messages: history,
      pageContext: ctx.redacted,
      redactionSummary: redactor.mergeSummaries(msg.byCategory, ctx.byCategory)
    }
  }

  // Browser-only: opens the chat-stream Port, posts the payload, routes deltas.
  // Returns a cancel() function. Exercised in Safari (Task 8), not in unit tests.
  function send (opts, handlers) {
    var payload = buildPayload(opts)
    var port = root.browser.runtime.connect({ name: 'chat-stream' })
    var parser = createSSEParser(handlers)
    port.onMessage.addListener(function (msg) {
      if (msg.sse) parser.push(msg.sse)
      else if (msg.error && handlers.onError) handlers.onError({ message: msg.error })
      else if (msg.closed) { if (handlers.onClose) handlers.onClose() }
    })
    port.postMessage({ type: 'CHAT_REQUEST', payload: payload })
    return { cancel: function () { try { port.disconnect() } catch (e) { /* already disconnected */ } }, redactionSummary: payload.redactionSummary }
  }

  root.PromptShieldsChatClient = {
    createSSEParser: createSSEParser,
    buildPayload: buildPayload,
    send: send
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
