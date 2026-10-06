/**
 * Google Analytics Tracker
 * Google Analytics 4 tracker using Measurement Protocol
 * Mirrors the macOS GoogleAnalyticsTracker.swift implementation
 */

import { AnalyticsTracker, TrackerType, AnalyticsConfiguration } from '../AnalyticsTracker.js';

// Storage key for client ID
const GA_CLIENT_ID_KEY = 'analytics_ga_client_id';

/**
 * Google Analytics 4 tracker using Measurement Protocol
 */
export class GoogleAnalyticsTracker extends AnalyticsTracker {
  /**
   * Create a Google Analytics tracker
   * @param {string} measurementId - GA4 Measurement ID
   * @param {string} apiSecret - GA4 API Secret
   * @param {AnalyticsConfiguration} configuration - Tracker configuration
   */
  constructor(measurementId, apiSecret, configuration = AnalyticsConfiguration.default) {
    super(TrackerType.GOOGLE_ANALYTICS, configuration);

    this._measurementId = measurementId;
    this._apiSecret = apiSecret;
    this._clientId = null;
    this._eventQueue = [];
    this._flushIntervalId = null;
    this._baseURL = 'https://www.google-analytics.com/mp/collect';
  }

  /**
   * Initialize the tracker
   * @returns {Promise<void>}
   */
  async initialize() {
    // Generate or retrieve persistent client ID
    this._clientId = await this._getOrCreateClientId();

    console.log('[GoogleAnalyticsTracker] Initialized');
    console.log(`[GoogleAnalyticsTracker] Measurement ID: ${this._measurementId}`);
    console.log(`[GoogleAnalyticsTracker] Client ID: ${this._clientId}`);

    // Start periodic flush
    this._startPeriodicFlush();
  }

  /**
   * Track an analytics event
   * @param {AnalyticsEvent} event - The event to track
   * @returns {Promise<void>}
   */
  async track(event) {
    if (!this._isEnabled) {
      if (this._configuration.isDebugMode) {
        console.debug(`[GoogleAnalyticsTracker] Tracker disabled, skipping event: ${event.name}`);
      }
      return;
    }

    if (!this._measurementId || !this._apiSecret) {
      if (this._configuration.isDebugMode) {
        console.debug(`[GoogleAnalyticsTracker] Missing credentials, skipping event: ${event.name}`);
      }
      return;
    }

    const queuedEvent = {
      event,
      timestamp: new Date()
    };

    this._eventQueue.push(queuedEvent);

    if (this._configuration.isDebugMode) {
      console.debug(`[GoogleAnalyticsTracker] Queued event: ${event.name}`, event.parameters);
    }

    // Flush if batch size reached
    if (this._eventQueue.length >= this._configuration.maxBatchSize) {
      await this.flush();
    }
  }

  /**
   * Set user properties for the tracker
   * @param {AnalyticsUserProperties} properties - User properties to set
   * @returns {Promise<void>}
   */
  async setUserProperties(properties) {
    await super.setUserProperties(properties);
    console.debug('[GoogleAnalyticsTracker] User properties updated');
  }

  /**
   * Reset the tracker
   * @returns {Promise<void>}
   */
  async reset() {
    this._eventQueue = [];
    await super.reset();
    console.log('[GoogleAnalyticsTracker] Tracker reset');
  }

  /**
   * Flush pending events to GA4
   * @returns {Promise<void>}
   */
  async flush() {
    if (this._eventQueue.length === 0) return;

    const eventsToSend = [...this._eventQueue];
    this._eventQueue = [];

    await this._sendEvents(eventsToSend);
  }

