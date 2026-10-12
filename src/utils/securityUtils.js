/**
 * Security utilities for PromptShields extension
 * Provides input validation, CSRF protection, and rate limiting
 */

/**
 * Rate limiter implementation
 */
class RateLimiter {
  constructor() {
    this.requests = new Map();
    this.maxRequests = 10; // Max requests per window
    this.windowMs = 60000; // 1 minute window
  }

  /**
   * Check if request is allowed under rate limit
   * @param {string} key - Unique identifier for the request type/user
   * @returns {boolean} True if request is allowed
   */
  isAllowed(key) {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    if (!this.requests.has(key)) {
      this.requests.set(key, []);
    }

    const userRequests = this.requests.get(key);

    // Remove old requests outside the window
    const validRequests = userRequests.filter(timestamp => timestamp > windowStart);
    this.requests.set(key, validRequests);

    // Check if under limit
    if (validRequests.length >= this.maxRequests) {
      return false;
    }

    // Add current request
    validRequests.push(now);
    return true;
  }

  /**
   * Reset rate limit for a key
   * @param {string} key - Key to reset
   */
  reset(key) {
    this.requests.delete(key);
  }
}

// Global rate limiter instance
const rateLimiter = new RateLimiter();

/**
 * Input validation utilities
 */
const InputValidator = {
  /**
   * Validate email format
   * @param {string} email - Email to validate
   * @returns {boolean} True if valid email format
   */
  isValidEmail(email) {
    if (typeof email !== 'string' || email.length > 254) {
      return false;
    }

    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
    return emailRegex.test(email);
  },

  /**
   * Validate file type for image uploads
   * @param {File} file - File to validate
   * @returns {Object} Validation result with isValid and error
   */
  validateImageFile(file) {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif'];
    const maxSize = 5 * 1024 * 1024; // 5MB

    if (!file) {
      return { isValid: false, error: 'No file provided' };
    }

    if (!allowedTypes.includes(file.type)) {
      return { isValid: false, error: 'Invalid file type. Only JPEG, PNG, and GIF are allowed.' };
    }

    if (file.size > maxSize) {
      return { isValid: false, error: 'File too large. Maximum size is 5MB.' };
    }

    // Additional security check for file extension
    const fileName = file.name.toLowerCase();
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif'];
    const hasValidExtension = validExtensions.some(ext => fileName.endsWith(ext));

    if (!hasValidExtension) {
      return { isValid: false, error: 'Invalid file extension.' };
    }

    return { isValid: true, error: null };
  },

  /**
   * Sanitize HTML input to prevent XSS (ENHANCED SECURITY)
   * @param {string} input - HTML string to sanitize
   * @returns {string} Sanitized string
   */
  sanitizeHtml(input) {
    if (typeof input !== 'string') {
      return '';
    }

    // Remove null bytes and control characters
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    const sanitized = input.replace(/\0/g, '').replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Create temporary element for text content extraction
    const div = document.createElement('div');
    div.textContent = sanitized;

    // Additional sanitization for common XSS patterns
    let result = div.innerHTML;

    // Remove javascript: and data: URLs
    result = result.replace(/javascript\s*:/gi, '');
    result = result.replace(/data\s*:/gi, '');
    result = result.replace(/vbscript\s*:/gi, '');

    // Remove on* event handlers
    result = result.replace(/\s*on\w+\s*=/gi, '');

    return result;
  },

  /**
   * Validate and sanitize URL
   * @param {string} url - URL to validate
   * @returns {Object} Validation result with sanitized URL
   */
  validateUrl(url) {
    if (typeof url !== 'string' || url.length === 0) {
      return { isValid: false, sanitizedUrl: '', error: 'Invalid URL format' };
    }

    try {
      const urlObj = new URL(url);

      // Only allow HTTP and HTTPS
      if (!['http:', 'https:'].includes(urlObj.protocol)) {
        return { isValid: false, sanitizedUrl: '', error: 'Only HTTP/HTTPS protocols allowed' };
      }

      // Check for suspicious patterns
      const suspiciousPatterns = [
        /javascript:/i,
        /data:/i,
        /vbscript:/i,
        /file:/i,
        /ftp:/i
      ];

      if (suspiciousPatterns.some(pattern => pattern.test(url))) {
        return { isValid: false, sanitizedUrl: '', error: 'Suspicious URL pattern detected' };
      }

      return { isValid: true, sanitizedUrl: urlObj.toString(), error: null };
    } catch (error) {
      return { isValid: false, sanitizedUrl: '', error: 'Malformed URL' };
    }
  },

  /**
   * Validate JSON input
   * @param {string} jsonString - JSON string to validate
   * @param {number} maxSize - Maximum size in bytes
   * @returns {Object} Validation result
   */
  validateJson(jsonString, maxSize = 1024 * 1024) {
    if (typeof jsonString !== 'string') {
      return { isValid: false, error: 'Input must be a string' };
    }

    if (jsonString.length > maxSize) {
      return { isValid: false, error: `JSON too large (max ${maxSize} bytes)` };
    }

    try {
      const parsed = JSON.parse(jsonString);

      // Check for prototype pollution attempts
      if (this.hasPrototypePollution(parsed)) {
        return { isValid: false, error: 'Potential prototype pollution detected' };
      }

      return { isValid: true, parsed, error: null };
    } catch (error) {
      return { isValid: false, error: 'Invalid JSON format' };
    }
  },

  /**
   * Check for prototype pollution in object
   * @param {Object} obj - Object to check
   * @returns {boolean} True if potential pollution detected
   */
  hasPrototypePollution(obj) {
    if (typeof obj !== 'object' || obj === null) {
      return false;
    }

    const dangerousKeys = ['__proto__', 'constructor', 'prototype'];

    const checkObject = (current, depth = 0) => {
      if (depth > 10) return false; // Prevent deep recursion

      for (const key in current) {
        if (dangerousKeys.includes(key)) {
          return true;
        }

        if (typeof current[key] === 'object' && current[key] !== null) {
          if (checkObject(current[key], depth + 1)) {
            return true;
          }
        }
      }

      return false;
    };

    return checkObject(obj);
  },

  /**
   * Validate pagination parameters
   * @param {number} page - Page number
   * @param {number} limit - Items per page
   * @returns {Object} Validation result
   */
  validatePagination(page, limit) {
    const maxLimit = 100;
    const maxPage = 10000;

    if (!Number.isInteger(page) || page < 1 || page > maxPage) {
      return { isValid: false, error: 'Invalid page number' };
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) {
      return { isValid: false, error: 'Invalid limit' };
    }

    return { isValid: true, error: null };
  }
};

