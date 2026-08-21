/**
 * Build-time configuration template.
 *
 * Copy this file to `config.js` and fill in your own values:
 *
 *     cp src/config/config.example.js src/config/config.js
 *
 * `config.js` is gitignored — it holds real credentials and must never be
 * committed. Webpack reads the `CONFIGS` object below at build time and emits
 * ONLY the target environment's block to `dist-*/config/config.js`, so a
 * production build never contains your dev configuration.
 *
 * Note: everything here ships inside the extension bundle and is readable by
 * anyone who installs it. Do not put a server-side secret in this file. The
 * Auth0 client is a public PKCE client and has no client secret by design.
 */
const CONFIGS = {
  dev: {
    api: {
      // Hostname only — used to build the manifest's host_permissions entry.
      host: 'api-dev.example.com',
      // Full origin + any path prefix. Endpoint paths are appended to this.
      baseUrl: 'https://api-dev.example.com',
    },
    auth0: {
      domain: 'your-tenant.us.auth0.com',
      clientId: '',
      audience: 'your-api-audience',
    },
    analytics: {
      // Leave disabled unless you have your own analytics projects.
      enabled: false,
      googleAnalytics: { measurementId: '', apiSecret: '' },
      postHog: { apiKey: '', host: 'https://eu.i.posthog.com' },
      firebase: { apiKey: '', projectId: '', appId: '' },
    },
  },

  prod: {
    api: {
      host: 'api.example.com',
      baseUrl: 'https://api.example.com',
    },
    auth0: {
      domain: 'your-tenant.eu.auth0.com',
      clientId: '',
      audience: 'your-api-audience',
    },
    analytics: {
      enabled: false,
      googleAnalytics: { measurementId: '', apiSecret: '' },
      postHog: { apiKey: '', host: 'https://eu.i.posthog.com' },
      firebase: { apiKey: '', projectId: '', appId: '' },
    },
  },
};

// The redirect URI is derived at runtime from the extension ID
// (`chrome.identity.getRedirectURL()`), so it is not configured here. Register
// the resulting `https://<extension-id>.chromiumapp.org/` URL as an allowed
// callback in your Auth0 application.

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { CONFIGS };
}
