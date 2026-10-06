// Issue sidebar — Grammarly-style slide-in panel + persistent shield
// indicator on the focused input.
//
// Replaces the v1.6/1.7 modal-ish tooltip with a calmer, persistent
// surface that mirrors how Grammarly works: a small shield always
// visible while typing, a sidebar that lists every issue, per-issue
// Apply/Ignore, and an Apply-all footer.
//
// Surfaces:
//   1. Floating shield      — small badge at the focused input's
//                             top-right corner. Shows live count.
//                             Click → opens sidebar. Hover → quick
//                             preview of top categories.
//   2. Issue sidebar        — slide-in panel from right edge of the
//                             viewport. Lists every match with:
//                              - category icon + label
//                              - excerpt of the original text with
//                                the matched span highlighted
//                              - coaching tip
//                              - Apply (redacts THIS one)
//                              - Ignore (dismisses THIS one)
//                             Footer: Apply all, Ignore all, Close.
//   3. Toast                — bottom-right after Apply-all confirming
//                             "N redacted • Undo (5s)".
//
// Keyboard shortcuts (active while sidebar is open):
//   Cmd/Ctrl + Shift + R   → Apply all
//   Cmd/Ctrl + Shift + I   → Ignore all
//   Esc                    → Close
//
// Customer-feedback rules baked in:
//   - Calm, persistent presence (Grammarly-style) — never blocks typing.
//   - Per-detector coaching tip on every issue (Moment 1 spec).
//   - Frequency suppression on the SHIELD badge (greys out after 5
//     detections per category — UX-2). Sidebar still opens on click.
//   - Always-visible Apply-all keyboard shortcut for power users.
//
// Implementation note: every DOM node is built via createElement +
// textContent; no innerHTML assignment. Defensive against XSS even
// though every string here is a static literal.

