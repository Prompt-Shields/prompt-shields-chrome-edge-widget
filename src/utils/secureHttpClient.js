/**
 * Secure HTTP Client for PromptShields extension
 * Enforces HTTPS and provides secure communication patterns
 */

/**
 * Get allowed domains from config or use defaults
 * The API domain is dynamically set based on the build environment
 */
function getAllowedDomains() {
  const baseDomains = [
    'promptshields.com',
    'auth0.com',
  ];

  // Try to get API host from config
  try {
    // eslint-disable-next-line no-undef
    if (typeof Config !== 'undefined' && Config.getApi) {
      // eslint-disable-next-line no-undef
      const apiConfig = Config.getApi();
      if (apiConfig && apiConfig.host) {
        baseDomains.push(apiConfig.host);
      }
    } else if (typeof window !== 'undefined' && window.Config && window.Config.getApi) {
      const apiConfig = window.Config.getApi();
      if (apiConfig && apiConfig.host) {
        baseDomains.push(apiConfig.host);
      }
    }
  } catch (error) {
    console.warn('Could not get API host from config for whitelist:', error);
  }

  return new Set(baseDomains);
}

/**
 * Secure HTTP client with built-in security controls
 */
class SecureHttpClient {
  constructor() {
    this.allowedDomains = getAllowedDomains();
    this.developmentPorts = new Set([8000, 3000, 8080, 9000]);
    this.maxRetries = 3;
    this.timeout = 30000; // 30 seconds
  }

  /**
   * Validate URL for security compliance
   * @param {string} url - URL to validate
   * @returns {Object} Validation result
   */
  validateUrl(url) {
    try {
      const urlObj = new URL(url);

      // Check protocol
      if (urlObj.protocol !== 'https:' && urlObj.protocol !== 'http:') {
        return { valid: false, error: 'Invalid protocol. Only HTTP/HTTPS allowed.' };
      }

      // In production, only allow HTTPS except for specific development cases
      if (urlObj.protocol === 'http:') {
        const isDevelopment = this.isDevelopmentEnvironment();
        const isAllowedPort = this.developmentPorts.has(parseInt(urlObj.port) || 80);

        if (!isDevelopment || !isAllowedPort) {
          return { valid: false, error: 'HTTP not allowed in production or for external domains.' };
        }
      }

      // Check domain whitelist
      const isAllowedDomain = this.allowedDomains.has(urlObj.hostname) ||
        Array.from(this.allowedDomains).some(domain =>
          urlObj.hostname.endsWith(`.${domain}`)
        );

      if (!isAllowedDomain) {
        return { valid: false, error: `Domain ${urlObj.hostname} not in whitelist.` };
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, error: 'Invalid URL format.' };
    }
  }

  /**
   * Check if running in development environment
   * @returns {boolean} True if development environment
   */
  isDevelopmentEnvironment() {
    // Check for development indicators
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
      // Unpacked extensions have longer IDs
      return chrome.runtime.id.length > 32;
    }

    return false;
  }

  /**
   * Make a secure HTTP request
   * @param {string} url - Request URL
   * @param {Object} options - Request options
   * @returns {Promise<Response>} Fetch response
   */
  async request(url, options = {}) {
    // Validate URL
    const validation = this.validateUrl(url);
    if (!validation.valid) {
      throw new Error(`URL validation failed: ${validation.error}`);
    }

    // Set secure defaults
    const secureOptions = {
      ...options,
      credentials: 'omit', // Don't send cookies
      cache: 'no-cache',
      redirect: 'error', // Don't follow redirects automatically
      referrerPolicy: 'no-referrer'
    };

    // Set secure headers
    secureOptions.headers = {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      ...secureOptions.headers
    };

    // Add timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);
    secureOptions.signal = controller.signal;

    try {
      const response = await fetch(url, secureOptions);
      clearTimeout(timeoutId);

      // Validate response
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check response headers for security
      this.validateResponseHeaders(response);

      return response;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new Error('Request timeout');
      }

      throw error;
    }
  }

  /**
   * Validate response headers for security
   * @param {Response} response - Fetch response
   */
  validateResponseHeaders(response) {
    const contentType = response.headers.get('content-type');

    // Ensure JSON responses have correct content type
    if (contentType && !contentType.includes('application/json') &&
      !contentType.includes('text/')) {
      console.warn('Unexpected content type:', contentType);
    }

    // Check for security headers
    const securityHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection'
    ];

    securityHeaders.forEach(header => {
      if (!response.headers.has(header)) {
        console.warn(`Missing security header: ${header}`);
      }
    });
  }

  /**
   * Make a secure GET request
   * @param {string} url - Request URL
   * @param {Object} headers - Request headers
   * @returns {Promise<Response>} Fetch response
   */
  async get(url, headers = {}) {
    return this.request(url, {
      method: 'GET',
      headers
    });
  }

  /**
   * Make a secure POST request
   * @param {string} url - Request URL
   * @param {Object} data - Request body data
   * @param {Object} headers - Request headers
   * @returns {Promise<Response>} Fetch response
   */
  async post(url, data, headers = {}) {
    const requestHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    return this.request(url, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(data)
    });
  }

  /**
   * Make a secure PUT request
   * @param {string} url - Request URL
   * @param {Object} data - Request body data
   * @param {Object} headers - Request headers
   * @returns {Promise<Response>} Fetch response
   */
  async put(url, data, headers = {}) {
    const requestHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };

    return this.request(url, {
      method: 'PUT',
      headers: requestHeaders,
      body: JSON.stringify(data)
    });
  }

  /**
   * Make a secure DELETE request
   * @param {string} url - Request URL
   * @param {Object} headers - Request headers
   * @returns {Promise<Response>} Fetch response
   */
  async delete(url, headers = {}) {
    return this.request(url, {
      method: 'DELETE',
      headers
    });
  }

  /**
   * Upload file securely
   * @param {string} url - Upload URL
   * @param {File} file - File to upload
   * @param {Object} headers - Additional headers
   * @returns {Promise<Response>} Fetch response
   */
  async uploadFile(url, file, headers = {}) {
    // Validate file
    if (!file || !(file instanceof File)) {
      throw new Error('Invalid file provided');
    }

    // Check file size (max 10MB)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new Error('File too large (max 10MB)');
    }

    // Check file type
    const allowedTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
      'application/pdf', 'text/plain'
    ];

    if (!allowedTypes.includes(file.type)) {
      throw new Error('File type not allowed');
    }

    const formData = new FormData();
    formData.append('file', file);

    return this.request(url, {
      method: 'POST',
      headers, // Don't set Content-Type for FormData
      body: formData
    });
  }
}

// Create singleton instance
const secureHttpClient = new SecureHttpClient();

// Export for ES6 modules
export { SecureHttpClient, secureHttpClient };

// Export for CommonJS
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SecureHttpClient, secureHttpClient };
}

// Global browser export
if (typeof window !== 'undefined') {
  window.PromptShieldsSecureHttp = { SecureHttpClient, secureHttpClient };
}
