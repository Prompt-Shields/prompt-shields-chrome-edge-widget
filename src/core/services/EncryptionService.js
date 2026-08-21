/**
 * Encryption Service for Secure Data Storage
 * Provides AES-GCM encryption for sensitive data
 * Implements Single Responsibility Principle (SRP)
 */

/**
 * AES-GCM encryption service for credential protection
 */
export class EncryptionService {
  constructor(logger) {
    this.logger = logger;
    this.algorithm = 'AES-GCM';
    this.keyLength = 256;
    this.ivLength = 12; // 96 bits for GCM
    this.saltLength = 16; // 128 bits
    this.iterations = 100000; // PBKDF2 iterations
    this.keyCache = new Map();
    this.maxCacheAge = 30 * 60 * 1000; // 30 minutes
  }

  /**
   * Encrypt data using AES-GCM
   * @param {string} plaintext - Data to encrypt
   * @param {string} password - Optional password (uses derived key if not provided)
   * @returns {Promise<string>} Base64 encoded encrypted data
   */
  async encrypt(plaintext, password = null) {
    try {
      if (!plaintext || typeof plaintext !== 'string') {
        throw new Error('Invalid plaintext provided');
      }

      // Generate random salt and IV
      const salt = crypto.getRandomValues(new Uint8Array(this.saltLength));
      const iv = crypto.getRandomValues(new Uint8Array(this.ivLength));

      // Derive or get encryption key
      const key = password ?
        await this.deriveKeyFromPassword(password, salt) :
        await this.getOrCreateMasterKey();

      // Encrypt the data
      const encoder = new TextEncoder();
      const data = encoder.encode(plaintext);

      const encryptedData = await crypto.subtle.encrypt(
        {
          name: this.algorithm,
          iv: iv
        },
        key,
        data
      );

      // Combine salt, iv, and encrypted data
      const combined = new Uint8Array(
        this.saltLength + this.ivLength + encryptedData.byteLength
      );

      combined.set(salt, 0);
      combined.set(iv, this.saltLength);
      combined.set(new Uint8Array(encryptedData), this.saltLength + this.ivLength);

      // Return base64 encoded result
      return this.arrayBufferToBase64(combined.buffer);

    } catch (error) {
      this.logger.error('Encryption failed', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt data using AES-GCM
   * @param {string} encryptedData - Base64 encoded encrypted data
   * @param {string} password - Optional password (uses derived key if not provided)
   * @returns {Promise<string>} Decrypted plaintext
   */
  async decrypt(encryptedData, password = null) {
    try {
      if (!encryptedData || typeof encryptedData !== 'string') {
        throw new Error('Invalid encrypted data provided');
      }

      // Decode base64 data
      const combined = new Uint8Array(this.base64ToArrayBuffer(encryptedData));

      if (combined.length < this.saltLength + this.ivLength) {
        throw new Error('Invalid encrypted data format');
      }

      // Extract salt, IV, and encrypted data
      const salt = combined.slice(0, this.saltLength);
      const iv = combined.slice(this.saltLength, this.saltLength + this.ivLength);
      const encrypted = combined.slice(this.saltLength + this.ivLength);

      // Derive or get decryption key
      const key = password ?
        await this.deriveKeyFromPassword(password, salt) :
        await this.getOrCreateMasterKey();

      // Decrypt the data
      const decryptedData = await crypto.subtle.decrypt(
        {
          name: this.algorithm,
          iv: iv
        },
        key,
        encrypted
      );

      // Convert to string
      const decoder = new TextDecoder();
      return decoder.decode(decryptedData);

    } catch (error) {
      this.logger.error('Decryption failed', error);
      throw new Error('Failed to decrypt data');
    }
  }

  /**
   * Derive encryption key from password using PBKDF2
   * @param {string} password - Password to derive key from
   * @param {Uint8Array} salt - Salt for key derivation
   * @returns {Promise<CryptoKey>} Derived encryption key
   * @private
   */
  async deriveKeyFromPassword(password, salt) {
    try {
      // Create cache key
      const cacheKey = await this.createCacheKey(password, salt);

      // Check cache first
      const cached = this.keyCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < this.maxCacheAge) {
        return cached.key;
      }

      // Import password as key material
      const encoder = new TextEncoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(password),
        { name: 'PBKDF2' },
        false,
        ['deriveKey']
      );

      // Derive AES key
      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: salt,
          iterations: this.iterations,
          hash: 'SHA-256'
        },
        keyMaterial,
        {
          name: this.algorithm,
          length: this.keyLength
        },
        false,
        ['encrypt', 'decrypt']
      );

      // Cache the key
      this.keyCache.set(cacheKey, {
        key,
        timestamp: Date.now()
      });

      return key;

    } catch (error) {
      this.logger.error('Key derivation failed', error);
      throw new Error('Failed to derive encryption key');
    }
  }

  /**
   * Get or create master encryption key for the extension
   * @returns {Promise<CryptoKey>} Master encryption key
   * @private
   */
  async getOrCreateMasterKey() {
    try {
      // Try to get existing key from storage
      const result = await chrome.storage.local.get(['ps_master_key_data']);

      if (result.ps_master_key_data) {
        // Import existing key
        return await crypto.subtle.importKey(
          'raw',
          this.base64ToArrayBuffer(result.ps_master_key_data),
          { name: this.algorithm },
          false,
          ['encrypt', 'decrypt']
        );
      }

      // Generate new master key
      const key = await crypto.subtle.generateKey(
        {
          name: this.algorithm,
          length: this.keyLength
        },
        true,
        ['encrypt', 'decrypt']
      );

      // Export and store the key
      const exportedKey = await crypto.subtle.exportKey('raw', key);
      const keyData = this.arrayBufferToBase64(exportedKey);

      await chrome.storage.local.set({
        ps_master_key_data: keyData
      });

      this.logger.info('Generated new master encryption key');
      return key;

    } catch (error) {
      this.logger.error('Master key generation failed', error);
      throw new Error('Failed to get or create master key');
    }
  }

  /**
   * Create cache key for password-derived keys
   * @param {string} password - Password
   * @param {Uint8Array} salt - Salt
   * @returns {Promise<string>} Cache key
   * @private
   */
  async createCacheKey(password, salt) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password + this.arrayBufferToBase64(salt.buffer));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Convert ArrayBuffer to Base64 string
   * @param {ArrayBuffer} buffer - Buffer to convert
   * @returns {string} Base64 string
   * @private
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  /**
   * Convert Base64 string to ArrayBuffer
   * @param {string} base64 - Base64 string to convert
   * @returns {ArrayBuffer} Converted buffer
   * @private
   */
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Clear all cached keys (for security)
   * @returns {void}
   */
  clearKeyCache() {
    this.keyCache.clear();
    this.logger.debug('Encryption key cache cleared');
  }

  /**
   * Generate secure random password
   * @param {number} length - Password length
   * @returns {string} Random password
   */
  generateSecurePassword(length = 32) {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*';
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);

    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset[array[i] % charset.length];
    }

    return password;
  }

  /**
   * Validate encryption capability
   * @returns {Promise<boolean>} True if encryption is available
   */
  async validateEncryption() {
    try {
      const testData = 'test_encryption_' + Date.now();
      const encrypted = await this.encrypt(testData);
      const decrypted = await this.decrypt(encrypted);

      const isValid = decrypted === testData;
      this.logger.debug('Encryption validation', { isValid });

      return isValid;
    } catch (error) {
      this.logger.error('Encryption validation failed', error);
      return false;
    }
  }

  /**
   * Get encryption service statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      algorithm: this.algorithm,
      keyLength: this.keyLength,
      cachedKeys: this.keyCache.size,
      maxCacheAge: this.maxCacheAge
    };
  }
}

