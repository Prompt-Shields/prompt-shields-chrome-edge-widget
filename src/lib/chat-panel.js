// PromptShieldsExtension/lib/chat-panel.js
// Slide-in chat panel + floating chat button. Talks to PromptShieldsChatClient.
// All DOM via createElement/textContent — no innerHTML (XSS-defensive, matches
// issue-sidebar.js).
(function (root) {
  'use strict'

  function el (tag, className, text) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (text != null) n.textContent = text
    return n
  }

  var fabEl = null
  var panelEl = null
  var listEl = null
  var inputEl = null
  var redactChipEl = null
  var isOpen = false
  var history = []                  // [{role, content}]
  var activeStream = null           // { cancel }
  var cachedContextSummary = null   // redactContext(page).byCategory, computed once per open()

  function ensureFab () {
    if (fabEl) return
    fabEl = el('div', 'ps-chat-fab')
    fabEl.setAttribute('role', 'button')
    fabEl.setAttribute('aria-label', 'Open PromptShields chat')
    fabEl.setAttribute('tabindex', '0')
    fabEl.appendChild(el('span', 'ps-chat-fab__icon', '💬'))
    fabEl.addEventListener('click', toggle)
    fabEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle() } })
    document.body.appendChild(fabEl)
  }

  function buildPanel () {
    panelEl = el('div', 'ps-chat-panel')

    var header = el('div', 'ps-chat-panel__header')
    header.appendChild(el('span', 'ps-chat-panel__title', 'PromptShields Chat'))
    header.appendChild(el('span', 'ps-chat-panel__context', 'context: this page'))
    var close = el('button', 'ps-chat-panel__close', '×')
    close.setAttribute('aria-label', 'Close chat')
    close.addEventListener('click', close_)
    header.appendChild(close)
    panelEl.appendChild(header)

    listEl = el('div', 'ps-chat-panel__list')
    listEl.setAttribute('role', 'log')
    listEl.setAttribute('aria-live', 'polite')
    panelEl.appendChild(listEl)

    var composer = el('div', 'ps-chat-panel__composer')
    redactChipEl = el('div', 'ps-chat-panel__redact')
    redactChipEl.style.display = 'none'
    composer.appendChild(redactChipEl)
    inputEl = el('textarea', 'ps-chat-panel__input')
    inputEl.setAttribute('rows', '2')
    inputEl.setAttribute('aria-label', 'Message')
    inputEl.setAttribute('placeholder', 'Ask about this page…')
    inputEl.addEventListener('input', updateRedactPreview)
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit() }
    })
    composer.appendChild(inputEl)
    var send = el('button', 'ps-chat-panel__send', 'Send')
    send.addEventListener('click', submit)
    composer.appendChild(send)
    panelEl.appendChild(composer)

    document.body.appendChild(panelEl)
  }

  function ensurePanel () { if (!panelEl) buildPanel() }

  function open () { ensurePanel(); cachedContextSummary = null; panelEl.classList.add('ps-chat-panel--open'); if (fabEl) fabEl.classList.add('ps-chat-fab--hidden'); isOpen = true; inputEl.focus() }
  function close_ () {
    if (activeStream) { activeStream.cancel(); activeStream = null } // abort in-flight stream
    if (panelEl) panelEl.classList.remove('ps-chat-panel--open')
    if (fabEl) fabEl.classList.remove('ps-chat-fab--hidden')
    isOpen = false
  }
  function toggle () { isOpen ? close_() : open() }

  function currentContext () {
    return root.PromptShieldsPageExtractor.extract(document)
  }

  function updateRedactPreview () {
    var redactor = root.PromptShieldsChatRedactor
    var msg = redactor.redactMessage(inputEl.value || '')
    // Page context doesn't change between keystrokes — extract + redact it once per open().
    if (!cachedContextSummary) {
      cachedContextSummary = redactor.redactContext(currentContext()).byCategory
    }
    var n = redactor.totalCount(redactor.mergeSummaries(msg.byCategory, cachedContextSummary))
    if (n > 0) {
      redactChipEl.textContent = '🛡 ' + n + ' item' + (n === 1 ? '' : 's') + ' will be redacted'
      redactChipEl.style.display = ''
    } else {
      redactChipEl.style.display = 'none'
    }
  }

  function addBubble (role, text) {
    var b = el('div', 'ps-chat-msg ps-chat-msg--' + role)
    var body = el('div', 'ps-chat-msg__body', text || '')
    b.appendChild(body)
    listEl.appendChild(b)
    listEl.scrollTop = listEl.scrollHeight
    return body
  }

  // Returns a controller exposing the thinking/answer sinks + done().
  function addAssistantMessage () {
    var wrap = el('div', 'ps-chat-msg ps-chat-msg--assistant')
    var thinkingWrap = null, thinkingBody = null, thinkingHeader = null
    var thinkingStarted = false
    var answerBody = el('div', 'ps-chat-msg__body')

    function ensureThinking () {
      if (thinkingStarted) return
      thinkingStarted = true
      thinkingWrap = el('details', 'ps-chat-think')
      thinkingWrap.open = true
      thinkingHeader = el('summary', 'ps-chat-think__summary', 'Thinking…')
      thinkingBody = el('div', 'ps-chat-think__body')
      thinkingWrap.appendChild(thinkingHeader)
      thinkingWrap.appendChild(thinkingBody)
      // Thinking disclosure must sit ABOVE the answer (Claude-style), so insert
      // before answerBody rather than appending after it.
      wrap.insertBefore(thinkingWrap, answerBody)
    }

    wrap.appendChild(answerBody)
    listEl.appendChild(wrap)

    var collapsedOnAnswer = false
    return {
      onThinking: function (d) {
        ensureThinking()
        thinkingBody.textContent += d
        listEl.scrollTop = listEl.scrollHeight
      },
      onText: function (d) {
        if (thinkingStarted && !collapsedOnAnswer) { thinkingWrap.open = false; collapsedOnAnswer = true }
        answerBody.textContent += d
        listEl.scrollTop = listEl.scrollHeight
      },
      onDone: function (meta) {
        if (thinkingStarted && meta && typeof meta.thinkingMs === 'number') {
          thinkingHeader.textContent = 'Thought for ' + Math.max(1, Math.round(meta.thinkingMs / 1000)) + 's'
        } else if (thinkingStarted) {
          thinkingHeader.textContent = 'Thoughts'
        }
        history.push({ role: 'assistant', content: answerBody.textContent })
      },
      onError: function (e) {
        answerBody.textContent += '\n[error: ' + ((e && e.message) || 'failed') + ']'
        // Record the (errored) assistant turn so history stays consistent for the next request.
        history.push({ role: 'assistant', content: answerBody.textContent })
      }
    }
  }

  function submit () {
    var text = (inputEl.value || '').trim()
    if (!text || activeStream) return
    inputEl.value = ''
    updateRedactPreview()

    var redactor = root.PromptShieldsChatRedactor
    // Display the redacted form; ChatClient.buildPayload re-redacts `text` as the
    // authoritative redaction-before-send boundary (message text is small — cheap).
    var shown = redactor.redactMessage(text).redacted
    addBubble('user', shown)

    var ctrl = addAssistantMessage()
    function endStream () { activeStream = null }
    activeStream = root.PromptShieldsChatClient.send(
      { message: text, contextText: currentContext(), history: history.slice() },
      {
        onThinking: ctrl.onThinking,
        onText: ctrl.onText,
        onDone: function (meta) { ctrl.onDone(meta); endStream() },
        onError: function (e) { ctrl.onError(e); endStream() },
        onClose: endStream
      }
    )
    history.push({ role: 'user', content: shown })
  }

  function init () {
    if (typeof document === 'undefined') return
    ensureFab()
  }

  root.PromptShieldsChatPanel = { init: init, open: open, close: close_, toggle: toggle }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