/**
 * CSRF protection utilities
 */
const CSRFProtection = {
  /**
   * Generate a CSRF token
   * @returns {string} CSRF token
   */
  generateToken() {
    const array = new Uint8Array(32);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  },

  /**
   * Store CSRF token
   * @param {string} token - Token to store
   */
  storeToken(token) {
    sessionStorage.setItem('csrf_token', token);
  },

  /**
   * Get stored CSRF token
   * @returns {string|null} Stored token or null
   */
  getToken() {
    return sessionStorage.getItem('csrf_token');
  },

  /**
   * Validate CSRF token
   * @param {string} token - Token to validate
   * @returns {boolean} True if valid
   */
  validateToken(token) {
    const storedToken = this.getToken();
    return storedToken && storedToken === token;
  },

  /**
   * Clear CSRF token
   */
  clearToken() {
    sessionStorage.removeItem('csrf_token');
  }
};

/**
 * Secure API request helper
 */
const SecureApiClient = {
  /**
   * Make a secure API request with authentication and CSRF protection
   * @param {string} url - API endpoint URL
   * @param {Object} options - Request options
   * @param {Object} credentials - User credentials
   * @returns {Promise} Request promise
   */
  async makeRequest(url, options = {}, credentials = null) {
    // Rate limiting check
    const rateLimitKey = `api_${url}`;
    if (!rateLimiter.isAllowed(rateLimitKey)) {
      throw new Error('Rate limit exceeded. Please try again later.');
    }

    // Prepare headers
    const headers = {
      'Content-Type': 'application/json',
      ...options.headers
    };

    // Add authentication if credentials provided
    if (credentials && credentials.accessToken) {
      headers['Authorization'] = `Bearer ${credentials.accessToken}`;
    }

    // Add CSRF token for state-changing requests
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(options.method?.toUpperCase())) {
      const csrfToken = CSRFProtection.getToken();
      if (csrfToken) {
        headers['X-CSRF-Token'] = csrfToken;
      }
    }

    // Make request with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Request timeout', { cause: error });
      }

      throw error;
    }
  },

  /**
   * Upload file securely
   * @param {string} url - Upload endpoint
   * @param {File} file - File to upload
   * @param {Object} credentials - User credentials
   * @returns {Promise} Upload promise
   */
  async uploadFile(url, file, credentials) {
    // Validate file
    const validation = InputValidator.validateImageFile(file);
    if (!validation.isValid) {
      throw new Error(validation.error);
    }

    // Rate limiting
    if (!rateLimiter.isAllowed('file_upload')) {
      throw new Error('Upload rate limit exceeded. Please try again later.');
    }

    const formData = new FormData();
    formData.append('file', file);

    // Add CSRF token
    const csrfToken = CSRFProtection.getToken();
    if (csrfToken) {
      formData.append('csrf_token', csrfToken);
    }

    const headers = {};
    if (credentials && credentials.accessToken) {
      headers['Authorization'] = `Bearer ${credentials.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60 second timeout for uploads

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.status} ${response.statusText}`);
      }

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Upload timeout', { cause: error });
      }

      throw error;
    }
  }
};