  /**
   * Enable or disable the tracker
   * @param {boolean} enabled - Whether to enable the tracker
   * @returns {Promise<void>}
   */
  async setEnabled(enabled) {
    await super.setEnabled(enabled);
    console.log(`[GoogleAnalyticsTracker] Tracker ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Clean up resources
   */
  destroy() {
    this._stopPeriodicFlush();
  }

  // Private methods

  /**
   * Get or create persistent client ID
   * @returns {Promise<string>}
   * @private
   */
  async _getOrCreateClientId() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const result = await chrome.storage.local.get(GA_CLIENT_ID_KEY);
        if (result[GA_CLIENT_ID_KEY]) {
          return result[GA_CLIENT_ID_KEY];
        }

        // Generate new client ID
        const newClientId = this._generateUUID();
        await chrome.storage.local.set({ [GA_CLIENT_ID_KEY]: newClientId });
        return newClientId;
      }
    } catch (error) {
      console.warn('[GoogleAnalyticsTracker] Failed to get client ID from storage:', error);
    }

    // Fallback to session-based ID
    return this._generateUUID();
  }

  /**
   * Generate a UUID
   * @returns {string}
   * @private
   */
  _generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Start periodic flush interval
   * @private
   */
  _startPeriodicFlush() {
    this._stopPeriodicFlush();
    this._flushIntervalId = setInterval(() => {
      this.flush().catch(error => {
        console.error('[GoogleAnalyticsTracker] Periodic flush error:', error);
      });
    }, this._configuration.flushInterval);
  }

  /**
   * Stop periodic flush interval
   * @private
   */
  _stopPeriodicFlush() {
    if (this._flushIntervalId) {
      clearInterval(this._flushIntervalId);
      this._flushIntervalId = null;
    }
  }

  /**
   * Send events to GA4
   * @param {Array} events - Events to send
   * @private
   */
  async _sendEvents(events) {
    if (events.length === 0 || !this._measurementId || !this._apiSecret) return;

    const ga4Events = events.map(({ event }) => {
      const params = { ...event.parameters };
      // Add engagement time (required for GA4)
      params.engagement_time_msec = 100;

      return {
        name: event.name,
        params
      };
    });

    // Build user properties if available
    let userProperties = null;
    if (this._userProperties) {
      userProperties = {};
      const props = this._userProperties.asDictionary();
      for (const [key, value] of Object.entries(props)) {
        userProperties[key] = { value: String(value) };
      }
    }

    const payload = {
      client_id: this._clientId,
      user_id: this._userProperties?.userId || undefined,
      user_properties: userProperties,
      events: ga4Events
    };

    // Build URL with query parameters
    const url = new URL(this._baseURL);
    url.searchParams.set('measurement_id', this._measurementId);
    url.searchParams.set('api_secret', this._apiSecret);

    try {
      if (this._configuration.isDebugMode) {
        console.debug('[GoogleAnalyticsTracker] Sending payload:', JSON.stringify(payload, null, 2));
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.status === 204 || response.status === 200) {
        if (this._configuration.isDebugMode) {
          console.debug(`[GoogleAnalyticsTracker] Successfully sent ${events.length} events`);
        }
      } else {
        console.warn(`[GoogleAnalyticsTracker] GA4 returned status code: ${response.status}`);
      }
    } catch (error) {
      console.error('[GoogleAnalyticsTracker] Failed to send events:', error);

      // Re-queue failed events (with limit to prevent infinite growth)
      if (this._eventQueue.length < this._configuration.maxBatchSize * 3) {
        this._eventQueue.unshift(...events);
      }
    }
  }

  /**
   * Create a Google Analytics tracker with default configuration
   * @param {string} measurementId - GA4 Measurement ID
   * @param {string} apiSecret - GA4 API Secret
   * @param {boolean} isDebug - Whether to use debug configuration
   * @returns {GoogleAnalyticsTracker}
   */
  static createDefault(measurementId, apiSecret, isDebug = false) {
    const configuration = isDebug
      ? AnalyticsConfiguration.debug
      : AnalyticsConfiguration.default;

    return new GoogleAnalyticsTracker(measurementId, apiSecret, configuration);
  }
}

export default GoogleAnalyticsTracker;
