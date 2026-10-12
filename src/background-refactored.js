/**
 * Refactored Background Script
 * Production-ready service worker with SOLID principles and persistent authentication
 * Implements Dependency Injection and Service-Oriented Architecture
 */

// Import service factory and core services
import { serviceFactory } from './core/factories/ServiceFactory.js';
import { MessageTypes } from './config/messageTypes.js';
import { IAuthenticationObserver } from './core/interfaces/IAuthenticationService.js';

/**
 * Background service manager implementing Observer pattern
 */
class BackgroundServiceManager extends IAuthenticationObserver {
  constructor() {
    super();
    this.isInitialized = false;
    this.logger = null;
    this.authService = null;
    this.profileService = null;
    this.credentialStorage = null;

    // Port connections for real-time communication
    this.activeConnections = new Map();

    this.initialize();
  }

  /**
   * Initialize the background service manager
   */
  async initialize() {
    try {
      console.log('Initializing PromptShields background service...');

      // Initialize service factory
      await serviceFactory.initialize();

      // Get service instances
      this.logger = serviceFactory.getLoggingService();
      this.authService = serviceFactory.getAuthenticationService();
      this.profileService = serviceFactory.getProfileService();
      this.credentialStorage = serviceFactory.getCredentialStorage();

      // Set up authentication observer
      this.authService.addObserver(this);

      // Set up extension event listeners
      this.setupExtensionListeners();

      // Set up tab management
      this.setupTabManagement();

      // Set up periodic maintenance
      this.setupPeriodicMaintenance();

      this.isInitialized = true;
      this.logger.info('Background service manager initialized successfully');

      // Check initial authentication state
      const isAuthenticated = await this.authService.isAuthenticated();
      this.logger.info('Initial authentication state', { isAuthenticated });

    } catch (error) {
      console.error('Background service initialization failed:', error);
      // Fallback to basic functionality
      this.setupFallbackListeners();
    }
  }

  /**
   * Setup extension event listeners
   */
  setupExtensionListeners() {
    // Handle port connections (popup, content scripts)
    chrome.runtime.onConnect.addListener((port) => {
      this.handlePortConnection(port);
    });

    // Handle one-time messages
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      this.handleRuntimeMessage(message, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });

    // Handle extension lifecycle
    chrome.runtime.onStartup.addListener(() => {
      this.logger?.info('Extension startup detected');
    });

    chrome.runtime.onSuspend?.addListener(() => {
      this.logger?.info('Extension suspending - authentication state preserved');
    });

