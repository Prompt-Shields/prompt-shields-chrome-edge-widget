/**
 * Auth0 utility functions
 * Shared functions for Auth0 authentication
 */

/**
 * Generate a random nonce for OAuth flow
 * @param {number} length - Length of the nonce (default: 16)
 * @returns {string} Random nonce string
 */
export function generateNonce(length = 16) {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let nonce = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * charset.length);
    nonce += charset[randomIndex];
  }
  return nonce;
}

/**
 * Construct Auth0 authorization URL
 * @param {string} domain - Auth0 domain
 * @param {string} clientId - Auth0 client ID
 * @param {string} audience - Auth0 audience
 * @param {string} redirectUri - Redirect URI
 * @returns {string} Complete authorization URL
 */
export function constructAuthUrl(domain, clientId, audience, redirectUri) {
  return `https://${domain}/authorize?audience=${audience}&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=${encodeURIComponent('code')}&scope=${encodeURIComponent('openid profile email offline_access')}&nonce=${generateNonce()}`;
}

/**
 * Get browser-specific redirect URI
 * @returns {string} Redirect URI for the current browser
 */
export function getRedirectURI() {
  try {
    const redirectUrl = chrome.identity.getRedirectURL();
    console.log('Redirect URI from chrome.identity:', redirectUrl);
    return redirectUrl;
  } catch (error) {
    console.warn('Failed to get redirect URI:', error);
    // Fallback for Edge if needed
    if (navigator.userAgent.includes('Edg/')) {
      const extensionId = chrome.runtime.id;
      return `https://${extensionId}.chromiumapp.org`;
    }
    // Fallback for Chrome
    const extensionId = chrome.runtime.id;
    return `https://${extensionId}.chromiumapp.org`;
  }
}
