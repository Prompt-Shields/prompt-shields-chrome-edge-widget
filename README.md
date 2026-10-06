# PromptShields Browser Extension

A browser extension for **Chrome** and **Microsoft Edge** that protects sensitive data when interacting with AI platforms. PromptShields provides user-approved autocorrect suggestions, helping users identify and redact personally identifiable information (PII) before it is submitted to AI chatbots and assistants.

## Table of Contents

- [Overview](#overview)
- [Supported Platforms](#supported-platforms)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Build Commands](#build-commands)
- [Development Workflow](#development-workflow)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Authentication](#authentication)
- [Testing](#testing)
- [Linting](#linting)

## Overview

PromptShields works as a content script injected into supported AI platforms. When a user hovers over a text input field, an **Analyze** button appears. Clicking it presents a set of configurable suggestion categories (e.g., PII redaction, tone adjustment). The extension sends the text to the PromptShields API, which returns a suggested revision. The user can then accept or reject the change — nothing is modified without explicit approval.

### Key Features

- **On-device detection** — PII, prompt injection (direct and pasted-in), and hidden Unicode text, with no network call
- **Organisation confidential terms** — admin-defined terms and patterns; lightweight DLP that needs no Purview / data labelling
- **Upload guard** — flags confidential file names and scans text files for hidden instructions before they reach an AI site
- **Enterprise policy** — configure via Intune / GPO (`chrome.storage.managed`); point telemetry at an on-prem server or switch it off entirely
- **Coach or enforce** — `guideline` mode nudges users; `strict` mode redacts and blocks
- **On-page text analysis** with a non-intrusive hover-based UI
- **Configurable suggestion types** — create, edit, toggle, and reset categories from the Settings page
- **User-approved changes only** — suggested text must be explicitly accepted before any modification
- **Auth0 authentication** with OAuth2 PKCE flow
- **Profile and account management** including photo upload
- **Suggestion history** with infinite scroll and detail view
- **Multi-browser support** — separate builds for Chrome and Edge
- **Environment-aware builds** — dev and prod configurations with isolated API endpoints
- **Analytics integration** — PostHog, Firebase, and Google Analytics
- **Security hardened** — XSS protection, token validation, encrypted credential storage, strict CSP

## Supported Platforms

The extension activates on the following AI and productivity platforms:

| Platform | Platform | Platform |
|---|---|---|
| ChatGPT / OpenAI | Claude / Anthropic | Google Gemini |
| Microsoft Copilot | Perplexity AI | DeepSeek |
| Hugging Face | Poe | Character AI |
| You.com | Cohere | Stability AI |
| Jasper AI | Copy.ai | Writesonic |
| Midjourney | ElevenLabs | Synthesia |
| Grammarly | Notion | Runway ML |
| Replika | Murf AI | Fireflies AI |
| Fathom Video | GPTZero | Gradio apps |
| ScribeHow | Speechmatics | DeepMind |

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Browser Extension                  │
├──────────┬──────────┬──────────┬────────────────────┤
│  Popup   │ Content  │  Pages   │  Background        │
│  (UI)    │ Script   │ (Tabs)   │  (Service Worker)  │
│          │          │          │                     │
│ Login/   │ DOM      │ Settings │ Auth0 OAuth2        │
│ Logout   │ Highlight│ Account  │ Token management    │
│ Profile  │ Analyze  │ History  │ API proxy           │
│ Nav      │ Suggest  │          │ Suggestion types    │
│          │ Accept   │          │ Profile caching     │
└─────┬────┴─────┬────┴────┬─────┴──────────┬─────────┘
      │          │         │                │
      └──────────┴─────────┴────────────────┘
                         │
              CommunicationService
              (chrome.runtime messages)
                         │
                  PromptShields API
```

- **Background (Service Worker)** — handles authentication, token lifecycle, API requests, and cross-component messaging
- **Content Script** — injected into supported sites; manages DOM highlighting, the analyze flow, and text replacement
- **Popup** — quick access to login/logout, user info, and navigation to extension pages
- **Pages** — full-page tabs for Settings (suggestion type management), Account (profile/photo), and History (past suggestions)

## Prerequisites

- [Node.js](https://nodejs.org/) >= 16
- npm >= 8

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Create your build configuration

The extension reads credentials from `src/config/config.js`, which is gitignored.
Create it from the template and fill in your own values:

```bash
cp src/config/config.example.js src/config/config.js
```

At minimum set `api.host` / `api.baseUrl` to your backend and the `auth0` block
to your own Auth0 application. Analytics can stay disabled. See
[Configuration](#configuration) for what each field does.

> Everything in this file ships inside the extension bundle and is readable by
> anyone who installs it. Never put a server-side secret here — the Auth0 client
> is a public PKCE client and has no client secret.

### 3. Build

```bash

# Development build for Chrome
npm run dev

# Development build for Edge
npm run dev:edge

# Production build for both browsers
npm run prod
```

### Loading the Extension

**Chrome:**
1. Navigate to `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist-chrome` directory

**Edge:**
1. Navigate to `edge://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `dist-edge` directory

## Build Commands

| Command | Description |
|---|---|
| `npm run dev` | Clean + dev build for Chrome |
| `npm run dev:edge` | Clean + dev build for Edge |
| `npm run prod` | Clean + production build for both browsers |
| `npm run prod:chrome` | Clean + production build for Chrome only |
| `npm run prod:edge` | Clean + production build for Edge only |
| `npm run build:all` | Production build for Chrome and Edge |
| `npm run build:all:dev` | Development build for Chrome and Edge |
| `npm run build:complete` | Clean + build + verify for both browsers |
| `npm run watch` | Watch mode (development, default target) |
| `npm run watch:chrome` | Watch mode for Chrome |
| `npm run watch:edge` | Watch mode for Edge |
| `npm run clean` | Remove all dist directories |

### Build Targets and Environments

The webpack build accepts two parameters:

- **`target`** — `chrome` (default) or `edge`. Selects the appropriate manifest file.
- **`environment`** — `dev` or `prod`. Controls which API endpoints, Auth0 credentials, and analytics keys are embedded. Defaults to `dev` for development mode and `prod` for production mode.

```bash
# Explicit environment override
npx webpack --mode=production --env target=chrome --env environment=dev
```

Production builds strip the dev configuration entirely — only the selected environment's config is emitted to `dist-*/config/config.js`.

## Development Workflow

```bash
# Start a watch build for Chrome
npm run watch:chrome

# In another terminal, lint as you go
npm run lint:fix
```

1. Make changes in `src/`
2. Webpack rebuilds automatically
3. Go to `chrome://extensions/` and click the reload button on the extension card
4. Test on a supported AI platform

### Build Verification

After building, run the verification script to ensure all required files are present:

```bash
npm run verify:chrome
npm run verify:edge
```

## Project Structure

```
src/
├── analytics/                # Analytics system
│   ├── AnalyticsEvents.js    # Event name constants
│   ├── AnalyticsManager.js   # Multi-tracker orchestrator
│   ├── AnalyticsTracker.js   # Base tracker interface
│   ├── analyticsInit.js      # Initialization logic
│   ├── index.js              # Public API
│   └── trackers/             # Provider implementations
│       ├── ConsoleTracker.js
│       ├── FirebaseTracker.js
│       ├── GoogleAnalyticsTracker.js
│       └── PostHogTracker.js
├── config/
│   ├── config.js             # Unified config (all environments)
│   ├── config.dev.js          # Dev environment loader
│   ├── config.prod.js         # Prod environment loader
│   ├── messageTypes.js        # Chrome message type constants
│   └── securityConfig.js      # Security policy definitions
├── core/
│   ├── factories/
│   │   └── ServiceFactory.js
│   ├── interfaces/
│   │   └── IAuthenticationService.js
│   ├── models/
│   │   └── SuggestionTypeModel.js
│   ├── services/
│   │   ├── AuthenticationService.js
│   │   ├── EncryptionService.js
│   │   ├── LoggingService.js
│   │   ├── ProfileService.js
│   │   ├── SuggestionTypeService.js
│   │   └── TokenValidationService.js
│   └── storage/
│       └── PersistentCredentialStorage.js
├── pages/
│   ├── account.{html,css,js}  # Profile & photo management
│   ├── history.{html,css,js}  # Suggestion history viewer
│   └── settings.{html,css,js} # Suggestion type configuration
├── services/
│   ├── communicationService.js # Background script messaging
│   └── historyService.js       # History API client
├── utils/
│   ├── authUtils.js            # Auth helper functions
│   ├── browserCompatibility.js # Chrome/Edge API abstraction
│   ├── configLoader.js         # Runtime config loading
│   ├── domUtils.js             # DOM manipulation helpers
│   ├── secureHttpClient.js     # Authenticated HTTP client
│   ├── securityUtils.js        # Input sanitization
│   ├── tokenSecurity.js        # Token encryption/storage
│   └── xssProtection.js        # XSS prevention utilities
├── images/                     # Extension icons and assets
├── background.js               # Service worker entry point
├── content.js                  # Content script entry point
├── popup.{html,css,js}         # Browser action popup
├── style.css                   # Content script styles
├── manifest.json               # Base manifest
├── manifest-chrome.json        # Chrome-specific manifest
└── manifest-edge.json          # Edge-specific manifest
```

## Configuration

Configuration is centralized in `src/config/config.js` — gitignored, created by copying
[`src/config/config.example.js`](src/config/config.example.js). It contains
environment-specific blocks for `dev` and `prod`, each defining:

- **API** — protocol, host, and base URL for the PromptShields backend
- **Auth0** — domain, client ID, and audience
- **Analytics** — PostHog, Firebase, and Google Analytics credentials

At build time, webpack extracts only the target environment's configuration and generates a single-environment config file in the output directory. The source config file supports runtime environment detection (hostname, manifest name, extension ID) as a fallback.

### API Endpoints

The config system generates the following endpoints from the base URL:

| Endpoint Key | Path |
|---|---|
| `profileServiceUrl` | `/api/v2/profiles/` |
| `profilePhotoServiceUrl` | `/api/v2/profiles/photo` |
| `suggestionHistoryUrl` | `/api/v2/teams/{teamId}/suggestion_group/{suggestionGroupId}/suggestions` |
| `suggestionTypesServiceUrl` | `/api/v2/suggestion/types` |
| `suggestionProcessServiceUrl` | `/api/v2/suggestion/analyze/` |
| `suggestionTypesBaseUrl` | `/api/v2/suggestion-types` |
| `suggestionTypesByGroupUrl` | `/api/v2/suggestion-types/{suggestionTypeGroupId}` |
| `suggestionTypeByIdUrl` | `/api/v2/suggestion-types/{suggestionTypeGroupId}/suggestion-type-id/{suggestionTypeId}` |
| `suggestionTypeToggleUrl` | `/api/v2/suggestion-types/{suggestionTypeGroupId}/suggestion-type-id/{suggestionTypeId}/toggle` |
| `suggestionTypeResetUrl` | `/api/v2/suggestion-types/{suggestionTypeGroupId}/reset` |

Templated URLs (with `{param}` placeholders) can be resolved using `config.buildApiUrl(endpointKey, params)`.

## Enterprise Deployment

IT and security teams: see [docs/ENTERPRISE_DEPLOYMENT.md](docs/ENTERPRISE_DEPLOYMENT.md)
for what the extension does on each endpoint, every permission and outbound data
flow, on-premises / telemetry-off operation, Intune and GPO deployment, the full
policy reference (`src/managed_schema.json`), and known limits.

## Authentication

The extension uses **Auth0** with the OAuth2 authorization code flow via `chrome.identity.launchWebAuthFlow`. Tokens are encrypted and stored using `chrome.storage.local`. The background service worker manages the full token lifecycle including refresh and validation.

## Testing

```bash
# Content-script module tests (node:test, no browser needed)
npm run test:lib

# Run tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage
```

Tests use **Jest** with a jsdom environment. Coverage thresholds are set to 80% for branches, functions, lines, and statements.

## Linting

```bash
# Check for issues
npm run lint

# Auto-fix
npm run lint:fix
```

ESLint is configured via `.eslintrc.js` with Babel parser support.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Security

Report vulnerabilities privately — see [SECURITY.md](SECURITY.md). Please do not
open a public issue for a security problem.

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and
[NOTICE](NOTICE).
