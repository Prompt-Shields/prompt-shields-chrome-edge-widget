/**
 * Security Configuration for PromptShields Extension
 * Centralized security settings and policies
 */

/**
 * Get API host from config for dynamic domain whitelist
 * Falls back to known production domain if config is not available
 */
function getApiHost() {
  try {
    // eslint-disable-next-line no-undef
    if (typeof Config !== 'undefined' && Config.getApi) {
      // eslint-disable-next-line no-undef
      const apiConfig = Config.getApi();
      if (apiConfig?.host) return apiConfig.host;
    }
    if (typeof window !== 'undefined' && window.Config && window.Config.getApi) {
      const apiConfig = window.Config.getApi();
      if (apiConfig?.host) return apiConfig.host;
    }
  } catch (error) {
    console.warn('Could not get API host from config:', error);
  }
  return '';
}

/**
 * Build the allowed domains set with the API host from config
 */
function buildAllowedDomains() {
  const apiHost = getApiHost();
  return new Set([
    apiHost,
    'promptshields.com',
    'auth0.com',
    'openai.com',
    'huggingface.co',
    'anthropic.com',
    'claude.ai',
    'cohere.ai',
    'stability.ai',
    'perplexity.ai',
    'copy.ai',
    'jasper.ai',
    'midjourney.com',
    'scribehow.com',
    'writesonic.com',
    'speechmatics.com',
    'gradio.app',
    'notion.so',
    'fathom.video',
    'gptzero.me',
    'fireflies.ai',
    'deepseek.com',
    'chatgpt.com',
    'poe.com',
    'synthesia.io',
    'elevenlabs.io',
    'replika.ai',
    'murf.ai',
    'grammarly.com',
    'gemini.google.com',
    'copilot.microsoft.com',
    'character.ai',
    'you.com',
    'chatbotapp.ai'
  ]);
}

/**
 * Security configuration constants
 */
const SECURITY_CONFIG = {
  // Token security
  TOKEN: {
    MAX_AGE: 8 * 60 * 60 * 1000, // 8 hours
    REFRESH_THRESHOLD: 15 * 60 * 1000, // 15 minutes before expiry
    CLEANUP_INTERVAL: 30 * 60 * 1000, // 30 minutes
    MAX_USAGE_COUNT: 1000 // Maximum token usage before forced refresh
  },

  // HTTP security
  HTTP: {
    TIMEOUT: 30000, // 30 seconds
    MAX_RETRIES: 3,
    MAX_REDIRECTS: 0, // Don't follow redirects
    MAX_RESPONSE_SIZE: 10 * 1024 * 1024, // 10MB
    ALLOWED_PROTOCOLS: ['https:', 'http:'], // http: only for localhost in dev
    RATE_LIMIT: {
      MAX_REQUESTS: 100,
      WINDOW_MS: 60 * 1000 // 1 minute
    }
  },

  // Content Security
  CONTENT: {
    MAX_TEXT_LENGTH: 50000, // 50KB max text input
    MAX_JSON_SIZE: 1024 * 1024, // 1MB max JSON
    ALLOWED_FILE_TYPES: [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
      'application/pdf', 'text/plain'
    ],
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    XSS_PATTERNS: [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript\s*:/gi,
      /vbscript\s*:/gi,
      /data\s*:/gi,
      /on\w+\s*=/gi,
      /<iframe\b[^>]*>/gi,
      /<object\b[^>]*>/gi,
      /<embed\b[^>]*>/gi,
      /<link\b[^>]*>/gi,
      /<meta\b[^>]*>/gi
    ]
  },

  // Domain whitelist - dynamically includes API host from config
  DOMAINS: {
    ALLOWED: buildAllowedDomains(),
    DEVELOPMENT: new Set(['localhost', '127.0.0.1']),
    DEVELOPMENT_PORTS: new Set([8000, 3000, 8080, 9000])
  },

  // Headers security
  HEADERS: {
    REQUIRED_RESPONSE: [
      'x-content-type-options',
      'x-frame-options'
    ],
    SECURITY_HEADERS: {
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache'
    }
  },

  // Extension context
  EXTENSION: {
    CONTEXT_CHECK_INTERVAL: 5000, // 5 seconds
    MAX_CONTEXT_FAILURES: 3,
    CLEANUP_ON_INVALIDATION: true
  },

  // Logging and monitoring
  LOGGING: {
    MAX_LOG_ENTRIES: 1000,
    LOG_RETENTION: 24 * 60 * 60 * 1000, // 24 hours
    SENSITIVE_FIELDS: [
      'password', 'token', 'key', 'secret', 'credential',
      'authorization', 'cookie', 'session'
    ]
  }
};

/**
 * Security policy enforcement
 */
class SecurityPolicy {
  constructor() {
    this.violations = new Map();
    this.blockedRequests = new Map();
  }

