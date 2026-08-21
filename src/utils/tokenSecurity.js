/**
 * Token Security utilities for PromptShields extension
 * Provides secure token handling, validation, and lifecycle management
 */

/**
 * Secure token manager with enhanced security features
 */
class SecureTokenManager {
  constructor() {
    this.tokens = new Map();
    this.tokenMetadata = new Map();
    this.maxTokenAge = 8 * 60 * 60 * 1000; // 8 hours
    this.refreshThreshold = 15 * 60 * 1000; // 15 minutes before expiry
    this.cleanupInterval = 30 * 60 * 1000; // 30 minutes

    this.setupPeriodicCleanup();
    this.setupContextInvalidationHandler();
  }

  /**
   * Store token securely with metadata
   * @param {string} tokenId - Unique token identifier
   * @param {string} token - JWT token
   * @param {Object} metadata - Token metadata
   */
  storeToken(tokenId, token, metadata = {}) {
    if (!tokenId || !token) {
      throw new Error('Token ID and token are required');
    }

    // Validate token format (basic JWT structure check)
    if (!this.isValidJWTFormat(token)) {
      throw new Error('Invalid JWT token format');
    }

    // Extract token payload for validation
    const payload = this.extractTokenPayload(token);
    if (!payload) {
      throw new Error('Unable to extract token payload');
    }

    // Store token with metadata
    this.tokens.set(tokenId, token);
    this.tokenMetadata.set(tokenId, {
      ...metadata,
      storedAt: Date.now(),
      expiresAt: payload.exp ? payload.exp * 1000 : Date.now() + this.maxTokenAge,
      lastValidated: Date.now(),
      usage: 0
    });

    console.log(`Token ${tokenId} stored securely`);
  }

  /**
   * Retrieve token with validation
   * @param {string} tokenId - Token identifier
   * @returns {string|null} Token or null if invalid/expired
   */
  getToken(tokenId) {
    if (!tokenId || !this.tokens.has(tokenId)) {
      return null;
    }

    const token = this.tokens.get(tokenId);
    const metadata = this.tokenMetadata.get(tokenId);

    // Check if token is expired
    if (this.isTokenExpired(metadata)) {
      console.log(`Token ${tokenId} expired, removing`);
      this.removeToken(tokenId);
      return null;
    }

    // Update usage statistics
    metadata.usage++;
    metadata.lastAccessed = Date.now();

    return token;
  }

  /**
   * Check if token needs refresh
   * @param {string} tokenId - Token identifier
   * @returns {boolean} True if token needs refresh
   */
  needsRefresh(tokenId) {
    if (!tokenId || !this.tokenMetadata.has(tokenId)) {
      return true;
    }

    const metadata = this.tokenMetadata.get(tokenId);
    const timeUntilExpiry = metadata.expiresAt - Date.now();

    return timeUntilExpiry <= this.refreshThreshold;
  }

  /**
   * Validate token format (basic JWT structure)
   * @param {string} token - Token to validate
   * @returns {boolean} True if valid format
   */
  isValidJWTFormat(token) {
    if (typeof token !== 'string') {
      return false;
    }

    const parts = token.split('.');
    if (parts.length !== 3) {
      return false;
    }

    // Check if each part is valid base64url
    return parts.every(part => {
      try {
        // Basic base64url validation
        const base64 = part.replace(/-/g, '+').replace(/_/g, '/');
        const padding = '='.repeat((4 - base64.length % 4) % 4);
        atob(base64 + padding);
        return true;
      } catch {
        return false;
      }
    });
  }

  /**
   * Extract payload from JWT token
   * @param {string} token - JWT token
   * @returns {Object|null} Token payload or null
   */
  extractTokenPayload(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return null;
      }

      const payload = parts[1];
      const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const padding = '='.repeat((4 - base64.length % 4) % 4);
      const decoded = atob(base64 + padding);

