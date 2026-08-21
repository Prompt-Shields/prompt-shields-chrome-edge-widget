# Contributing to the PromptShields Browser Extension

Thanks for your interest in contributing.

## Before you start

- Read the [Code of Conduct](CODE_OF_CONDUCT.md).
- For security issues follow [SECURITY.md](SECURITY.md) — **never** open a public
  issue for a vulnerability.
- For anything beyond a small fix, open an issue first so we can agree on the
  approach.

## Development setup

```bash
npm install
cp src/config/config.example.js src/config/config.js   # then fill in your values
npm run dev                                            # Chrome
npm run dev:edge                                       # Edge
```

Load the built directory (`dist-chrome/` or `dist-edge/`) as an unpacked
extension — see [Getting Started](README.md#getting-started).

## Checks that must pass

```bash
npm test
npm run lint
npm run prod    # both browser targets must build
```

## Configuration is not a secret store

`src/config/config.js` is compiled into the extension bundle. Anyone who installs
the extension can read every value in it. The Auth0 client is a **public PKCE
client** — it has no client secret and must never be given one.

If a change requires a genuine secret, it belongs behind the backend API, not in
this repository. Pull requests that add a server-side key, signing secret, or
private credential to the extension bundle will be rejected.

Never commit `src/config/config.js` itself. Update
`src/config/config.example.js` instead when you add a configuration field, so
other contributors know the new key exists.

## Working on the content script

The extension injects into third-party pages it does not control, which
constrains what is acceptable:

- **Never modify a user's text without explicit approval.** The accept/reject
  step is the product's core promise, not a UI detail.
- **Do not capture focus or swallow events** on the host page.
- **Assume the host page's CSS is hostile.** Scope styles tightly; do not rely on
  inherited values or a particular stacking context.
- **Keep PII local where possible.** Be deliberate about what leaves the browser,
  and say so in the pull request when a change sends more than before.

## Adding a supported platform

New AI platforms need a host permission entry and a matching content-script
match pattern. Prefer a narrow, per-host pattern over `<all_urls>` — broad host
permissions make store review substantially harder.

## Coding conventions

- ES modules bundled with webpack; lint with ESLint (`npm run lint`).
- Business logic belongs in `src/core/services/`, not in DOM event handlers.
- Match the surrounding style rather than reformatting untouched code.

## Pull requests

1. Branch from `main` with a descriptive name (`fix/overlay-z-index`).
2. One concern per pull request.
3. Imperative commit subjects; explain *why* in the body.
4. Name the platforms and browsers you tested against — this extension's
   behaviour varies by host page.

By contributing, you agree that your contributions are licensed under the
Apache License 2.0.
