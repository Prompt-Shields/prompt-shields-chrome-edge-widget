/**
 * Token Validation Service Implementation
 * Handles JWT token validation, verification, and payload extraction
 * Implements Single Responsibility Principle (SRP)
 */

import { ITokenValidator } from '../interfaces/IAuthenticationService.js';

/**
 * JWT token validation service with JWKS support
 */
export class TokenValidationService extends ITokenValidator {
  constructor(logger) {
    super();
    this.logger = logger;
    this.jwksCache = new Map();
    this.cacheTimeout = 60 * 60 * 1000; // 1 hour
    this.maxCacheSize = 10;
  }

  /**
   * Validate JWT token against JWKS
   * @param {string} token - JWT token to validate
   * @param {string} jwksUrl - JWKS URL for validation
   * @returns {Promise<Object>} Validation result
   */
  async validateToken(token, jwksUrl = null) {
    try {
      if (!token || typeof token !== 'string') {
        return { valid: false, reason: 'Invalid token format' };
      }

      // Basic JWT structure validation
      if (!this.isValidJWTStructure(token)) {
        return { valid: false, reason: 'Invalid JWT structure' };
      }

      // Extract and validate header and payload
      const decoded = await this.decodeToken(token);
      if (!decoded) {
        return { valid: false, reason: 'Failed to decode token' };
      }

      // Validate basic claims
      const claimsValidation = this.validateBasicClaims(decoded.payload);
      if (!claimsValidation.valid) {
        return claimsValidation;
      }

      // If JWKS URL provided, validate signature
      if (jwksUrl) {
        const signatureValidation = await this.validateSignature(token, decoded.header, jwksUrl);
        if (!signatureValidation.valid) {
          return signatureValidation;
        }
      }

      return {
        valid: true,
        payload: decoded.payload,
        header: decoded.header
      };

    } catch (error) {
      this.logger.error('Token validation failed', error);
      return { valid: false, reason: 'Validation error occurred' };
    }
  }

  /**
   * Check if token is expired
   * @param {string} token - JWT token to check
   * @returns {Promise<boolean>} True if expired
   */
  async isTokenExpired(token) {
    try {
      const payload = await this.extractTokenPayload(token);
      if (!payload || !payload.exp) {
        return true; // Consider invalid tokens as expired
      }

      const now = Math.floor(Date.now() / 1000);
      return payload.exp <= now;

    } catch (error) {
      this.logger.error('Error checking token expiration', error);
      return true; // Consider errored tokens as expired
    }
  }

  /**
   * Extract payload from JWT token
   * @param {string} token - JWT token
   * @returns {Promise<Object>} Token payload
   */
  async extractTokenPayload(token) {
    try {
      const decoded = await this.decodeToken(token);
      return decoded ? decoded.payload : null;
    } catch (error) {
      this.logger.error('Error extracting token payload', error);
      return null;
    }
  }

