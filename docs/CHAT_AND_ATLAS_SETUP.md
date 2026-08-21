# Chat + Atlas Setup (Chrome/Edge)

The Safari `lib/` features ported into this extension (PII detection, issue sidebar,
in-page AI chat, Atlas telemetry) need two pieces of backend wiring before the chat
and telemetry paths are live. PII detection, the redaction tooltip, and the issue
sidebar work **without** any of this — they run purely client-side.

---

## 1. In-page AI chat

### Endpoint

The chat endpoint is defined in `webpack.config.js` → `buildApiEndpoints()`:

```js
chat: `${baseUrl}/api/v2/chat`,
```

`baseUrl` comes from the build-time `src/config/config.js` (gitignored). At runtime
the background service worker resolves it via:

```js
serviceConfig.getApiUrl('chat')   // → https://<your-api-host>/api/v2/chat
```

No code change is needed to point at a different host — set `api.baseUrl` in your
build config.

### Request flow

```
chat-panel.js (FAB/panel)
  → page-extractor.js   (page context)
  → chat-redactor.js    (redact PII before sending)
  → chat-client.js      opens a 'chat-stream' Port, posts { type: 'CHAT_REQUEST', payload }
  → background.js        chat-stream handler:
        token = (await getCredentials()).accessToken   // Auth0 access token
        fetch(getApiUrl('chat'), { Authorization: `Bearer ${token}`, Accept: text/event-stream })
        streams the SSE body back over the Port as { sse } / { closed } / { error }
  → chat-client.js parses SSE → chat-panel.js renders Thinking disclosure + answer
```

The user must be **logged in** (Auth0) for chat to work — the handler posts
`{ error: 'Not authenticated' }` if no access token is available.

### SSE stream contract

The endpoint must return `text/event-stream`. Named events consumed by
`chat-client.js`:

| Event name | Data payload                                          |
|------------|-------------------------------------------------------|
| `thinking` | `{ delta: "<string>" }` — incremental thinking token  |
| `text`     | `{ delta: "<string>" }` — incremental answer token    |
| `done`     | `{ thinkingMs?: <number> }` — stream complete         |
| `error`    | `{ message: "<string>" }` — stream-level error        |

---

## 2. Atlas telemetry (dormant by default)

Atlas policy-bundle + violation/telemetry reporting (`lib/atlas-bundle.js`,
`lib/violation-reporter.js`) is **off until you configure it**. Reporting is gated on
`endpoint`/`apiKey` being non-empty (`lib/content-prescan.js` and the reporter's
fail-open guards), so with empty values nothing is sent and no failed network calls
occur.

### Config keys (chrome.storage.local)

Atlas reads its config from `chrome.storage.local`, **not** from the `Config` class.
The keys are seeded empty on install by `src/background.js`:

| Key                      | Meaning                                                    |
|--------------------------|------------------------------------------------------------|
| `atlas.endpoint`         | Legacy policy/violations URL (e.g. `https://…/api/v1/policies/violations`) |
| `atlas.apiKey`           | API key sent as `Authorization: Bearer …` / `X-API-Key`    |
| `atlas.violationsUrl`    | Violations ingest URL                                       |
| `atlas.telemetryUrl`     | Telemetry (prompt-events) ingest URL                        |
| `atlas.enforcementMode`  | `guideline` (log + coach) or `strict`. Not a URL.           |
| `atlas.appealUrl`        | User-facing appeal URL. Not a URL endpoint for the API.     |

### How to populate

Send a `setAtlasConfig` runtime message to the background service worker (handled in
`lib/atlas-bundle.js`), e.g. from the popup or an admin/options page:

```js
chrome.runtime.sendMessage({
  type: 'setAtlasConfig',
  config: {
    endpoint: 'https://atlas.example.com/api/v1/policies/violations',
    apiKey: 'YOUR_ATLAS_API_KEY',
    violationsUrl: 'https://atlas.example.com/api/v1/violations',
    telemetryUrl: 'https://atlas.example.com/api/v1/telemetry/prompt-events',
    enforcementMode: 'guideline',
    appealUrl: 'https://atlas.example.com/appeal',
  },
});
```

`atlas-bundle.js` writes these to `chrome.storage.local`, polls the policy bundle,
and pushes a `configUpdate` to every open tab.

### host_permissions — required before Atlas can reach the network

The Atlas/telemetry hosts are **not** in `manifest-chrome.json` / `manifest-edge.json`
`host_permissions` (they are deployment-specific and unknown at port time). Until the
host(s) you set above are added to `host_permissions` in **both** manifests, the
service worker's `fetch` to them will be blocked by Chrome. Add, for example:

```json
"host_permissions": [
  "...",
  "https://atlas.example.com/*"
]
```

(The chat endpoint does not need this — `{baseUrl}/api/v2/chat` is already covered by
the existing `https://__API_HOST__/*` host permission and the extension-page CSP
`connect-src` entry.)

---

## Summary checklist

- [ ] Set `api.baseUrl` in the build config so `getApiUrl('chat')` resolves to your API.
- [ ] Ensure the chat endpoint returns the SSE contract above and accepts the Auth0 bearer token.
- [ ] (Optional) Provide real Atlas config via `setAtlasConfig` to enable telemetry.
- [ ] (If Atlas enabled) Add the Atlas host(s) to `host_permissions` in both manifests.
