/**
 * Service for handling communication between content script and background script
 */
const { MessageTypes } = require('../config/messageTypes.js');
const { browserCompat } = require('../utils/browserCompatibility.js');

class CommunicationService {
  constructor() {
    this.port = null;
    this.isAuthenticated = false;
    this.messageListeners = new Map();
    this.connectPort();
  }

  /**
   * Connect to the background script
   */
  connectPort() {
    this.port = browserCompat.connectPort({ name: 'comms' });

    // Handle port messages
    this.port.onMessage.addListener((message) => {
      this.handlePortMessage(message);
    });
  }

  /**
   * Handle messages received through the port
   * @param {Object} message - Received message
   */
  handlePortMessage(message) {
    // Background script sends responses with 'status' field, not 'type'
    const messageType = message.status || message.type;
    const listener = this.messageListeners.get(messageType);
    if (listener) {
      listener(message);
    }
  }

  /**
   * Add a message listener for specific message types
   * @param {string} messageType - Type of message to listen for
   * @param {Function} callback - Callback function to handle the message
   */
  addMessageListener(messageType, callback) {
    this.messageListeners.set(messageType, callback);
  }

  /**
   * Remove a message listener
   * @param {string} messageType - Type of message to stop listening for
   */
  removeMessageListener(messageType) {
    this.messageListeners.delete(messageType);
  }

  /**
   * Send a message to the background script
   * @param {Object} message - Message to send
   */
  sendMessage(message) {
    if (this.port) {
      this.port.postMessage(message);
    }
  }

  /**
   * Send a message to the background script and wait for response
   * @param {Object} message - Message to send
   * @returns {Promise} Promise that resolves with the response
   */
  sendMessageWithResponse(message) {
    return new Promise((resolve, reject) => {
      browserCompat.sendRuntimeMessage(message, (response, error) => {
        if (error) {
          reject(error);
        } else {
          resolve(response);
        }
      });
    });
  }

  /**
   * Check authentication status
   * @returns {Promise<boolean>} Promise that resolves with authentication status
   */
  async checkAuthentication() {
    try {
      const response = await this.sendMessageWithResponse({
        type: MessageTypes.CONTENT_AUTH_UPDATE
      });
      this.isAuthenticated = response.isAuthenticated;
      return this.isAuthenticated;
    } catch (error) {
      console.warn('Failed to check authentication:', error);
      this.isAuthenticated = false;
      return false;
    }
  }


  /**
   * Get current authentication status
   * @returns {boolean} Current authentication status
   */
  getAuthenticationStatus() {
    return this.isAuthenticated;
  }

  /**
   * Set authentication status
   * @param {boolean} status - Authentication status
   */
  setAuthenticationStatus(status) {
    this.isAuthenticated = status;
  }

  /**
   * Get the port connection
   * @returns {Object} Port connection
   */
  getPort() {
    return this.port;
  }

  /**
   * Check if port is connected
   * @returns {boolean} True if port is connected
   */
  isPortConnected() {
    return this.port !== null;
  }

  /**
   * Disconnect the port
   */
  disconnectPort() {
    if (this.port) {
      this.port.disconnect();
      this.port = null;
    }
  }

  /**
   * Get credentials from background script
   * @returns {Promise<Object|null>} Promise that resolves with credentials or null
   */
  async getCredentials() {
    try {
      const response = await this.sendMessageWithResponse({
        type: MessageTypes.GET_CREDENTIALS
      });
      return response.credentials;
    } catch (error) {
      console.warn('Failed to get credentials:', error);
      return null;
    }
  }

  /**
   * Get profile data from background script
   * @returns {Promise<Object|null>} Promise that resolves with profile or null
   */
  async getProfile() {
    try {
      const response = await this.sendMessageWithResponse({
        type: MessageTypes.GET_PROFILE
      });
      if (response.success) {
        return response.profile;
      } else {
        console.warn('Failed to get profile:', response.error);
        return null;
      }
    } catch (error) {
      console.warn('Failed to get profile:', error);
      return null;
    }
  }

  /**
   * Send streaming update to background script
   * @param {Object} data - Streaming data
   */
  sendStreamingUpdate(data) {
    this.sendMessage({
      type: MessageTypes.STREAMING_UPDATE,
      data
    });
  }

  /**
   * Send streaming error to background script
   * @param {string} error - Error message
   */
  sendStreamingError(error) {
    this.sendMessage({
      type: MessageTypes.STREAMING_ERROR,
      error
    });
  }