    // Handle installation and updates
    chrome.runtime.onInstalled.addListener((details) => {
      this.handleInstallation(details);
    });
  }

  /**
   * Handle port connections for real-time communication
   * @param {chrome.runtime.Port} port - Connected port
   */
  handlePortConnection(port) {
    const connectionId = `${port.name}_${Date.now()}`;
    this.activeConnections.set(connectionId, port);

    this.logger?.debug('Port connected', {
      portName: port.name,
      connectionId,
      totalConnections: this.activeConnections.size
    });

    // Handle messages from this port
    port.onMessage.addListener(async (message) => {
      try {
        await this.handlePortMessage(message, port);
      } catch (error) {
        this.logger?.error('Port message handling failed', error);
        port.postMessage({
          type: 'error',
          error: 'Internal error occurred'
        });
      }
    });

    // Clean up on disconnect
    port.onDisconnect.addListener(() => {
      this.activeConnections.delete(connectionId);
      this.logger?.debug('Port disconnected', {
        portName: port.name,
        connectionId,
        totalConnections: this.activeConnections.size
      });
    });
  }

  /**
   * Handle messages from connected ports
   * @param {Object} message - Message from port
   * @param {chrome.runtime.Port} port - Sender port
   */
  async handlePortMessage(message, port) {
    const { type } = message;

    this.logger?.debug('Received port message', { type, portName: port.name });

    switch (type) {
    case MessageTypes.AUTHORIZE:
      await this.handleAuthenticationRequest(port);
      break;

    case MessageTypes.LOGOUT:
      await this.handleLogoutRequest(port);
      break;

    case MessageTypes.PING:
      await this.handlePingRequest(port);
      break;

    case MessageTypes.GET_CREDENTIALS:
      await this.handleCredentialsRequest(port);
      break;

    case MessageTypes.GET_PROFILE:
      await this.handleProfileRequest(port);
      break;

    default:
      this.logger?.warn('Unknown port message type', { type });
      port.postMessage({
        type: 'error',
        error: `Unknown message type: ${type}`
      });
    }
  }

  /**
   * Handle runtime messages (one-time messages)
   * @param {Object} message - Message object
   * @param {Object} sender - Message sender
   * @param {Function} sendResponse - Response callback
   */
  async handleRuntimeMessage(message, sender, sendResponse) {
    const { type } = message;

    this.logger?.debug('Received runtime message', {
      type,
      tabId: sender.tab?.id,
      frameId: sender.frameId
    });

    try {
      switch (type) {
      case MessageTypes.CONTENT_AUTH_UPDATE: {
        const isAuthenticated = await this.authService.isAuthenticated();
        sendResponse({ isAuthenticated });
        break;
      }

      case MessageTypes.GET_CREDENTIALS: {
        const credentials = await this.credentialStorage.getCredentials();
        sendResponse({ credentials });
        break;
      }

      case MessageTypes.GET_PROFILE: {
        const profile = await this.getProfileForRequest();
        sendResponse({
          success: !!profile,
          profile,
          error: profile ? null : 'Profile not available'
        });
        break;
      }

      case 'openPopup':
        // Handle popup open request from content script
        sendResponse({ success: true });
        break;

      default:
        this.logger?.warn('Unknown runtime message type', { type });
        sendResponse({ error: `Unknown message type: ${type}` });
      }
    } catch (error) {
      this.logger?.error('Runtime message handling failed', error);
      sendResponse({ error: 'Internal error occurred' });
    }
  }

  /**
   * Handle authentication request
   * @param {chrome.runtime.Port} port - Requesting port
   */
  async handleAuthenticationRequest(port) {
    try {
      this.logger?.info('Processing authentication request');

      const userData = await this.authService.authenticate();

      port.postMessage({
        status: MessageTypes.AUTHORIZE,
        userData,
        success: true
      });

      // Broadcast authentication state change
      this.broadcastAuthenticationUpdate(true);

    } catch (error) {
      this.logger?.error('Authentication request failed', error);

      port.postMessage({
        status: MessageTypes.AUTHORIZE,
        success: false,
        error: error.message || 'Authentication failed'
      });

      this.broadcastAuthenticationUpdate(false);
    }
  }

  /**
   * Handle logout request
   * @param {chrome.runtime.Port} port - Requesting port
   */
  async handleLogoutRequest(port) {
    try {
      this.logger?.info('Processing logout request');

      await this.authService.logout();

      port.postMessage({
        status: MessageTypes.LOGOUT,
        success: true
      });

      // Broadcast authentication state change
      this.broadcastAuthenticationUpdate(false);

    } catch (error) {
      this.logger?.error('Logout request failed', error);

      port.postMessage({
        status: MessageTypes.LOGOUT,
        success: false,
        error: error.message || 'Logout failed'
      });
    }
  }

  /**
   * Handle ping request (authentication status check)
   * @param {chrome.runtime.Port} port - Requesting port
   */
  async handlePingRequest(port) {
    try {
      const isAuthenticated = await this.authService.isAuthenticated();

      if (isAuthenticated) {
        const userData = await this.authService.getCurrentUser();

        port.postMessage({
          status: MessageTypes.GET_USER,
          success: true,
          userData
        });
      } else {
        port.postMessage({
          status: MessageTypes.GET_USER,
          success: false
        });
      }

    } catch (error) {
      this.logger?.error('Ping request failed', error);

      port.postMessage({
        status: MessageTypes.GET_USER,
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Handle credentials request
   * @param {chrome.runtime.Port} port - Requesting port
   */
  async handleCredentialsRequest(port) {
    try {
      const credentials = await this.credentialStorage.getCredentials();

      port.postMessage({ credentials });

    } catch (error) {
      this.logger?.error('Credentials request failed', error);
      port.postMessage({ credentials: null });
    }
  }

  /**
   * Handle profile request
   * @param {chrome.runtime.Port} port - Requesting port
   */
  async handleProfileRequest(port) {
    try {
      const profile = await this.getProfileForRequest();

      if (profile) {
        port.postMessage({
          status: MessageTypes.GET_PROFILE,
          success: true,
          profile
        });
      } else {
        port.postMessage({
          status: MessageTypes.GET_PROFILE,
          success: false,
          error: 'Profile not available'
        });
      }

    } catch (error) {
      this.logger?.error('Profile request failed', error);

      port.postMessage({
        status: MessageTypes.GET_PROFILE,
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Get profile for API requests
   * @returns {Promise<Object|null>} User profile
   */
  async getProfileForRequest() {
    try {
      // First try cached profile
      let profile = await this.profileService.getCachedProfile();

      if (!profile) {
        // If no cached profile, try to fetch it
        const credentials = await this.credentialStorage.getCredentials();
        if (credentials) {
          profile = await this.profileService.fetchProfile(credentials);
        }
      }

      return profile;

    } catch (error) {
      this.logger?.error('Error getting profile for request', error);
      return null;
    }
  }

  /**
   * Setup tab management for extension activation
   */
  setupTabManagement() {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete' && tab.url) {
        this.handleTabUpdate(tabId, tab);
      }
    });
  }

  /**
   * Handle tab updates for extension activation
   * @param {number} tabId - Tab ID
   * @param {Object} tab - Tab object
   */
  handleTabUpdate(tabId, tab) {
    try {
      const allowedDomains = [
        'openai.com', 'huggingface.co', 'runwayml.com', 'deepmind.com',
        'anthropic.com', 'cohere.ai', 'stability.ai', 'perplexity.ai',
        'copy.ai', 'jasper.ai', 'midjourney.com', 'scribehow.com',
        'writesonic.com', 'speechmatics.com', 'gradio.app', 'notion.so',
        'fathom.video', 'gptzero.me', 'fireflies.ai', 'deepseek.com',
        'chatgpt.com', 'poe.com', 'synthesia.io', 'elevenlabs.io',
        'replika.ai', 'murf.ai', 'grammarly.com', 'gemini.google.com',
        'copilot.microsoft.com', 'character.ai', 'you.com', 'chatbotapp.ai'
      ];

      const isAllowed = allowedDomains.some(domain => tab.url.includes(domain));

      if (isAllowed) {
        chrome.action.enable(tabId);
      } else {
        chrome.action.disable(tabId);
      }

    } catch (error) {
      this.logger?.error('Tab update handling failed', error);
    }
  }

  /**
   * Handle extension installation and updates
   * @param {Object} details - Installation details
   */
  handleInstallation(details) {
    this.logger?.info('Extension installation/update', {
      reason: details.reason,
      version: chrome.runtime.getManifest().version
    });

    if (details.reason === 'install') {
      // First installation
      this.logger?.info('First installation detected');
    } else if (details.reason === 'update') {
      // Extension update
      this.logger?.info('Extension update detected', {
        previousVersion: details.previousVersion
      });
    }
  }

  /**
   * Broadcast authentication state changes to all connected clients
   * @param {boolean} isAuthenticated - Authentication state
   */
  broadcastAuthenticationUpdate(isAuthenticated) {
    // Broadcast to connected ports
    for (const port of this.activeConnections.values()) {
      try {
        port.postMessage({
          type: MessageTypes.AUTHENTICATION_UPDATE,
          isAuthenticated
        });
      } catch (error) {
        this.logger?.warn('Failed to broadcast to port', error);
      }
    }

    // Broadcast to content scripts
    this.sendAuthUpdateToContentScripts(isAuthenticated);
  }

  /**
   * Send authentication updates to content scripts
   * @param {boolean} isAuthenticated - Authentication state
   */
  sendAuthUpdateToContentScripts(isAuthenticated) {
    chrome.tabs.query({ currentWindow: true }, (tabs) => {
      if (tabs.length > 0) {
        tabs.forEach(tab => {
          if (this.isTabSupported(tab.url)) {
            chrome.tabs.sendMessage(tab.id, {
              type: MessageTypes.AUTHENTICATION_UPDATE,
              isAuthenticated
            }, () => {
              if (chrome.runtime.lastError) {
                // Content script might not be loaded yet - this is normal
                this.logger?.debug(`Content script not ready on tab ${tab.id}`);
              }
            });
          }
        });
      }
    });
  }

  /**
   * Check if tab URL is supported by the extension
   * @param {string} url - Tab URL
   * @returns {boolean} True if supported
   */
  isTabSupported(url) {
    if (!url) return false;

    const supportedPatterns = [
      'openai.com', 'chatgpt.com', 'huggingface.co', 'anthropic.com',
      'claude.ai', 'cohere.ai', 'stability.ai', 'perplexity.ai',
      'localhost' // For development
    ];

    return supportedPatterns.some(pattern => url.includes(pattern));
  }

  /**
   * Setup periodic maintenance tasks
   */
  setupPeriodicMaintenance() {
    // Run maintenance every 30 minutes
    setInterval(async () => {
      try {
        await this.performMaintenance();
      } catch (error) {
        this.logger?.error('Periodic maintenance failed', error);
      }
    }, 30 * 60 * 1000);
  }

  /**
   * Perform periodic maintenance tasks
   */
  async performMaintenance() {
    this.logger?.debug('Performing periodic maintenance');

    try {
      // Clean up credential storage
      if (this.credentialStorage && typeof this.credentialStorage.cleanup === 'function') {
        await this.credentialStorage.cleanup();
      }

      // Health check on services
      const healthCheck = await serviceFactory.healthCheck();
      if (healthCheck.overall !== 'healthy') {
        this.logger?.warn('Service health check failed', healthCheck);
      }

      // Clean up stale port connections
      this.cleanupStaleConnections();

    } catch (error) {
      this.logger?.error('Maintenance task failed', error);
    }
  }

  /**
   * Clean up stale port connections
   */
  cleanupStaleConnections() {
    const staleConnections = [];

    for (const [connectionId, port] of this.activeConnections.entries()) {
      try {
        // Try to send a ping message to check if port is still active
        port.postMessage({ type: 'ping' });
      } catch (error) {
        // Port is disconnected, mark for cleanup
        staleConnections.push(connectionId);
      }
    }

    staleConnections.forEach(connectionId => {
      this.activeConnections.delete(connectionId);
    });

    if (staleConnections.length > 0) {
      this.logger?.debug('Cleaned up stale connections', {
        count: staleConnections.length
      });
    }
  }

  /**
   * Setup fallback listeners for basic functionality
   */
  setupFallbackListeners() {
    console.warn('Setting up fallback listeners due to initialization failure');

    // Basic message handling without services
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === MessageTypes.GET_CREDENTIALS) {
        sendResponse({ credentials: null });
      } else {
        sendResponse({ error: 'Service unavailable' });
      }
    });
  }

  // Authentication Observer Implementation

  /**
   * Called when authentication state changes
   * @param {boolean} isAuthenticated - New authentication state
   * @param {Object|null} userData - User data if authenticated
   */
  onAuthenticationStateChanged(isAuthenticated, userData) {
    this.logger?.info('Authentication state changed', {
      isAuthenticated,
      hasUserData: !!userData
    });

    this.broadcastAuthenticationUpdate(isAuthenticated);
  }

  /**
   * Called when authentication error occurs
   * @param {Error} error - Authentication error
   */
  onAuthenticationError(error) {
    this.logger?.error('Authentication error occurred', error);

    // Broadcast error state
    this.broadcastAuthenticationUpdate(false);
  }

  /**
   * Get background service statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      activeConnections: this.activeConnections.size,
      serviceFactory: serviceFactory.getStats(),
      uptime: Date.now() - (this.initTime || Date.now())
    };
  }
}

// Initialize background service manager
const backgroundManager = new BackgroundServiceManager();

// Global error handlers
self.addEventListener('error', (event) => {
  console.error('Background script error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection in background:', event.reason);
});

// Export for debugging
self.backgroundManager = backgroundManager;
self.serviceFactory = serviceFactory;

