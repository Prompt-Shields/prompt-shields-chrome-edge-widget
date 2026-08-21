/**
 * Authentication Service Interface
 * Defines the contract for authentication operations
 * Implements Interface Segregation Principle (ISP)
 */

/**
 * @interface IAuthenticationService
 * Core authentication operations interface
 */
export class IAuthenticationService {
  /**
   * Authenticate user with OAuth provider
   * @returns {Promise<Object>} User data and credentials
   */
  async authenticate() {
    throw new Error('Method authenticate() must be implemented');
  }

  /**
   * Check if user is currently authenticated
   * @returns {Promise<boolean>} Authentication status
   */
  async isAuthenticated() {
    throw new Error('Method isAuthenticated() must be implemented');
  }

  /**
   * Get current user data
   * @returns {Promise<Object|null>} User data or null if not authenticated
   */
  async getCurrentUser() {
    throw new Error('Method getCurrentUser() must be implemented');
  }

  /**
   * Logout current user
   * @returns {Promise<void>}
   */
  async logout() {
    throw new Error('Method logout() must be implemented');
  }

  /**
   * Refresh authentication tokens
   * @returns {Promise<Object>} New credentials
   */
  async refreshTokens() {
    throw new Error('Method refreshTokens() must be implemented');
  }
}

/**
 * @interface ICredentialStorage
 * Credential storage operations interface
 */
export class ICredentialStorage {
  /**
   * Store credentials securely
   * @param {Object} credentials - Credentials to store
   * @returns {Promise<void>}
   */
  async storeCredentials(credentials) {
    throw new Error('Method storeCredentials() must be implemented');
  }

  /**
   * Retrieve stored credentials
   * @returns {Promise<Object|null>} Credentials or null if not found
   */
  async getCredentials() {
    throw new Error('Method getCredentials() must be implemented');
  }

  /**
   * Clear stored credentials
   * @returns {Promise<void>}
   */
  async clearCredentials() {
    throw new Error('Method clearCredentials() must be implemented');
  }

  /**
   * Check if credentials exist and are valid
   * @returns {Promise<boolean>} True if valid credentials exist
   */
  async hasValidCredentials() {
    throw new Error('Method hasValidCredentials() must be implemented');
  }
}

/**
 * @interface ITokenValidator
 * Token validation operations interface
 */
export class ITokenValidator {
  /**
   * Validate JWT token
   * @param {string} token - Token to validate
   * @returns {Promise<Object>} Validation result
   */
  async validateToken(token) {
    throw new Error('Method validateToken() must be implemented');
  }

  /**
   * Check if token is expired
   * @param {string} token - Token to check
   * @returns {Promise<boolean>} True if expired
   */
  async isTokenExpired(token) {
    throw new Error('Method isTokenExpired() must be implemented');
  }

  /**
   * Extract payload from JWT token
   * @param {string} token - JWT token
   * @returns {Promise<Object>} Token payload
   */
  async extractTokenPayload(token) {
    throw new Error('Method extractTokenPayload() must be implemented');
  }
}

/**
 * @interface IAuthenticationObserver
 * Observer pattern for authentication state changes
 */
export class IAuthenticationObserver {
  /**
   * Called when authentication state changes
   * @param {boolean} isAuthenticated - New authentication state
   * @param {Object|null} userData - User data if authenticated
   */
  onAuthenticationStateChanged(isAuthenticated, userData) {
    throw new Error('Method onAuthenticationStateChanged() must be implemented');
  }

  /**
   * Called when authentication error occurs
   * @param {Error} error - Authentication error
   */
  onAuthenticationError(error) {
    throw new Error('Method onAuthenticationError() must be implemented');
  }
}

/**
 * @interface IProfileService
 * User profile operations interface
 */
export class IProfileService {
  /**
   * Fetch user profile from API
   * @returns {Promise<Object|null>} User profile or null
   */
  async fetchProfile() {
    throw new Error('Method fetchProfile() must be implemented');
  }

  /**
   * Get cached user profile
   * @returns {Promise<Object|null>} Cached profile or null
   */
  async getCachedProfile() {
    throw new Error('Method getCachedProfile() must be implemented');
  }

  /**
   * Clear cached profile data
   * @returns {Promise<void>}
   */
  async clearProfile() {
    throw new Error('Method clearProfile() must be implemented');
  }
}