(function (root) {
  'use strict'

  // ─── Per-category copy (mirrors redaction-tooltip.js) ────────────

  var COPY = {
    email: { label: 'Email', icon: '✉️', tip: "Use the contact's reference number or initials instead." },
    phone: { label: 'Phone', icon: '📞', tip: 'AI tools log every prompt — drop the number and refer to "the contact".' },
    creditCard: { label: 'Credit Card', icon: '💳', tip: 'Cardholder data should never reach a third-party AI tool.' },
    ssn: { label: 'SSN', icon: '🆔', tip: "Use the customer's anonymised reference instead of their SSN." },
    apiKey: { label: 'API Key', icon: '🔑', tip: "Rotate this key now — assume it's exposed." },
    jwt: { label: 'JWT Token', icon: '🎫', tip: "Tokens leak the holder's identity. Refer to the user by role." },
    iban: { label: 'Bank IBAN', icon: '🏦', tip: "Bank account identifiers don't belong in an AI prompt." },
    bitcoinAddress: { label: 'Bitcoin Address', icon: '₿', tip: 'Wallet identifiers are linkable to real-world identity.' },
    ipAddress: { label: 'IP Address', icon: '🌐', tip: 'IPs can identify your network. Use a generic placeholder.' },
    currency: { label: 'Money Amount', icon: '💰', tip: "Confidential financial figures shouldn't reach external AI." },
    personName: { label: 'Person Name', icon: '👤', tip: 'Use a role or reference number instead of a real name.' },
    promptInjection: { label: 'Prompt Injection', icon: '🧨', tip: 'This text tries to override the AI\'s instructions. If you pasted it from an email, web page or document, remove it before sending.' },
    hiddenText: { label: 'Hidden Text', icon: '👻', tip: 'Invisible characters can carry instructions a model reads but you cannot see. Apply to strip them.' },
    confidentialTerm: { label: 'Confidential Term', icon: '🔒', tip: 'Your organisation marks this term as confidential.' }
  }

  function copyFor (category) {
    return COPY[category] || { label: category, icon: '⚠️', tip: 'Sensitive data detected.' }
  }

  // Per-match copy: org-defined rules carry their own label / tip, and
  // hidden-text hits carry a decoded `detail` the user needs to see.
  function copyForMatch (match) {
    var base = copyFor(match.category)
    var tip = match.tip || base.tip
    if (match.detail) tip = match.detail + ' — ' + tip
    return { label: match.label || base.label, icon: base.icon, tip: tip }
  }

  var HIGH_CATEGORIES = {
    apiKey: true, jwt: true, creditCard: true, ssn: true, iban: true,
    bitcoinAddress: true, promptInjection: true, hiddenText: true
  }

  // ─── Frequency suppression on the shield badge ───────────────────

  var SUPPRESS_AFTER = 5
  var detectionCounts = Object.create(null)

  function shieldShouldDim (categories) {
    if (!categories.length) return false
    for (var i = 0; i < categories.length; i++) {
      if ((detectionCounts[categories[i]] || 0) < SUPPRESS_AFTER) return false
    }
    return true
  }

  function recordDetection (categories) {
    for (var i = 0; i < categories.length; i++) {
      detectionCounts[categories[i]] = (detectionCounts[categories[i]] || 0) + 1
    }
  }

  function resetSuppression () {
    detectionCounts = Object.create(null)
  }

  // ─── State ───────────────────────────────────────────────────────

  var shieldEl = null
  var sidebarEl = null
  var toastEl = null
  var currentTarget = null
  var currentMatches = []
  var ignored = new Set() // match indexes the user explicitly ignored
  var onAction = null
  var keyHandlerBound = false
  var lastUndoSnapshot = null

  // ─── DOM helpers ─────────────────────────────────────────────────

  function el (tag, className, text) {
    var n = document.createElement(tag)
    if (className) n.className = className
    if (text != null) n.textContent = text
    return n
  }

  // ─── Shield ──────────────────────────────────────────────────────

  function createShield () {
    var s = el('div', 'ps-shield')
    s.setAttribute('role', 'button')
    s.setAttribute('aria-label', 'Prompt Shields — open issues')
    s.setAttribute('tabindex', '0')

    var inner = el('div', 'ps-shield__icon', '🛡') // 🛡
    var badge = el('span', 'ps-shield__badge')
    var preview = el('div', 'ps-shield__preview')
    s.appendChild(inner)
    s.appendChild(badge)
    s.appendChild(preview)

    s.addEventListener('click', function () { openSidebar() })
    s.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSidebar() }
    })
    s.addEventListener('mouseenter', renderQuickPreview)
    return s
  }

  function positionShield () {
    if (!shieldEl || !currentTarget) return
    var r = currentTarget.getBoundingClientRect()
    shieldEl.style.position = 'absolute'
    shieldEl.style.top = (window.scrollY + r.top + 6) + 'px'
    shieldEl.style.left = (window.scrollX + r.right - 32) + 'px'
    shieldEl.style.zIndex = '2147483646'
  }

  function updateShieldBadge () {
    if (!shieldEl) return
    var badge = shieldEl.querySelector('.ps-shield__badge')
    var inner = shieldEl.querySelector('.ps-shield__icon')
    var visibleCount = currentMatches.length - ignored.size

    if (visibleCount === 0) {
      shieldEl.classList.remove('ps-shield--has-issues', 'ps-shield--high')
      shieldEl.classList.add('ps-shield--clean')
      badge.textContent = ''
    } else {
      shieldEl.classList.add('ps-shield--has-issues')
      shieldEl.classList.remove('ps-shield--clean')
      badge.textContent = String(visibleCount)
      var anyHigh = currentMatches.some(function (m, i) {
        if (ignored.has(i)) return false
        return m.severity === 'high' || HIGH_CATEGORIES[m.category] === true
      })
      shieldEl.classList.toggle('ps-shield--high', anyHigh)
    }

    var allSuppressed = shieldShouldDim(currentMatches.map(function (m) { return m.category }))
    shieldEl.classList.toggle('ps-shield--dim', allSuppressed)
    inner.style.opacity = allSuppressed ? '0.55' : '1'
  }

  function renderQuickPreview () {
    if (!shieldEl) return
    var preview = shieldEl.querySelector('.ps-shield__preview')
    if (!preview) return
    while (preview.firstChild) preview.removeChild(preview.firstChild)

    var visible = []
    for (var i = 0; i < currentMatches.length; i++) {
      if (!ignored.has(i)) visible.push(currentMatches[i])
    }
    if (visible.length === 0) {
      preview.appendChild(el('div', 'ps-shield__preview-line', 'No issues'))
      return
    }
    var byCat = {}
    visible.forEach(function (m) { byCat[m.category] = (byCat[m.category] || 0) + 1 })
    var keys = Object.keys(byCat).slice(0, 4)
    keys.forEach(function (cat) {
      var line = el('div', 'ps-shield__preview-line')
      var c = copyFor(cat)
      var name = el('span', null, c.icon + ' ' + c.label)
      var count = el('span', 'ps-shield__preview-count', String(byCat[cat]))
      line.appendChild(name)
      line.appendChild(count)
      preview.appendChild(line)
    })
    preview.appendChild(el('div', 'ps-shield__preview-hint', 'Click to review · ⌘⇧R to apply all'))
  }

  // ─── Sidebar ─────────────────────────────────────────────────────

  function makeIssueRow (match, index) {
    var row = el('div', 'ps-issue')
    row.setAttribute('data-index', String(index))
    if (ignored.has(index)) row.classList.add('ps-issue--ignored')

    var c = copyForMatch(match)

    var head = el('div', 'ps-issue__head')
    head.appendChild(el('span', 'ps-issue__icon', c.icon))
    head.appendChild(el('span', 'ps-issue__label', c.label))

    // Excerpt: 30 chars before + the match + 30 after, highlighted
    var excerpt = el('div', 'ps-issue__excerpt')
    var fullText = currentTarget ? readText(currentTarget) : ''
    var winStart = Math.max(0, match.start - 30)
    var winEnd = Math.min(fullText.length, match.end + 30)
    var pre = fullText.slice(winStart, match.start)
    var hit = fullText.slice(match.start, match.end)
    var post = fullText.slice(match.end, winEnd)
    if (winStart > 0) pre = '…' + pre
    if (winEnd < fullText.length) post = post + '…'
    excerpt.appendChild(el('span', null, pre))
    excerpt.appendChild(el('mark', 'ps-issue__hit', hit))
    excerpt.appendChild(el('span', null, post))

    var tip = el('div', 'ps-issue__tip', c.tip)

    var actions = el('div', 'ps-issue__actions')
    var apply = el('button', 'ps-issue__btn ps-issue__btn--primary', 'Apply')
    var ignore = el('button', 'ps-issue__btn', 'Ignore')
    apply.addEventListener('click', function () { applyOne(index) })
    ignore.addEventListener('click', function () { ignoreOne(index) })
    if (ignored.has(index)) apply.disabled = true
    actions.appendChild(apply)
    actions.appendChild(ignore)

    row.appendChild(head)
    row.appendChild(excerpt)
    row.appendChild(tip)
    row.appendChild(actions)
    return row
  }

  function rebuildSidebarBody () {
    if (!sidebarEl) return
    var body = sidebarEl.querySelector('.ps-sidebar__body')
    if (!body) return
    while (body.firstChild) body.removeChild(body.firstChild)
    if (currentMatches.length === 0) {
      body.appendChild(el('div', 'ps-sidebar__empty', 'No issues — your prompt looks clean.'))
      return
    }
    currentMatches.forEach(function (m, i) {
      body.appendChild(makeIssueRow(m, i))
    })
  }

  function createSidebar () {
    var box = el('aside', 'ps-sidebar')
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-label', 'Prompt Shields issues')

    var header = el('div', 'ps-sidebar__header')
    var title = el('div', 'ps-sidebar__title')
    title.appendChild(el('span', 'ps-sidebar__logo', '🛡')) // 🛡
    title.appendChild(el('strong', null, 'Prompt Shields'))
    var sub = el('div', 'ps-sidebar__subtitle', '0 issues detected')
    var closeBtn = el('button', 'ps-sidebar__close', '×')
    closeBtn.setAttribute('aria-label', 'Close sidebar')
    closeBtn.addEventListener('click', function () { closeSidebar() })
    header.appendChild(title)
    header.appendChild(sub)
    header.appendChild(closeBtn)

    var body = el('div', 'ps-sidebar__body')

    var footer = el('div', 'ps-sidebar__footer')
    var applyAll = el('button', 'ps-sidebar__btn ps-sidebar__btn--primary', 'Apply all')
    applyAll.title = 'Cmd/Ctrl + Shift + R'
    var ignoreAll = el('button', 'ps-sidebar__btn', 'Ignore all')
    ignoreAll.title = 'Cmd/Ctrl + Shift + I'
    applyAll.addEventListener('click', function () { applyAllVisible() })
    ignoreAll.addEventListener('click', function () { ignoreAllVisible() })
    footer.appendChild(applyAll)
    footer.appendChild(ignoreAll)

    box.appendChild(header)
    box.appendChild(body)
    box.appendChild(footer)
    return box
  }

  function updateSidebarSubtitle () {
    if (!sidebarEl) return
    var sub = sidebarEl.querySelector('.ps-sidebar__subtitle')
    if (!sub) return
    var visible = currentMatches.length - ignored.size
    sub.textContent = visible === 0
      ? 'All issues handled'
      : (visible + ' issue' + (visible === 1 ? '' : 's') + ' pending')
  }

  // ─── Open/close ──────────────────────────────────────────────────

  function openSidebar () {
    if (!sidebarEl) {
      sidebarEl = createSidebar()
      document.body.appendChild(sidebarEl)
    }
    rebuildSidebarBody()
    updateSidebarSubtitle()
    sidebarEl.classList.add('ps-sidebar--open')
    bindKeys()
  }

  function closeSidebar () {
    if (sidebarEl) sidebarEl.classList.remove('ps-sidebar--open')
    unbindKeys()
  }

  function bindKeys () {
    if (keyHandlerBound) return
    keyHandlerBound = true
    document.addEventListener('keydown', onKeydown, true)
  }

  function unbindKeys () {
    if (!keyHandlerBound) return
    keyHandlerBound = false
    document.removeEventListener('keydown', onKeydown, true)
  }

  function onKeydown (e) {
    var meta = e.metaKey || e.ctrlKey
    if (e.key === 'Escape') {
      closeSidebar()
      e.stopPropagation()
      return
    }
    if (meta && e.shiftKey && (e.key === 'r' || e.key === 'R')) {
      e.preventDefault()
      applyAllVisible()
    } else if (meta && e.shiftKey && (e.key === 'i' || e.key === 'I')) {
      e.preventDefault()
      ignoreAllVisible()
    }
  }

  // ─── Actions ─────────────────────────────────────────────────────

  function applyOne (index) {
    if (ignored.has(index)) return
    if (!onAction) return
    onAction({ kind: 'apply', indexes: [index] })
  }

  function ignoreOne (index) {
    ignored.add(index)
    rebuildSidebarBody()
    updateSidebarSubtitle()
    updateShieldBadge()
    if (onAction) onAction({ kind: 'ignore', indexes: [index] })
  }

  function applyAllVisible () {
    if (!onAction) return
    var indexes = []
    for (var i = 0; i < currentMatches.length; i++) {
      if (!ignored.has(i)) indexes.push(i)
    }
    if (indexes.length === 0) return
    onAction({ kind: 'apply', indexes: indexes })
  }

  function ignoreAllVisible () {
    var changed = false
    for (var i = 0; i < currentMatches.length; i++) {
      if (!ignored.has(i)) { ignored.add(i); changed = true }
    }
    if (changed) {
      rebuildSidebarBody()
      updateSidebarSubtitle()
      updateShieldBadge()
      if (onAction) onAction({ kind: 'ignore-all' })
    }
  }

  function readText (target) {
    if (!target) return ''
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return target.value || ''
    return target.textContent || ''
  }

  // ─── Toast ───────────────────────────────────────────────────────

  function showToast (message, undoFn) {
    if (toastEl) toastEl.remove()
    toastEl = el('div', 'ps-toast')
    toastEl.appendChild(el('span', 'ps-toast__msg', message))
    if (undoFn) {
      var undo = el('button', 'ps-toast__btn', 'Undo')
      undo.addEventListener('click', function () {
        try { undoFn() } catch (e) { /* swallow */ }
        if (toastEl) { toastEl.remove(); toastEl = null }
      })
      toastEl.appendChild(undo)
    }
    document.body.appendChild(toastEl)
    setTimeout(function () {
      if (toastEl) {
        toastEl.classList.add('ps-toast--out')
        setTimeout(function () {
          if (toastEl) { toastEl.remove(); toastEl = null }
        }, 200)
      }
    }, 5000)
  }

  // ─── Public API ──────────────────────────────────────────────────

  function update (target, matches, opts) {
    opts = opts || {}
    currentTarget = target
    currentMatches = matches.slice()
    ignored = new Set()
    onAction = opts.onResult || null

    if (matches.length === 0) {
      hide()
      return
    }
    recordDetection(matches.map(function (m) { return m.category }))

    if (!shieldEl) {
      shieldEl = createShield()
      document.body.appendChild(shieldEl)
    }
    positionShield()
    updateShieldBadge()

    if (sidebarEl && sidebarEl.classList.contains('ps-sidebar--open')) {
      rebuildSidebarBody()
      updateSidebarSubtitle()
    }
  }

  function hide () {
    if (shieldEl) { shieldEl.remove(); shieldEl = null }
    if (sidebarEl) { sidebarEl.remove(); sidebarEl = null }
    unbindKeys()
  }

  function reposition () {
    positionShield()
  }

  function setUndoSnapshot (snapshot) { lastUndoSnapshot = snapshot }
  function getUndoSnapshot () { return lastUndoSnapshot }

  function notifyApplied (count) {
    var msg = count + ' redaction' + (count === 1 ? '' : 's') + ' applied'
    showToast(msg, lastUndoSnapshot ? function () {
      if (onAction) onAction({ kind: 'undo-toast' })
    } : null)
  }

  // ─── Export ──────────────────────────────────────────────────────

  root.PromptShieldsIssueSidebar = {
    update: update,
    hide: hide,
    reposition: reposition,
    open: openSidebar,
    close: closeSidebar,
    notifyApplied: notifyApplied,
    setUndoSnapshot: setUndoSnapshot,
    getUndoSnapshot: getUndoSnapshot,
    resetSuppression: resetSuppression,
    SUPPRESS_AFTER: SUPPRESS_AFTER
  }
})(typeof window !== 'undefined' ? window : globalThis)