  /**
   * Check if domain is allowed
   * @param {string} hostname - Domain to check
   * @param {boolean} isDevelopment - Whether in development mode
   * @returns {boolean} True if allowed
   */
  isDomainAllowed(hostname, isDevelopment = false) {
    // Check main allowed domains
    if (SECURITY_CONFIG.DOMAINS.ALLOWED.has(hostname)) {
      return true;
    }

    // Check for subdomain matches
    for (const domain of SECURITY_CONFIG.DOMAINS.ALLOWED) {
      if (hostname.endsWith(`.${  domain}`)) {
        return true;
      }
    }

    // Check development domains
    if (isDevelopment && SECURITY_CONFIG.DOMAINS.DEVELOPMENT.has(hostname)) {
      return true;
    }

    return false;
  }

  /**
   * Validate URL against security policy
   * @param {string} url - URL to validate
   * @param {boolean} isDevelopment - Whether in development mode
   * @returns {Object} Validation result
   */
  validateUrl(url, isDevelopment = false) {
    try {
      const urlObj = new URL(url);

      // Check protocol
      if (!SECURITY_CONFIG.HTTP.ALLOWED_PROTOCOLS.includes(urlObj.protocol)) {
        return { valid: false, reason: 'Protocol not allowed' };
      }

      // Check HTTP in production
      if (urlObj.protocol === 'http:' && !isDevelopment) {
        return { valid: false, reason: 'HTTP not allowed in production' };
      }

      // Check domain
      if (!this.isDomainAllowed(urlObj.hostname, isDevelopment)) {
        return { valid: false, reason: 'Domain not in whitelist' };
      }

      // Check development port restrictions
      if (isDevelopment && urlObj.protocol === 'http:') {
        const port = parseInt(urlObj.port) || 80;
        if (!SECURITY_CONFIG.DOMAINS.DEVELOPMENT_PORTS.has(port) && port !== 80) {
          return { valid: false, reason: 'Development port not allowed' };
        }
      }

      return { valid: true };
    } catch (error) {
      return { valid: false, reason: 'Invalid URL format' };
    }
  }

  /**
   * Check for XSS patterns in content
   * @param {string} content - Content to check
   * @returns {Object} Check result
   */
  checkXSSPatterns(content) {
    if (typeof content !== 'string') {
      return { safe: true };
    }

    for (const pattern of SECURITY_CONFIG.CONTENT.XSS_PATTERNS) {
      if (pattern.test(content)) {
        return {
          safe: false,
          reason: 'Potential XSS pattern detected',
          pattern: pattern.toString()
        };
      }
    }

    return { safe: true };
  }

  /**
   * Record security violation
   * @param {string} type - Violation type
   * @param {Object} details - Violation details
   */
  recordViolation(type, details) {
    const timestamp = Date.now();
    const key = `${type}_${timestamp}`;

    this.violations.set(key, {
      type,
      details,
      timestamp,
      userAgent: navigator.userAgent
    });

    // Limit violation storage
    if (this.violations.size > SECURITY_CONFIG.LOGGING.MAX_LOG_ENTRIES) {
      const oldestKey = this.violations.keys().next().value;
      this.violations.delete(oldestKey);
    }

    console.warn('Security violation recorded:', { type, details });
  }

  /**
   * Get security statistics
   * @returns {Object} Security statistics
   */
  getSecurityStats() {
    const now = Date.now();
    const recentViolations = Array.from(this.violations.values())
      .filter(v => now - v.timestamp < SECURITY_CONFIG.LOGGING.LOG_RETENTION);

    const violationsByType = {};
    recentViolations.forEach(v => {
      violationsByType[v.type] = (violationsByType[v.type] || 0) + 1;
    });

    return {
      totalViolations: recentViolations.length,
      violationsByType,
      blockedRequests: this.blockedRequests.size,
      lastViolation: recentViolations.length > 0 ?
        Math.max(...recentViolations.map(v => v.timestamp)) : null
    };
  }

  /**
   * Clear old violations and blocked requests
   */
  cleanup() {
    const now = Date.now();
    const cutoff = now - SECURITY_CONFIG.LOGGING.LOG_RETENTION;

    // Clean violations
    for (const [key, violation] of this.violations.entries()) {
      if (violation.timestamp < cutoff) {
        this.violations.delete(key);
      }
    }

    // Clean blocked requests
    for (const [key, blocked] of this.blockedRequests.entries()) {
      if (blocked.timestamp < cutoff) {
        this.blockedRequests.delete(key);
      }
    }
  }
}

// Create singleton instance
const securityPolicy = new SecurityPolicy();

// Setup periodic cleanup
setInterval(() => {
  securityPolicy.cleanup();
}, SECURITY_CONFIG.LOGGING.LOG_RETENTION);

// Export configuration and policy
export { SECURITY_CONFIG, SecurityPolicy, securityPolicy };

// CommonJS export
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SECURITY_CONFIG, SecurityPolicy, securityPolicy };
}

// Global browser export
if (typeof window !== 'undefined') {
  window.PromptShieldsSecurityConfig = { SECURITY_CONFIG, SecurityPolicy, securityPolicy };
}

