// Upload guard — stops confidential files reaching an AI tool, and scans
// text files for hidden prompt-injection payloads before they are uploaded.
//
// What a browser extension can and cannot see (this matters for what we
// promise customers — see docs/ENTERPRISE_DEPLOYMENT.md § Limits):
//   CAN:    file name, MIME type, size, and the file's bytes.
//   CANNOT: the folder it came from, NTFS / SMB share permissions, or
//           any file-system metadata. A folder-level rule ("everything
//           under \\fs01\Confidential") needs the desktop agent.
//
// Decision flow for each file (pure, unit-tested — see evaluateFile):
//   1. File name matches a confidential-name pattern      → finding
//   2. Text-like file ≤ maxScanBytes: run the PII detector,
//      custom rules and injection detector on its contents → findings
//   3. Verdict: no findings → 'allow'; otherwise 'block' in strict mode,
//      'warn' (user may proceed) in guideline mode.
//
// DOM wiring (install): intercepts <input type=file> change/input, drop,
// and paste-with-files in the capture phase. When a file needs an async
// content scan, the original event is held back and — if the user
// proceeds — re-dispatched as a fresh event on the same target.

(function (root) {
  'use strict'

  // EN / FR / DE / NL / ES classification markings. Bounded by non-letters
  // (not \b — "_" is a word character, and "top_secret.pdf" must match
  // while "secretary.pdf" must not).
  var DEFAULT_NAME_PATTERNS = [
    'confidential', 'confidentiel', 'vertraulich', 'vertrouwelijk', 'confidencial',
    'strictly[\\s_.-]*private', 'internal[\\s_.-]*only',
    '(?:^|[^a-z])restricted(?![a-z])', '(?:^|[^a-z])secret(?![a-z])', '(?:^|[^a-z])geheim(?![a-z])'
  ]

  var TEXT_EXTENSIONS = /\.(?:txt|md|markdown|csv|tsv|json|xml|html?|eml|log|ya?ml|ini|cfg|conf|sql|js|ts|py|java|cs|go|rb|php|sh|ps1|rtf)$/i
  var DEFAULT_MAX_SCAN_BYTES = 2 * 1024 * 1024

  function normalizePolicy (raw) {
    raw = raw || {}
    var patterns = Array.isArray(raw.blockedNamePatterns) && raw.blockedNamePatterns.length
      ? raw.blockedNamePatterns
      : DEFAULT_NAME_PATTERNS
    var nameRes = []
    for (var i = 0; i < patterns.length; i++) {
      if (typeof patterns[i] !== 'string' || !patterns[i]) continue
      try { nameRes.push(new RegExp(patterns[i], 'i')) } catch (e) { /* drop invalid */ }
    }
    var allowed = Array.isArray(raw.allowedNamePatterns) ? raw.allowedNamePatterns : []
    var allowRes = []
    for (var j = 0; j < allowed.length; j++) {
      if (typeof allowed[j] !== 'string' || !allowed[j]) continue
      try { allowRes.push(new RegExp(allowed[j], 'i')) } catch (e) { /* drop invalid */ }
    }
    return {
      enabled: raw.enabled !== false,
      scanContents: raw.scanContents !== false,
      maxScanBytes: typeof raw.maxScanBytes === 'number' && raw.maxScanBytes > 0
        ? raw.maxScanBytes
        : DEFAULT_MAX_SCAN_BYTES,
      nameRes: nameRes,
      allowRes: allowRes
    }
  }

  function isTextLike (file) {
    if (!file) return false
    if (file.type && /^text\/|\/(?:json|xml|x-yaml|csv|rtf)$/.test(file.type)) return true
    return TEXT_EXTENSIONS.test(file.name || '')
  }

  // Sync part: does this file need its contents read before we decide?
  function needsContentScan (file, policy) {
    return !!(policy.enabled && policy.scanContents && isTextLike(file) &&
      typeof file.size === 'number' && file.size <= policy.maxScanBytes)
  }

  function nameFindings (file, policy) {
    var name = file && file.name ? file.name : ''
    for (var a = 0; a < policy.allowRes.length; a++) {
      if (policy.allowRes[a].test(name)) return []
    }
    for (var i = 0; i < policy.nameRes.length; i++) {
      if (policy.nameRes[i].test(name)) {
        return [{ kind: 'confidentialName', category: 'confidentialFile', severity: 'high', detail: 'File name "' + name + '" is marked confidential' }]
      }
    }
    return []
  }

  var HIGH_CATEGORIES = {
    apiKey: true, jwt: true, creditCard: true, ssn: true, iban: true,
    bitcoinAddress: true, promptInjection: true, hiddenText: true
  }

  function isHighSeverity (m) {
    return m.severity === 'high' || HIGH_CATEGORIES[m.category] === true
  }

  function summarizeContent (matches) {
    var byCategory = {}
    for (var i = 0; i < matches.length; i++) {
      var c = matches[i].category
      byCategory[c] = (byCategory[c] || 0) + 1
    }
    return byCategory
  }

  /*
   * evaluateFile(file, text, policy, scan, mode)
   *   file   — { name, type, size }
   *   text   — file contents (string) or null if not scanned
   *   policy — normalizePolicy() output
   *   scan   — function(text) → matches[] (PII + custom + injection)
   *   mode   — 'guideline' | 'strict'
   * → { verdict: 'allow'|'warn'|'block', findings: [...], byCategory }
   */
  function evaluateFile (file, text, policy, scan, mode) {
    if (!policy.enabled) return { verdict: 'allow', findings: [], byCategory: {} }
    var findings = nameFindings(file, policy)
    var byCategory = {}
    if (findings.length) byCategory.confidentialFile = 1

    if (typeof text === 'string' && text && typeof scan === 'function') {
      // Only high-severity content interrupts an upload. Names and emails in
      // a CSV are normal; nagging on them trains users to click through.
      var matches = scan(text).filter(isHighSeverity)
      if (matches.length) {
        var counts = summarizeContent(matches)
        Object.keys(counts).forEach(function (k) {
          byCategory[k] = (byCategory[k] || 0) + counts[k]
        })
        findings.push({
          kind: 'content',
          category: 'fileContent',
          severity: 'high',
          detail: describeCounts(counts)
        })
      }
    }

    if (findings.length === 0) return { verdict: 'allow', findings: findings, byCategory: byCategory }
    return { verdict: mode === 'strict' ? 'block' : 'warn', findings: findings, byCategory: byCategory }
  }

  var CATEGORY_NAMES = {
    promptInjection: 'hidden AI instruction',
    hiddenText: 'invisible text',
    confidentialTerm: 'confidential term',
    creditCard: 'card number',
    apiKey: 'API key',
    ssn: 'national ID',
    iban: 'IBAN',
    email: 'email address',
    phone: 'phone number',
    personName: 'person name'
  }

  function describeCounts (counts) {
    return 'Contains ' + Object.keys(counts).map(function (k) {
      var n = counts[k]
      var name = CATEGORY_NAMES[k] || k
      return n + ' ' + name + (n === 1 ? '' : 's')
    }).join(', ')
  }

  // ─── DOM wiring ──────────────────────────────────────────────────

  // Events we re-dispatched ourselves; the capture listener lets these through.
  var released = typeof WeakSet !== 'undefined' ? new WeakSet() : null

  function readAsText (file) {
    if (file.text) return file.text()
    return new Promise(function (resolve, reject) {
      var r = new FileReader()
      r.onload = function () { resolve(String(r.result || '')) }
      r.onerror = function () { reject(r.error) }
      r.readAsText(file)
    })
  }

  function evaluateFiles (files, deps) {
    var policy = deps.getPolicy()
    var mode = deps.getMode()
    return Promise.all(Array.prototype.map.call(files, function (file) {
      var p = needsContentScan(file, policy) ? readAsText(file).catch(function () { return null }) : Promise.resolve(null)
      return p.then(function (text) {
        var res = evaluateFile(file, text, policy, deps.scan, mode)
        res.file = file
        return res
      })
    }))
  }

  function worstVerdict (results) {
    var v = 'allow'
    for (var i = 0; i < results.length; i++) {
      if (results[i].verdict === 'block') return 'block'
      if (results[i].verdict === 'warn') v = 'warn'
    }
    return v
  }

  // Minimal, isolated dialog. Resolves true if the user chooses to proceed.
  function showDialog (verdict, results, opts) {
    return new Promise(function (resolve) {
      var host = document.createElement('div')
      host.className = 'ps-fileguard-host'
      var shadow = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host
      var style = document.createElement('style')
      style.textContent = [
        '.bd{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483647;display:flex;align-items:center;justify-content:center;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}',
        '.dlg{background:#fff;color:#0f172a;max-width:440px;width:calc(100% - 32px);border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.3);padding:20px}',
        'h2{margin:0 0 8px;font-size:16px}',
        'ul{margin:8px 0 12px;padding-left:18px}',
        'li{margin:4px 0}',
        '.f{font-weight:600;word-break:break-all}',
        '.row{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}',
        'button{font:inherit;border-radius:8px;padding:6px 14px;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#0f172a}',
        'button.p{background:#2563eb;border-color:#2563eb;color:#fff}',
        'a{color:#2563eb}'
      ].join('')
      shadow.appendChild(style)

      var bd = document.createElement('div')
      bd.className = 'bd'
      var dlg = document.createElement('div')
      dlg.className = 'dlg'
      dlg.setAttribute('role', 'alertdialog')
      dlg.setAttribute('aria-modal', 'true')

      var h = document.createElement('h2')
      h.textContent = verdict === 'block'
        ? 'Upload blocked by your organisation'
        : 'This upload may contain confidential data'
      dlg.appendChild(h)

      var ul = document.createElement('ul')
      results.forEach(function (r) {
        if (r.verdict === 'allow') return
        var li = document.createElement('li')
        var name = document.createElement('span')
        name.className = 'f'
        name.textContent = r.file && r.file.name ? r.file.name : 'file'
        li.appendChild(name)
        li.appendChild(document.createTextNode(' — ' + r.findings.map(function (f) { return f.detail }).join('; ')))
        ul.appendChild(li)
      })
      dlg.appendChild(ul)

      var row = document.createElement('div')
      row.className = 'row'
      if (opts && opts.appealUrl) {
        var a = document.createElement('a')
        a.href = opts.appealUrl
        a.target = '_blank'
        a.rel = 'noopener noreferrer'
        a.textContent = 'Request an exception'
        a.style.marginRight = 'auto'
        a.style.alignSelf = 'center'
        row.appendChild(a)
      }
      var cancel = document.createElement('button')
      cancel.className = verdict === 'block' ? 'p' : ''
      cancel.textContent = verdict === 'block' ? 'OK' : 'Cancel upload'
      row.appendChild(cancel)
      var proceed = null
      if (verdict !== 'block') {
        proceed = document.createElement('button')
        proceed.textContent = 'Upload anyway'
        row.appendChild(proceed)
      }
      dlg.appendChild(row)
      bd.appendChild(dlg)
      shadow.appendChild(bd)
      document.documentElement.appendChild(host)

      function done (ok) {
        document.removeEventListener('keydown', onKey, true)
        if (host.parentNode) host.parentNode.removeChild(host)
        resolve(ok)
      }
      function onKey (e) { if (e.key === 'Escape') { e.stopPropagation(); done(false) } }
      document.addEventListener('keydown', onKey, true)
      cancel.addEventListener('click', function () { done(false) })
      if (proceed) proceed.addEventListener('click', function () { done(true) })
      cancel.focus()
    })
  }

  // Common path: hold → evaluate → dialog → release or drop.
  function guard (event, files, deps, release, drop) {
    var policy = deps.getPolicy()
    if (!policy.enabled || !files || files.length === 0) return

    // Fast path: decide synchronously when no file needs a content read.
    var needsAsync = false
    var anyNameHit = false
    for (var i = 0; i < files.length; i++) {
      if (needsContentScan(files[i], policy)) needsAsync = true
      if (nameFindings(files[i], policy).length) anyNameHit = true
    }
    if (!needsAsync && !anyNameHit) return

    event.preventDefault()
    event.stopImmediatePropagation()

    evaluateFiles(files, deps).then(function (results) {
      var verdict = worstVerdict(results)
      if (verdict === 'allow') { release(); return }
      return showDialog(verdict, results, { appealUrl: deps.getAppealUrl && deps.getAppealUrl() }).then(function (proceed) {
        if (deps.onDecision) {
          results.forEach(function (r) {
            if (r.verdict === 'allow') return
            deps.onDecision({
              fileName: r.file && r.file.name,
              byCategory: r.byCategory,
              severity: r.findings.some(function (f) { return f.severity === 'high' }) ? 'high' : 'medium',
              actionTaken: proceed ? 'flagged' : 'blocked'
            })
          })
        }
        if (proceed) release()
        else drop()
      })
    }).catch(function () {
      // Fail open on internal errors — never leave the page's upload hung.
      release()
    })
  }

  function install (deps) {
    if (typeof document === 'undefined' || !released) return

    function isFileInput (t) {
      return t && t.tagName === 'INPUT' && String(t.type).toLowerCase() === 'file'
    }

    // <input type=file>: 'input' fires before 'change'; hold both, replay both.
    function onFileInputEvent (e) {
      var t = e.target
      if (!isFileInput(t) || released.has(e)) return
      if (e.type === 'input') {
        // Swallow only if the paired 'change' will be held; decided there.
        if (shouldHold(t.files)) e.stopImmediatePropagation()
        return
      }
      guard(e, t.files, deps, function () {
        var ie = new Event('input', { bubbles: true, composed: true })
        var ce = new Event('change', { bubbles: true })
        released.add(ie); released.add(ce)
        t.dispatchEvent(ie)
        t.dispatchEvent(ce)
      }, function () {
        try { t.value = '' } catch (err) { /* ignore */ }
      })
    }

    function shouldHold (files) {
      var policy = deps.getPolicy()
      if (!policy.enabled || !files) return false
      for (var i = 0; i < files.length; i++) {
        if (needsContentScan(files[i], policy) || nameFindings(files[i], policy).length) return true
      }
      return false
    }

    function onDrop (e) {
      if (released.has(e)) return
      var dt = e.dataTransfer
      if (!dt || !dt.files || dt.files.length === 0) return
      var target = e.target
      var files = Array.prototype.slice.call(dt.files)
      var init = { bubbles: true, cancelable: true, composed: true, clientX: e.clientX, clientY: e.clientY }
      guard(e, files, deps, function () {
        var copy = new DataTransfer()
        files.forEach(function (f) { copy.items.add(f) })
        init.dataTransfer = copy
        var replay = new DragEvent('drop', init)
        released.add(replay)
        target.dispatchEvent(replay)
      }, function () {})
    }

    function onPaste (e) {
      if (released.has(e)) return
      var cd = e.clipboardData
      if (!cd || !cd.files || cd.files.length === 0) return
      var target = e.target
      var files = Array.prototype.slice.call(cd.files)
      guard(e, files, deps, function () {
        var copy = new DataTransfer()
        files.forEach(function (f) { copy.items.add(f) })
        var replay = new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: copy })
        released.add(replay)
        target.dispatchEvent(replay)
      }, function () {})
    }

    document.addEventListener('input', onFileInputEvent, true)
    document.addEventListener('change', onFileInputEvent, true)
    document.addEventListener('drop', onDrop, true)
    document.addEventListener('paste', onPaste, true)
  }

  root.PromptShieldsFileGuard = {
    normalizePolicy: normalizePolicy,
    evaluateFile: evaluateFile,
    needsContentScan: needsContentScan,
    isTextLike: isTextLike,
    install: install,
    DEFAULT_NAME_PATTERNS: DEFAULT_NAME_PATTERNS
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : globalThis))