  /**
   * Send streaming completion to background script
   * @param {Object} data - Completion data
   */
  sendStreamingComplete(data) {
    this.sendMessage({
      type: MessageTypes.STREAMING_COMPLETE,
      data
    });
  }

  /**
   * Fetch suggestion types from server (forces refresh)
   * @returns {Promise<Array>} Promise that resolves with suggestion types
   */
  async fetchSuggestionTypes() {
    try {
      const response = await this.sendMessageWithResponse({
        type: MessageTypes.FETCH_SUGGESTION_TYPES
      });
      if (response.success) {
        return response.suggestionTypes || [];
      } else {
        console.warn('Failed to fetch suggestion types:', response.error);
        return [];
      }
    } catch (error) {
      console.warn('Failed to fetch suggestion types:', error);
      return [];
    }
  }

  /**
   * List suggestion types (from cache or server)
   * @param {boolean} enabledOnly - Filter to enabled types only
   * @returns {Promise<Array>} Promise that resolves with suggestion types
   */
  async listSuggestionTypes(enabledOnly = false) {
    try {
      const response = await this.sendMessageWithResponse({
        type: MessageTypes.LIST_SUGGESTION_TYPES,
        enabledOnly
      });
      if (response.success) {
        return response.suggestionTypes || [];
      } else {
        console.warn('Failed to list suggestion types:', response.error);
        return [];
      }
    } catch (error) {
      console.warn('Failed to list suggestion types:', error);
      return [];
    }
  }

  /**
   * Create a new suggestion type
   * @param {Object} suggestionType - Suggestion type to create
   * @returns {Promise<Object|null>} Promise that resolves with created suggestion type
   */
  async createSuggestionType(suggestionType) {
    try {
      const response = await this.sendMessageWithResponse({
        type: MessageTypes.CREATE_SUGGESTION_TYPE,
        suggestionType
      });
      if (response.success) {
        return response.suggestionType;
      } else {
        throw new Error(response.error || 'Failed to create suggestion type');
      }
    } catch (error) {
      console.error('Failed to create suggestion type:', error);
      throw error;
    }
  }

  /**
   * Update an existing suggestion type
   * @param {Object} suggestionType - Suggestion type to update
   * @returns {Promise<Object|null>} Promise that resolves with updated suggestion type
   */
  async updateSuggestionType(suggestionType) {
    try {
      const response = await this.sendMessageWithResponse({
        type: MessageTypes.UPDATE_SUGGESTION_TYPE,
        suggestionType
      });
      if (response.success) {
        return response.suggestionType;
      } else {
        throw new Error(response.error || 'Failed to update suggestion type');
      }
    } catch (error) {
      console.error('Failed to update suggestion type:', error);
      throw error;
    }
  }

  /**
   * Delete a suggestion type
   * @param {Object} suggestionType - Suggestion type to delete
   * @returns {Promise<boolean>} Promise that resolves with success status
   */
  async deleteSuggestionType(suggestionType) {
    try {
      const response = await this.sendMessageWithResponse({
        type: MessageTypes.DELETE_SUGGESTION_TYPE,
        suggestionType
      });
      if (response.success) {
        return true;
      } else {
        throw new Error(response.error || 'Failed to delete suggestion type');
      }
    } catch (error) {
      console.error('Failed to delete suggestion type:', error);
      throw error;
    }
  }

  /**
   * Toggle suggestion type enabled state
   * @param {Object} suggestionType - Suggestion type to toggle
   * @param {boolean} isEnabled - New enabled state
   * @returns {Promise<Object|null>} Promise that resolves with updated suggestion type
   */
  async toggleSuggestionType(suggestionType, isEnabled) {
    try {
      const response = await this.sendMessageWithResponse({
        type: MessageTypes.TOGGLE_SUGGESTION_TYPE,
        suggestionType,
        isEnabled
      });
      if (response.success) {
        return response.suggestionType;
      } else {
        throw new Error(response.error || 'Failed to toggle suggestion type');
      }
    } catch (error) {
      console.error('Failed to toggle suggestion type:', error);
      throw error;
    }
  }

  /**
   * Reset suggestion types to defaults
   * @returns {Promise<number>} Promise that resolves with count of types reset
   */
  async resetSuggestionTypes() {
    try {
      const response = await this.sendMessageWithResponse({
        type: MessageTypes.RESET_SUGGESTION_TYPES
      });
      if (response.success) {
        return response.count || 0;
      } else {
        throw new Error(response.error || 'Failed to reset suggestion types');
      }
    } catch (error) {
      console.error('Failed to reset suggestion types:', error);
      throw error;
    }
  }
}

module.exports = { CommunicationService };
