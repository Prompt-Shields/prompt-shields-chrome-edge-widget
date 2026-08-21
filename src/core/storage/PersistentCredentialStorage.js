/**
 * Persistent Credential Storage Implementation
 * Provides secure, persistent storage for authentication credentials
 * Implements Single Responsibility Principle (SRP) and Dependency Inversion Principle (DIP)
 */

import { ICredentialStorage } from '../interfaces/IAuthenticationService.js';
import { securityPolicy } from '../../config/securityConfig.js';

/**
 * Persistent credential storage using Chrome extension storage API
 * Implements hybrid approach: memory cache + encrypted persistent storage
 */
export class PersistentCredentialStorage extends ICredentialStorage {
  constructor(encryptionService, logger) {
    super();
    this.encryptionService = encryptionService;
    this.logger = logger;
    this.memoryCache = new Map();
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutes memory cache
    this.storageKey = 'ps_encrypted_credentials';
    this.metadataKey = 'ps_credential_metadata';

    this.setupStorageListeners();
  }

  /**
   * Store credentials with encryption and memory caching
   * @param {Object} credentials - Credentials to store
   * @returns {Promise<void>}
   */
  async storeCredentials(credentials) {
    try {
      if (!credentials || !this.validateCredentials(credentials)) {
        throw new Error('Invalid credentials provided');
      }

      // Encrypt credentials for persistent storage
      const encryptedData = await this.encryptionService.encrypt(JSON.stringify(credentials));

      // Create metadata
      const metadata = {
        timestamp: Date.now(),
        expiresAt: this.calculateExpirationTime(credentials),
        version: '1.0',
        checksum: await this.calculateChecksum(credentials)
      };

      // Store in Chrome extension storage (persistent)
      await chrome.storage.local.set({
        [this.storageKey]: encryptedData,
        [this.metadataKey]: metadata
      });

      // Cache in memory for quick access
      this.memoryCache.set('credentials', {
        data: credentials,
        timestamp: Date.now(),
        metadata
      });

      this.logger.info('Credentials stored successfully', {
        hasAccessToken: !!credentials.accessToken,
        expiresAt: metadata.expiresAt
      });

    } catch (error) {
      this.logger.error('Failed to store credentials', error);
      securityPolicy.recordViolation('credential_storage_error', { error: error.message });
      throw new Error('Failed to store credentials securely');
    }
  }

  /**
   * Retrieve credentials with automatic validation and refresh
   * @returns {Promise<Object|null>} Credentials or null if not found/invalid
   */
  async getCredentials() {
    try {
      // Check memory cache first
      const cached = this.memoryCache.get('credentials');
      if (cached && this.isCacheValid(cached)) {
        this.logger.debug('Credentials retrieved from memory cache');
        return cached.data;
      }

      // Retrieve from persistent storage
      const result = await chrome.storage.local.get([this.storageKey, this.metadataKey]);

      if (!result[this.storageKey] || !result[this.metadataKey]) {
        this.logger.debug('No credentials found in persistent storage');
        return null;
      }

      const metadata = result[this.metadataKey];

      // Check if credentials are expired
      if (this.isExpired(metadata)) {
        this.logger.info('Stored credentials expired, clearing');
        await this.clearCredentials();
        return null;
      }

      // Decrypt credentials
      const decryptedData = await this.encryptionService.decrypt(result[this.storageKey]);
      const credentials = JSON.parse(decryptedData);

      // Validate integrity
      const currentChecksum = await this.calculateChecksum(credentials);
      if (currentChecksum !== metadata.checksum) {
        this.logger.warn('Credential integrity check failed');
        securityPolicy.recordViolation('credential_integrity_failure', {
          expected: metadata.checksum,
          actual: currentChecksum
        });
        await this.clearCredentials();
        return null;
      }

      // Update memory cache
      this.memoryCache.set('credentials', {
        data: credentials,
        timestamp: Date.now(),
        metadata
      });

      this.logger.debug('Credentials retrieved from persistent storage');
      return credentials;

    } catch (error) {
      this.logger.error('Failed to retrieve credentials', error);
      // Don't expose internal errors
      return null;
    }
  }