      return JSON.parse(decoded);
    } catch (error) {
      console.warn('Failed to extract token payload:', error);
      return null;
    }
  }

  /**
   * Check if token is expired
   * @param {Object} metadata - Token metadata
   * @returns {boolean} True if expired
   */
  isTokenExpired(metadata) {
    if (!metadata) {
      return true;
    }

    const now = Date.now();

    // Check explicit expiration
    if (metadata.expiresAt && now >= metadata.expiresAt) {
      return true;
    }

    // Check storage age
    if (now - metadata.storedAt >= this.maxTokenAge) {
      return true;
    }

    return false;
  }

  /**
   * Remove token and its metadata
   * @param {string} tokenId - Token identifier
   */
  removeToken(tokenId) {
    if (this.tokens.has(tokenId)) {
      // Securely clear token
      const token = this.tokens.get(tokenId);
      if (typeof token === 'string') {
        // Overwrite token in memory (best effort)
        this.tokens.set(tokenId, '');
      }

      this.tokens.delete(tokenId);
      this.tokenMetadata.delete(tokenId);

      console.log(`Token ${tokenId} removed securely`);
    }
  }

  /**
   * Clear all tokens
   */
  clearAllTokens() {
    // Securely clear all tokens
    for (const [tokenId, token] of this.tokens.entries()) {
      if (typeof token === 'string') {
        this.tokens.set(tokenId, '');
      }
    }

    this.tokens.clear();
    this.tokenMetadata.clear();

    console.log('All tokens cleared securely');
  }

  /**
   * Get token statistics
   * @param {string} tokenId - Token identifier
   * @returns {Object|null} Token statistics
   */
  getTokenStats(tokenId) {
    if (!this.tokenMetadata.has(tokenId)) {
      return null;
    }

    const metadata = this.tokenMetadata.get(tokenId);
    const now = Date.now();

    return {
      tokenId,
      age: now - metadata.storedAt,
      timeUntilExpiry: metadata.expiresAt - now,
      usage: metadata.usage,
      lastAccessed: metadata.lastAccessed,
      needsRefresh: this.needsRefresh(tokenId),
      isExpired: this.isTokenExpired(metadata)
    };
  }

  /**
   * Setup periodic cleanup of expired tokens
   */
  setupPeriodicCleanup() {
    setInterval(() => {
      const expiredTokens = [];

      for (const [tokenId, metadata] of this.tokenMetadata.entries()) {
        if (this.isTokenExpired(metadata)) {
          expiredTokens.push(tokenId);
        }
      }

      expiredTokens.forEach(tokenId => {
        console.log(`Periodic cleanup: removing expired token ${tokenId}`);
        this.removeToken(tokenId);
      });

      if (expiredTokens.length > 0) {
        console.log(`Periodic cleanup: removed ${expiredTokens.length} expired tokens`);
      }
    }, this.cleanupInterval);
  }

  /**
   * Setup handler for extension context invalidation
   */
  setupContextInvalidationHandler() {
    // Listen for extension context invalidation
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', () => {
        this.clearAllTokens();
      });

      window.addEventListener('error', (event) => {
        if (event.error && event.error.message &&
          event.error.message.includes('Extension context invalidated')) {
          console.warn('Extension context invalidated, clearing all tokens');
          this.clearAllTokens();
        }
      });
    }

    // For service worker context
    if (typeof self !== 'undefined' && typeof chrome !== 'undefined') {
      chrome.runtime.onSuspend?.addListener(() => {
        console.log('Extension suspending, clearing tokens');
        this.clearAllTokens();
      });
    }
  }

  /**
   * Validate token against current time and usage patterns
   * @param {string} tokenId - Token identifier
   * @returns {Object} Validation result
   */
  validateToken(tokenId) {
    if (!tokenId || !this.tokens.has(tokenId)) {
      return { valid: false, reason: 'Token not found' };
    }

    const token = this.tokens.get(tokenId);
    const metadata = this.tokenMetadata.get(tokenId);

    // Check expiration
    if (this.isTokenExpired(metadata)) {
      return { valid: false, reason: 'Token expired' };
    }

    // Check token format
    if (!this.isValidJWTFormat(token)) {
      return { valid: false, reason: 'Invalid token format' };
    }

    // Check payload
    const payload = this.extractTokenPayload(token);
    if (!payload) {
      return { valid: false, reason: 'Invalid token payload' };
    }

    // Check standard JWT claims
    const now = Math.floor(Date.now() / 1000);

    if (payload.exp && payload.exp <= now) {
      return { valid: false, reason: 'Token expired (exp claim)' };
    }

    if (payload.nbf && payload.nbf > now) {
      return { valid: false, reason: 'Token not yet valid (nbf claim)' };
    }

    if (payload.iat && payload.iat > now + 300) { // 5 minute clock skew allowance
      return { valid: false, reason: 'Token issued in future (iat claim)' };
    }

    return { valid: true, payload };
  }
}

// Create singleton instance
const secureTokenManager = new SecureTokenManager();

// Export for ES6 modules
export { SecureTokenManager, secureTokenManager };

// Export for CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SecureTokenManager, secureTokenManager };
}

// Global browser export
if (typeof window !== 'undefined') {
  window.PromptShieldsTokenSecurity = { SecureTokenManager, secureTokenManager };
}