  /**
   * Check if token has valid JWT structure
   * @param {string} token - Token to check
   * @returns {boolean} True if valid structure
   * @private
   */
  isValidJWTStructure(token) {
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
   * Decode JWT token into header and payload
   * @param {string} token - JWT token to decode
   * @returns {Promise<Object>} Decoded token parts
   * @private
   */
  async decodeToken(token) {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT structure');
      }

      const header = this.base64UrlDecode(parts[0]);
      const payload = this.base64UrlDecode(parts[1]);

      return {
        header: JSON.parse(header),
        payload: JSON.parse(payload),
        signature: parts[2]
      };

    } catch (error) {
      this.logger.error('Token decoding failed', error);
      return null;
    }
  }

  /**
   * Validate basic JWT claims (exp, nbf, iat)
   * @param {Object} payload - Token payload
   * @returns {Object} Validation result
   * @private
   */
  validateBasicClaims(payload) {
    const now = Math.floor(Date.now() / 1000);
    const clockSkew = 300; // 5 minutes tolerance

    // Check expiration
    if (payload.exp && payload.exp <= now) {
      return { valid: false, reason: 'Token expired' };
    }

    // Check not before
    if (payload.nbf && payload.nbf > now + clockSkew) {
      return { valid: false, reason: 'Token not yet valid' };
    }

    // Check issued at (prevent tokens from future)
    if (payload.iat && payload.iat > now + clockSkew) {
      return { valid: false, reason: 'Token issued in future' };
    }

    return { valid: true };
  }

  /**
   * Validate token signature using JWKS
   * @param {string} token - JWT token
   * @param {Object} header - Token header
   * @param {string} jwksUrl - JWKS endpoint URL
   * @returns {Promise<Object>} Validation result
   * @private
   */
  async validateSignature(token, header, jwksUrl) {
    try {
      if (!header.kid) {
        return { valid: false, reason: 'Missing key ID in token header' };
      }

      // Get JWKS
      const jwks = await this.getJWKS(jwksUrl);
      if (!jwks) {
        return { valid: false, reason: 'Failed to fetch JWKS' };
      }

      // Find matching key
      const jwk = jwks.keys.find(key => key.kid === header.kid);
      if (!jwk) {
        return { valid: false, reason: 'Matching key not found in JWKS' };
      }

      // Import public key
      const publicKey = await this.importPublicKey(jwk);
      if (!publicKey) {
        return { valid: false, reason: 'Failed to import public key' };
      }

      // Verify signature
      const isValid = await this.verifyTokenSignature(token, publicKey);

      return {
        valid: isValid,
        reason: isValid ? null : 'Invalid signature'
      };

    } catch (error) {
      this.logger.error('Signature validation failed', error);
      return { valid: false, reason: 'Signature validation error' };
    }
  }

  /**
   * Get JWKS from URL with caching
   * @param {string} jwksUrl - JWKS endpoint URL
   * @returns {Promise<Object>} JWKS data
   * @private
   */
  async getJWKS(jwksUrl) {
    try {
      // Check cache first
      const cached = this.jwksCache.get(jwksUrl);
      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        return cached.data;
      }

      // Fetch JWKS
      const response = await fetch(jwksUrl);
      if (!response.ok) {
        throw new Error(`JWKS fetch failed: ${response.status}`);
      }

      const jwks = await response.json();

      // Validate JWKS structure
      if (!jwks.keys || !Array.isArray(jwks.keys)) {
        throw new Error('Invalid JWKS structure');
      }

      // Cache the result
      this.cacheJWKS(jwksUrl, jwks);

      return jwks;

    } catch (error) {
      this.logger.error('JWKS fetch failed', error);
      return null;
    }
  }

  /**
   * Cache JWKS data
   * @param {string} url - JWKS URL
   * @param {Object} data - JWKS data
   * @private
   */
  cacheJWKS(url, data) {
    // Limit cache size
    if (this.jwksCache.size >= this.maxCacheSize) {
      const firstKey = this.jwksCache.keys().next().value;
      this.jwksCache.delete(firstKey);
    }

    this.jwksCache.set(url, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * Import public key from JWK
   * @param {Object} jwk - JSON Web Key
   * @returns {Promise<CryptoKey>} Imported public key
   * @private
   */
  async importPublicKey(jwk) {
    try {
      // Support RSA keys (most common)
      if (jwk.kty === 'RSA') {
        return await crypto.subtle.importKey(
          'jwk',
          {
            kty: jwk.kty,
            n: jwk.n,
            e: jwk.e,
            alg: jwk.alg,
            use: jwk.use
          },
          {
            name: 'RSASSA-PKCS1-v1_5',
            hash: { name: 'SHA-256' }
          },
          false,
          ['verify']
        );
      }

      // Support EC keys
      if (jwk.kty === 'EC') {
        return await crypto.subtle.importKey(
          'jwk',
          jwk,
          {
            name: 'ECDSA',
            namedCurve: jwk.crv
          },
          false,
          ['verify']
        );
      }

      throw new Error(`Unsupported key type: ${jwk.kty}`);

    } catch (error) {
      this.logger.error('Public key import failed', error);
      return null;
    }
  }

  /**
   * Verify JWT signature
   * @param {string} token - JWT token
   * @param {CryptoKey} publicKey - Public key for verification
   * @returns {Promise<boolean>} True if signature is valid
   * @private
   */
  async verifyTokenSignature(token, publicKey) {
    try {
      const parts = token.split('.');
      const header = parts[0];
      const payload = parts[1];
      const signature = parts[2];

      // Create signature data
      const data = `${header}.${payload}`;
      const encoder = new TextEncoder();
      const dataBuffer = encoder.encode(data);

      // Decode signature
      const signatureBuffer = this.base64UrlDecodeToBuffer(signature);

      // Verify signature
      const isValid = await crypto.subtle.verify(
        'RSASSA-PKCS1-v1_5',
        publicKey,
        signatureBuffer,
        dataBuffer
      );

      return isValid;

    } catch (error) {
      this.logger.error('Signature verification failed', error);
      return false;
    }
  }

  /**
   * Base64URL decode to string
   * @param {string} str - Base64URL encoded string
   * @returns {string} Decoded string
   * @private
   */
  base64UrlDecode(str) {
    const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - base64.length % 4) % 4);
    return atob(base64 + padding);
  }

  /**
   * Base64URL decode to ArrayBuffer
   * @param {string} str - Base64URL encoded string
   * @returns {ArrayBuffer} Decoded buffer
   * @private
   */
  base64UrlDecodeToBuffer(str) {
    const decoded = this.base64UrlDecode(str);
    const buffer = new ArrayBuffer(decoded.length);
    const view = new Uint8Array(buffer);

    for (let i = 0; i < decoded.length; i++) {
      view[i] = decoded.charCodeAt(i);
    }

    return buffer;
  }

  /**
   * Clear JWKS cache
   */
  clearCache() {
    this.jwksCache.clear();
    this.logger.debug('JWKS cache cleared');
  }

  /**
   * Get validation service statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      cacheSize: this.jwksCache.size,
      maxCacheSize: this.maxCacheSize,
      cacheTimeout: this.cacheTimeout
    };
  }

  /**
   * Health check for token validation service
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    try {
      // Test token validation with a sample JWT
      const testToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

      const result = await this.validateToken(testToken);

      return {
        status: 'healthy',
        canValidateTokens: true,
        cacheOperational: this.jwksCache instanceof Map
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }
}