  /**
   * Clear all stored credentials
   * @returns {Promise<void>}
   */
  async clearCredentials() {
    try {
      // Clear persistent storage
      await chrome.storage.local.remove([this.storageKey, this.metadataKey]);

      // Clear memory cache
      this.memoryCache.clear();

      this.logger.info('Credentials cleared successfully');

    } catch (error) {
      this.logger.error('Failed to clear credentials', error);
      throw new Error('Failed to clear credentials');
    }
  }

  /**
   * Check if valid credentials exist
   * @returns {Promise<boolean>} True if valid credentials exist
   */
  async hasValidCredentials() {
    try {
      const credentials = await this.getCredentials();
      return credentials !== null && this.validateCredentials(credentials);
    } catch (error) {
      this.logger.error('Error checking credential validity', error);
      return false;
    }
  }

  /**
   * Validate credential structure and content
   * @param {Object} credentials - Credentials to validate
   * @returns {boolean} True if valid
   * @private
   */
  validateCredentials(credentials) {
    if (!credentials || typeof credentials !== 'object') {
      return false;
    }

    const requiredFields = ['accessToken', 'refreshToken', 'idToken'];
    return requiredFields.every(field =>
      credentials[field] && typeof credentials[field] === 'string'
    );
  }

  /**
   * Calculate expiration time based on token content
   * @param {Object} credentials - Credentials object
   * @returns {number} Expiration timestamp
   * @private
   */
  calculateExpirationTime(credentials) {
    try {
      // Extract expiration from access token
      const tokenParts = credentials.accessToken.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(atob(tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')));
        if (payload.exp) {
          return payload.exp * 1000; // Convert to milliseconds
        }
      }
    } catch (error) {
      this.logger.warn('Failed to extract token expiration', error);
    }

    // Fallback: 8 hours from now
    return Date.now() + (8 * 60 * 60 * 1000);
  }

  /**
   * Calculate checksum for integrity verification
   * @param {Object} credentials - Credentials object
   * @returns {Promise<string>} Checksum
   * @private
   */
  async calculateChecksum(credentials) {
    const data = JSON.stringify(credentials);
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Check if cached data is still valid
   * @param {Object} cached - Cached data object
   * @returns {boolean} True if valid
   * @private
   */
  isCacheValid(cached) {
    if (!cached || !cached.timestamp || !cached.metadata) {
      return false;
    }

    const now = Date.now();

    // Check cache timeout
    if (now - cached.timestamp > this.cacheTimeout) {
      return false;
    }

    // Check credential expiration
    return !this.isExpired(cached.metadata);
  }

  /**
   * Check if credentials are expired based on metadata
   * @param {Object} metadata - Credential metadata
   * @returns {boolean} True if expired
   * @private
   */
  isExpired(metadata) {
    if (!metadata || !metadata.expiresAt) {
      return true;
    }

    return Date.now() >= metadata.expiresAt;
  }

  /**
   * Setup storage change listeners for cross-tab synchronization
   * @private
   */
  setupStorageListeners() {
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === 'local' && (changes[this.storageKey] || changes[this.metadataKey])) {
          // Clear memory cache when persistent storage changes
          this.memoryCache.clear();
          this.logger.debug('Storage changed, cleared memory cache');
        }
      });
    }
  }

  /**
   * Get storage statistics for monitoring
   * @returns {Promise<Object>} Storage statistics
   */
  async getStorageStats() {
    try {
      const result = await chrome.storage.local.get([this.storageKey, this.metadataKey]);
      const hasCredentials = !!(result[this.storageKey] && result[this.metadataKey]);
      const cacheSize = this.memoryCache.size;

      let metadata = null;
      if (result[this.metadataKey]) {
        metadata = result[this.metadataKey];
      }

      return {
        hasCredentials,
        cacheSize,
        metadata,
        isExpired: metadata ? this.isExpired(metadata) : null
      };
    } catch (error) {
      this.logger.error('Failed to get storage stats', error);
      return { error: error.message };
    }
  }

  /**
   * Cleanup expired data and optimize storage
   * @returns {Promise<void>}
   */
  async cleanup() {
    try {
      const stats = await this.getStorageStats();

      if (stats.hasCredentials && stats.isExpired) {
        this.logger.info('Cleaning up expired credentials');
        await this.clearCredentials();
      }

      // Clear memory cache if it's getting too large
      if (stats.cacheSize > 10) {
        this.memoryCache.clear();
        this.logger.debug('Cleared oversized memory cache');
      }

    } catch (error) {
      this.logger.error('Cleanup failed', error);
    }
  }
}

