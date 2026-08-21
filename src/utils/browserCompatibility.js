/**
 * Browser compatibility utility for Chrome and Edge extensions
 * Handles differences between Chrome and Edge extension APIs
 */

export class BrowserCompatibility {
  constructor() {
    this.isEdge = this.detectEdge();
    this.isChrome = this.detectChrome();
  }

  /**
   * Detect if running in Microsoft Edge
   * @returns {boolean} True if running in Edge
   */
  detectEdge() {
    return navigator.userAgent.includes('Edg/') ||
      navigator.userAgent.includes('Edge/') ||
      (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id &&
        chrome.runtime.getManifest && chrome.runtime.getManifest().name === 'PromptShields');
  }

  /**
   * Detect if running in Google Chrome
   * @returns {boolean} True if running in Chrome
   */
  detectChrome() {
    return navigator.userAgent.includes('Chrome/') && !this.detectEdge();
  }

  /**
   * Get browser-specific redirect URI
   * @returns {string} Redirect URI for the current browser
   */
  getRedirectURI() {
    try {
      const redirectUrl = chrome.identity.getRedirectURL();
      console.log('Redirect URI from chrome.identity:', redirectUrl);
      return redirectUrl;
    } catch (error) {
      console.warn('Failed to get redirect URI:', error);
      // Fallback for Edge if needed
      if (this.isEdge) {
        const extensionId = chrome.runtime.id;
        return `https://${extensionId}.chromiumapp.org`;
      }
      // Fallback for Chrome
      const extensionId = chrome.runtime.id;
      return `https://${extensionId}.chromiumapp.org`;
    }
  }

  /**
   * Launch OAuth flow with browser-specific handling
   * @param {Object} options - OAuth flow options
   * @returns {Promise<string>} Promise that resolves with redirect URL
   */
  launchWebAuthFlow(options) {
    return new Promise((resolve, reject) => {
      try {
        chrome.identity.launchWebAuthFlow(options, (redirectUrl) => {
          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError;
            console.warn('OAuth flow error:', error);

            // Handle Edge-specific errors
            if (this.isEdge && error.message.includes('redirect_uri_mismatch')) {
              reject(new Error('OAuth redirect URI mismatch. Please check your Edge extension configuration.'));
            } else {
              reject(new Error(error.message));
            }
          } else {
            resolve(redirectUrl);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Get browser-specific storage with error handling
   * @param {string|Array} keys - Storage keys to retrieve
   * @returns {Promise<Object>} Promise that resolves with storage data
   */
  async getStorage(keys) {
    try {
      return await chrome.storage.local.get(keys);
    } catch (error) {
      console.warn('Storage get error:', error);
      throw error;
    }
  }

  /**
   * Set browser-specific storage with error handling
   * @param {Object} items - Storage items to set
   * @returns {Promise<void>} Promise that resolves when storage is set
   */
  async setStorage(items) {
    try {
      return await chrome.storage.local.set(items);
    } catch (error) {
      console.warn('Storage set error:', error);
      throw error;
    }
  }

  /**
   * Remove browser-specific storage with error handling
   * @param {string|Array} keys - Storage keys to remove
   * @returns {Promise<void>} Promise that resolves when storage is removed
   */
  async removeStorage(keys) {
    try {
      return await chrome.storage.local.remove(keys);
    } catch (error) {
      console.warn('Storage remove error:', error);
      throw error;
    }
  }

  /**
   * Send runtime message with browser-specific error handling
   * @param {Object} message - Message to send
   * @param {Function} callback - Callback function
   */
  sendRuntimeMessage(message, callback) {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          const error = chrome.runtime.lastError;
          console.warn('Runtime message error:', error);

          // Handle Edge-specific message errors
          if (this.isEdge && error.message.includes('Could not establish connection')) {
            callback(null, new Error('Extension communication failed. Please reload the extension.'));
          } else {
            callback(null, new Error(error.message));
          }
        } else {
          callback(response, null);
        }
      });
    } catch (error) {
      callback(null, error);
    }
  }

  /**
   * Connect to runtime port with browser-specific error handling
   * @param {Object} connectInfo - Connection info
   * @returns {Object} Port connection
   */
  connectPort(connectInfo) {
    try {
      return chrome.runtime.connect(connectInfo);
    } catch (error) {
      console.warn('Port connection error:', error);
      throw error;
    }
  }

  /**
   * Get browser-specific manifest info
   * @returns {Object} Manifest information
   */
  getManifest() {
    try {
      return chrome.runtime.getManifest();
    } catch (error) {
      console.warn('Failed to get manifest:', error);
      return null;
    }
  }

  /**
   * Get browser-specific extension ID
   * @returns {string} Extension ID
   */
  getExtensionId() {
    try {
      return chrome.runtime.id;
    } catch (error) {
      console.warn('Failed to get extension ID:', error);
      return null;
    }
  }

  /**
   * Check if a specific API is available
   * @param {string} apiName - Name of the API to check
   * @returns {boolean} True if API is available
   */
  isApiAvailable(apiName) {
    try {
      switch (apiName) {
        case 'identity':
          return typeof chrome !== 'undefined' && chrome.identity;
        case 'storage':
          return typeof chrome !== 'undefined' && chrome.storage;
        case 'runtime':
          return typeof chrome !== 'undefined' && chrome.runtime;
        case 'tabs':
          return typeof chrome !== 'undefined' && chrome.tabs;
        case 'action':
          return typeof chrome !== 'undefined' && chrome.action;
        default:
          return false;
      }
    } catch (error) {
      console.warn(`API availability check failed for ${apiName}:`, error);
      return false;
    }
  }

  /**
   * Get browser-specific user agent info
   * @returns {Object} Browser information
   */
  getBrowserInfo() {
    return {
      userAgent: navigator.userAgent,
      isEdge: this.isEdge,
      isChrome: this.isChrome,
      version: this.getBrowserVersion()
    };
  }

  /**
   * Get browser version
   * @returns {string} Browser version
   */
  getBrowserVersion() {
    const userAgent = navigator.userAgent;

    if (this.isEdge) {
      const match = userAgent.match(/Edg\/(\d+)/);
      return match ? match[1] : 'unknown';
    } else if (this.isChrome) {
      const match = userAgent.match(/Chrome\/(\d+)/);
      return match ? match[1] : 'unknown';
    }

    return 'unknown';
  }

  /**
   * Log browser-specific debug information
   */
  logDebugInfo() {
    console.log('Browser Compatibility Info:', {
      browser: this.isEdge ? 'Edge' : this.isChrome ? 'Chrome' : 'Unknown',
      version: this.getBrowserVersion(),
      extensionId: this.getExtensionId(),
      manifest: this.getManifest(),
      apis: {
        identity: this.isApiAvailable('identity'),
        storage: this.isApiAvailable('storage'),
        runtime: this.isApiAvailable('runtime'),
        tabs: this.isApiAvailable('tabs'),
        action: this.isApiAvailable('action')
      }
    });
  }
}

// Create a singleton instance
export const browserCompat = new BrowserCompatibility();
