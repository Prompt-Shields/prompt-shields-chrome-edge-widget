// Extracts readable main text from the page for use as chat context.
// Capped well under pii-detector's MAX_SCAN_LENGTH so redaction never no-ops.
(function (root) {
  'use strict'

  var MAX_CONTEXT_CHARS = 12000

  function pickRoot (doc) {
    return doc.querySelector('main') || doc.querySelector('article') || doc.body
  }

  // NOTE: requires a real DOM node (uses cloneNode/querySelectorAll/innerText).
  // In Node unit tests there is no DOM — test `cap` directly, or use JSDOM.
  function extractFrom (node) {
    if (!node) return ''
    var clone = node.cloneNode(true)
    var junk = clone.querySelectorAll('script,style,noscript,nav,header,footer,aside,svg,template,[aria-hidden="true"]')
    for (var i = 0; i < junk.length; i++) junk[i].remove()
    var text = clone.innerText || clone.textContent || ''
    return text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
  }

  function cap (text, max) {
    if (!text) return ''
    if (text.length <= max) return text
    return text.slice(0, max)
  }

  function extract (doc) {
    doc = doc || (typeof document !== 'undefined' ? document : null)
    if (!doc) return ''
    return cap(extractFrom(pickRoot(doc)), MAX_CONTEXT_CHARS)
  }

  root.PromptShieldsPageExtractor = {
    extract: extract,
    extractFrom: extractFrom,
    cap: cap,
    MAX_CONTEXT_CHARS: MAX_CONTEXT_CHARS
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
