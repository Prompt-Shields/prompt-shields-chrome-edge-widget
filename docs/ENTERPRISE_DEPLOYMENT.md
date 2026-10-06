# Enterprise Deployment Guide

For IT and security teams evaluating or rolling out the PromptShields browser
extension on managed Chrome and Edge. This guide covers:

1. [What the extension does on each endpoint](#1-what-runs-on-the-endpoint)
2. [Permissions, and why each is needed](#2-permissions)
3. [What data leaves the device](#3-what-data-leaves-the-device)
4. [On-premises and cloud-free operation](#4-on-premises-and-cloud-free-operation)
5. [Deploying with Intune or Group Policy](#5-deploying-with-intune-or-group-policy)
6. [Policy reference](#6-policy-reference)
7. [Lightweight DLP without data labelling](#7-lightweight-dlp-without-data-labelling)
8. [Rollout: coach first, enforce later](#8-rollout-coach-first-enforce-later)
9. [Limits](#9-limits)

---

## 1. What runs on the endpoint

The extension is a standard Manifest V3 browser extension. It has no native
component, installs no drivers or services, and needs no admin rights on the
device beyond what your browser-management tool already uses.

| Component | Where it runs | What it does |
|---|---|---|
| Content scripts (`lib/*.js`, `content.js`) | Only inside tabs on the AI sites listed in the manifest (ChatGPT, Claude, Gemini, Copilot, DeepSeek, Perplexity, …) | Scans text typed or pasted into the page's input fields, and files uploaded to the page, **locally** |
| Service worker (`background.js`) | Browser background | Holds configuration, reads enterprise policy, handles sign-in, optionally sends anonymised telemetry |
| Popup and settings pages | Opened by the user | Sign-in, account, settings, history |

All detection runs on the device, in JavaScript, with no model download or
network call:

- **PII detection**: email, phone, card numbers (Luhn-checked), IBAN, national
  IDs, API keys and tokens, IP addresses, amounts, names.
- **Prompt-injection detection**: phrasing that tries to override an AI's
  instructions ("ignore all previous instructions", "reveal your system
  prompt", chat-template tokens). It catches injection typed directly and,
  more often, injection hidden in an email, web page or document the user
  pastes in.
- **Hidden-text detection**: invisible Unicode a model reads but a person
  can't see: tag characters (the hidden message is decoded and shown to the
  user), zero-width runs and bidirectional overrides.
- **Organisation confidential terms**: your own rules (see
  [§7](#7-lightweight-dlp-without-data-labelling)).
- **Upload guard**: checks files uploaded to AI sites for confidential file
  names and, for text files, the content checks above.

Measured cost: detection runs on a 30 ms debounce after typing stops. It skips
inputs over 50,000 characters (PII) or 200,000 characters (injection and custom
rules), so a huge paste won't freeze the page.

## 2. Permissions

| Permission | Why |
|---|---|
| `storage` | Saves settings, the offline telemetry queue and the device's random install ID. Also lets the extension read **enterprise policy** (`storage.managed_schema`) |
| `alarms` | Runs the 1-minute policy refresh and the 5-minute telemetry flush, which survive service-worker restarts |
| `activeTab` | Lets the popup work with the current tab |
| `identity`, `identity.email` | Sign-in (OAuth 2 PKCE via `chrome.identity.launchWebAuthFlow`). Only needed for the optional server-side "Analyze" suggestions and chat. Local protection works without sign-in |
| Host permissions: listed AI sites | Injects the content scripts. The extension can't read or change any other site |
| Host permission: your API host | Calls your configured PromptShields API (set at build time) |

The extension doesn't request `<all_urls>`, `webRequest`, `downloads`,
`nativeMessaging`, `history`, `cookies` or `clipboardRead`.

## 3. What data leaves the device

By default, **nothing from detection leaves the device**. Each outbound flow
below is opt-in and points at a destination you configure.

| Flow | When | What is sent | Destination |
|---|---|---|---|
| Detection telemetry | Only if `telemetryUrl` + `apiKey` are set, and `telemetryDisabled` is not `true` | SHA-256 hash of the prompt (or of the file name, for uploads), per-category counts (e.g. `{"creditCard":1}`), action taken, severity, AI-site ID (`chatgpt`, `claude`, …), random install ID, page-visit ID, timestamp. **Never the prompt text, matched values or file contents** | Your `telemetryUrl` |
| Policy refresh | Only if `policyEndpoint` + `apiKey` are set | A `GET` with the API key. No user data | Your `policyEndpoint` |
| "Analyze" suggestions | Only when a signed-in user clicks **Analyze** | The text of that input | `api.baseUrl` (build-time) |
| In-page chat | Only when a signed-in user uses the chat panel | The question, plus page context with PII redacted first | `api.baseUrl` (build-time) |
| Sign-in | When the user signs in | Standard OAuth 2 PKCE | Your Auth0 tenant (build-time) |
| Product analytics | Only if enabled in the build config (disabled in `config.example.js`) | Usage events | PostHog / Firebase / GA, as configured |

Note on hashes: a SHA-256 hash of a short or predictable prompt can be matched
by guessing candidate prompts, so treat hashes as pseudonymous, not anonymous.
If that isn't acceptable, set `telemetryDisabled: true`.

## 4. On-premises and cloud-free operation

Every network destination is something you configure. Nothing is hard-wired to
a PromptShields-hosted service.

**Fully local (no telemetry).** Push `"telemetryDisabled": true` by policy. All
detection, coaching, redaction and upload checks keep working, and the
extension reports nothing. Leave `policyEndpoint` unset and it polls nothing
either. This is the right first step for a pilot
when you don't want any metadata leaving the network.

**Self-hosted telemetry and console.** Run the Atlas backend on your own
servers (Docker) and point the policy URLs at it:

```json
{
  "policyEndpoint": "https://atlas.corp.internal/api/v1/policies",
  "telemetryUrl":   "https://atlas.corp.internal/api/v1/telemetry/prompt-events",
  "apiKey":         "<org API key issued by your Atlas instance>"
}
```

**Self-hosted API and identity.** The "Analyze" and chat features call
`api.baseUrl` and use Auth0 for sign-in. Both are set at build time in
`src/config/config.js`. You can build your own package that points at an
internal API. Auth0 is a cloud identity provider, so if you need sign-in to
stay fully on-premises, leave these features unused: local protection doesn't
depend on them.

Policy set through enterprise management always overrides local settings, so
users can't point telemetry somewhere else or turn `telemetryDisabled` off.

## 5. Deploying with Intune or Group Policy

Deployment has two parts: **force-install** the extension, then **configure** it
with an extension policy. Replace `<extension-id>` with the ID shown on the
store listing, or on `edge://extensions` / `chrome://extensions` for a
self-hosted package.

### 5.1 Force-install

**Microsoft Edge (Intune):** *Devices → Configuration → Create → Settings
catalog → Microsoft Edge → Extensions → "Control which extensions are installed
silently"* (`ExtensionInstallForcelist`), value:

```
<extension-id>;https://edge.microsoft.com/extensionwebstorebase/v1/crx
```

**Google Chrome (Intune / GPO):** `ExtensionInstallForcelist`, value:

```
<extension-id>;https://clients2.google.com/service/update2/crx
```

For a self-hosted package, use the URL of your own update manifest instead.

### 5.2 Configure (extension policy)

The extension publishes a policy schema (`managed_schema.json`), so
browser-management tools can set its options directly.

**Windows (registry, deployable via Intune platform script, Remediations, or
GPO Preferences):**

```
Edge:   HKLM\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\<extension-id>\policy
Chrome: HKLM\SOFTWARE\Policies\Google\Chrome\3rdparty\extensions\<extension-id>\policy
```

String and boolean options are plain `REG_SZ` / `REG_DWORD` values. List and
object options (`customRules`, `fileGuard`) are `REG_SZ` values holding JSON.
Example PowerShell for Edge:

```powershell
$id  = '<extension-id>'
$key = "HKLM:\SOFTWARE\Policies\Microsoft\Edge\3rdparty\extensions\$id\policy"
New-Item -Path $key -Force | Out-Null
Set-ItemProperty -Path $key -Name enforcementMode   -Value 'guideline'
Set-ItemProperty -Path $key -Name telemetryDisabled -Value 1 -Type DWord
Set-ItemProperty -Path $key -Name appealUrl         -Value 'https://servicedesk.corp.internal/ai-exception'
Set-ItemProperty -Path $key -Name customRules -Value (@(
  @{ id = 'falcon'; label = 'Project Falcon'; pattern = 'Project Falcon' },
  @{ id = 'ctr';    label = 'Contract ID';    pattern = 'CTR-\d{4}-\d{3}'; regex = $true; caseSensitive = $true }
) | ConvertTo-Json -Compress)
```

**macOS (configuration profile):** a custom-settings payload for the preference
domain `com.microsoft.Edge.extensions.<extension-id>` (Edge) or
`com.google.Chrome.extensions.<extension-id>` (Chrome), with the keys from
[§6](#6-policy-reference).

**Verify.** Open `edge://policy` or `chrome://policy` on a test device. The
extension's policies appear under its ID, and any value that doesn't match the
schema is flagged there. When the browser picks up a policy change (on its
normal refresh, or after **Reload policies** on that page), open tabs apply it
without a restart.

## 6. Policy reference

| Key | Type | Default | Purpose |
|---|---|---|---|
| `enforcementMode` | `"guideline"` \| `"strict"` | `guideline` | `guideline` coaches and lets the user decide. `strict` redacts automatically and blocks flagged uploads |
| `telemetryDisabled` | boolean | `false` | `true` means no event ever leaves the device |
| `policyEndpoint` | string (URL) | — | Atlas `GET /api/v1/policies` |
| `telemetryUrl` | string (URL) | — | Atlas `POST /api/v1/telemetry/prompt-events` |
| `violationsUrl` | string (URL) | — | Legacy `POST /api/v1/policies/violations` |
| `apiKey` | string | — | Organisation key for the URLs above |
| `appealUrl` | string (URL) | — | "Request an exception" link shown when something is blocked |
| `injectionDetection` | boolean | `true` | Prompt-injection and hidden-text detection |
| `customRules` | array | `[]` | Organisation confidential terms (see §7) |
| `fileGuard` | object | `{ "enabled": true }` | Upload guard (see §7) |

`customRules[]` items:

| Field | Type | Default | Notes |
|---|---|---|---|
| `pattern` | string | (required) | Literal term, or a JavaScript regular expression when `regex` is `true` |
| `id` | string | `rule<n>` | Stable ID, used in the default redaction tag. Telemetry counts all rules as `confidentialTerm` |
| `label` | string | `Confidential term` | Shown to the user |
| `regex` | boolean | `false` | Literal terms match whole words |
| `caseSensitive` | boolean | `false` | |
| `severity` | `low` \| `medium` \| `high` | `high` | |
| `tip` | string | (generic) | Coaching text shown under the finding |
| `redaction` | string | `[REDACTED-<ID>]` | Replacement text |

`fileGuard` fields:

| Field | Type | Default | Notes |
|---|---|---|---|
| `enabled` | boolean | `true` | |
| `scanContents` | boolean | `true` | Read text-type files (`.txt .md .csv .json .html .xml .eml` …) and run the content checks |
| `maxScanBytes` | integer | `2097152` | Larger files are checked by name only |
| `blockedNamePatterns` | string[] | built-in list | Regular expressions matched against the file name. Replaces the built-in list |
| `allowedNamePatterns` | string[] | `[]` | Matching names are never flagged by name |

Invalid entries (a regex that doesn't compile, a rule with no pattern, a value
of the wrong type) are dropped one at a time. One typo can't switch off the
rest of your policy.

Rules come from your administrators and are trusted. Keep regular expressions
simple: a pathological pattern can slow the page it runs on.

## 7. Lightweight DLP without data labelling

Labelling every document (Purview / MIP, DSPM) takes time. The extension gives
you useful protection on day one, without waiting for that work.

**Confidential terms.** List what "confidential" means for your organisation:
project code names, key client names, document-number formats,
classification markings. Users are coached, or in `strict` mode the term is
redacted, before the prompt is sent:

```json
"customRules": [
  { "id": "falcon", "label": "Project Falcon", "pattern": "Project Falcon",
    "tip": "Falcon is under NDA. Refer to it as 'the project'." },
  { "id": "client-acme", "label": "Client name", "pattern": "ACME Holdings" },
  { "id": "ctr", "label": "Contract number", "pattern": "CTR-\\d{4}-\\d{3}", "regex": true, "caseSensitive": true },
  { "id": "marking", "label": "Classification marking", "pattern": "(?:STRICTLY )?CONFIDENTIAL|INTERNAL USE ONLY", "regex": true, "caseSensitive": true }
]
```

**Upload guard.** When a user uploads, drags in or pastes a file into an AI
site:

- A file whose **name** carries a confidentiality marking is flagged. The
  built-in list covers English, French, German, Dutch and Spanish:
  *confidential, confidentiel, vertraulich, vertrouwelijk, confidencial,
  secret, geheim, restricted, internal only, strictly private*.
- A **text file** is read locally and checked for hidden AI instructions,
  invisible text, your confidential terms (those with `high` severity, the
  default) and high-severity PII (card
  numbers, IBANs, national IDs, credentials). Ordinary names and emails in a
  CSV don't trigger a warning: nagging on routine data trains people to click
  through.
- In `guideline` mode the user sees what was found and can cancel or upload
  anyway. In `strict` mode the upload is blocked, and the dialog offers the
  `appealUrl` link.

If Purview labelling is in place later, these rules keep working alongside it.

## 8. Rollout: coach first, enforce later

Teams that switch straight to hard blocking often roll it back within weeks
because of false-positive complaints. We recommend:

1. **Pilot, local only.** `enforcementMode: guideline`, `telemetryDisabled: true`,
   with a small group. Gather feedback on findings that are noise.
2. **Tune.** Add your `customRules`, adjust `blockedNamePatterns` /
   `allowedNamePatterns`.
3. **Measure (optional).** Point telemetry at your self-hosted Atlas to see
   which categories and AI sites matter.
4. **Enforce selectively.** Move to `strict` once the false-positive rate is
   acceptable, and publish an `appealUrl`.

## 9. Limits

These are honest boundaries of a browser extension. Plan around them.

- **No folder or file-system metadata.** A browser exposes only a file's name,
  type, size and contents, not the folder or share it came from or its NTFS
  permissions. Rules like "anything from `\\fs01\Confidential`" need the
  desktop agent. Renaming a file defeats a name-based rule; content rules
  still apply to text files.
- **Binary documents are checked by name only.** PDF, Word, Excel,
  PowerPoint and images are not parsed in the browser today.
- **Covered sites only.** Protection applies to the AI sites listed in the
  manifest. Desktop AI apps, and browsers without the extension, are out of
  scope. Use your browser and app-control policies to steer users to managed
  Edge/Chrome.
- **Mobile.** This extension runs on desktop Chrome and Edge. Edge and Chrome
  on iOS and Android don't run it. For managed mobile devices, use Intune App
  Protection Policies (for example, restrict copy/paste and "open in" from
  managed apps to unmanaged AI apps). PromptShields' SDK/API can protect
  in-house AI apps on any platform.
- **Heuristic detection.** PII detection favours recall: it will sometimes flag
  harmless text, which is why `guideline` mode exists. Injection detection
  favours precision: it catches common phrasings and hidden-character tricks,
  not every possible paraphrase. Treat it as one layer of defence, not the
  only one.
- **Users with local admin rights** can remove or disable an extension that
  isn't force-installed. Force-install via policy (§5.1) prevents that.
