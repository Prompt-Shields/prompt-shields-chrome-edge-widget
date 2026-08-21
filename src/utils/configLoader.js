/**
 * Configuration Loader Utility (Simplified)
 * Wrapper around the unified configuration system for backward compatibility
 */

const { config } = require('../config/config.js');

/**
 * Legacy ConfigLoader class for backward compatibility
 * @deprecated Use the unified config system directly instead
 */
class ConfigLoader {
  constructor() {
    this.isLoaded = false;
    this.config = null;
    this.environment = null;
  }

  /**
   * Load configuration asynchronously
   * @param {string} forceEnv - Force specific environment (optional)
   * @returns {Promise<Object>} Configuration object
   */
  async loadConfig(forceEnv = null) {
    try {
      // Use the unified config system
      const configData = config.init(forceEnv);

      // Transform to legacy format for backward compatibility
      this.config = {
        environment: configData.environment,
        apiHost: configData.api.baseUrl,
        ...configData.api.endpoints
      };

      this.environment = configData.environment;
      this.isLoaded = true;

      console.log('Configuration loaded successfully:', this.config);
      return this.config;
    } catch (error) {
      console.error('Failed to load configuration:', error);
      return this.config;
    }
  }

  /**
   * Validate configuration has required endpoints
   * @throws {Error} If required endpoints are missing
   */
  validateConfig() {
    const requiredEndpoints = [
      'profileServiceUrl',
      'profilePhotoServiceUrl',
      'suggestionHistoryUrl'
    ];

    const missing = requiredEndpoints.filter(endpoint => !this.config[endpoint]);

    if (missing.length > 0) {
      throw new Error(`Missing required configuration endpoints: ${missing.join(', ')}`);
    }
  }

  /**
   * Get configuration synchronously (must call loadConfig first)
   * @returns {Object} Configuration object
   */
  getConfig() {
    if (!this.isLoaded || !this.config) {
      // Auto-initialize for convenience
      const configData = config.get();
      this.config = {
        environment: configData.environment,
        apiHost: configData.api.baseUrl,
        ...configData.api.endpoints
      };
      this.environment = configData.environment;
      this.isLoaded = true;
    }
    return this.config;
  }

  /**
   * Get specific configuration value
   * @param {string} key - Configuration key
   * @returns {string} Configuration value
   */
  get(key) {
    const configData = this.getConfig();
    if (!configData[key]) {
      throw new Error(`Configuration key '${key}' not found. Available keys: ${Object.keys(configData).join(', ')}`);
    }
    return configData[key];
  }

  /**
   * Build API URL from template with parameters
   * @param {string} endpoint - Endpoint name (template)
   * @param {Object} params - Parameters to substitute
   * @returns {string} Built URL
   */
  buildApiUrl(endpoint, params = {}) {
    try {
      return config.buildApiUrl(endpoint, params);
    } catch (error) {
      console.error('Failed to build API URL:', error);
      // Fallback to basic URL if available
      return this.get(endpoint);
    }
  }

  /**
   * Get current environment
   * @returns {string} Current environment
   */
  getEnvironment() {
    if (!this.environment) {
      this.getConfig(); // Auto-initialize
    }
    return this.environment || 'unknown';
  }

  /**
   * Check if configuration is loaded
   * @returns {boolean} True if configuration is loaded
   */
  isConfigLoaded() {
    return this.isLoaded;
  }

  /**
   * Reload configuration
   * @param {string} forceEnv - Force specific environment (optional)
   * @returns {Promise<Object>} Configuration object
   */
  async reloadConfig(forceEnv = null) {
    this.isLoaded = false;
    this.config = null;
    this.environment = null;
    return this.loadConfig(forceEnv);
  }
}

/**
 * Legacy functions for backward compatibility
 * @deprecated Use the unified config system directly instead
 */
function determineEnvironment() {
  return config.getEnvironment();
}

function getEnvironmentConfig(env) {
  const configData = config.init(env);
  return {
    environment: configData.environment,
    apiHost: configData.api.baseUrl,
    protocol: configData.api.protocol,
    ...configData.api.endpoints
  };
}

// Export singleton instance
const configLoader = new ConfigLoader();

module.exports = {
  ConfigLoader,
  configLoader,
  determineEnvironment,
  getEnvironmentConfig
};