/**
 * Memory management utilities
 */
const MemoryManager = {
  /**
   * Clear sensitive data from an object
   * @param {Object} obj - Object to clear
   */
  clearSensitiveData(obj) {
    if (!obj || typeof obj !== 'object') {
      return;
    }

    Object.keys(obj).forEach(key => {
      if (typeof obj[key] === 'string') {
        obj[key] = '';
      } else if (typeof obj[key] === 'object') {
        this.clearSensitiveData(obj[key]);
      }
    });
  },

  /**
   * Create a secure copy of an object (prevents reference sharing)
   * @param {Object} obj - Object to copy
   * @returns {Object} Deep copy of object
   */
  secureClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }
};

/**
 * Error handling utilities
 */
const ErrorHandler = {
  /**
   * Sanitize error message for user display
   * @param {Error|string} error - Error to sanitize
   * @returns {string} User-safe error message
   */
  sanitizeErrorMessage(error) {
    const message = error?.message || error || 'An unexpected error occurred';

    // Don't expose sensitive server errors
    const sensitivePatterns = [
      /database/i,
      /sql/i,
      /token/i,
      /credential/i,
      /authentication/i,
      /authorization/i,
      /internal server/i
    ];

    const isSensitive = sensitivePatterns.some(pattern => pattern.test(message));

    if (isSensitive) {
      return 'An error occurred. Please try again or contact support if the problem persists.';
    }

    // Sanitize the message
    return InputValidator.sanitizeHtml(message);
  },

  /**
   * Log error securely (for debugging)
   * @param {Error|string} error - Error to log
   * @param {Object} context - Additional context
   */
  logError(error, context = {}) {
    console.error('Security Error:', {
      message: error?.message || error,
      stack: error?.stack,
      timestamp: new Date().toISOString(),
      context
    });
  }
};

// Initialize CSRF token on module load
if (typeof window !== 'undefined') {
  if (!CSRFProtection.getToken()) {
    const token = CSRFProtection.generateToken();
    CSRFProtection.storeToken(token);
  }
}

module.exports = {
  InputValidator,
  CSRFProtection,
  SecureApiClient,
  MemoryManager,
  ErrorHandler,
  rateLimiter
};
