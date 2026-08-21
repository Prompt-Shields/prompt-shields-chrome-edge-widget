/**
 * PostHog Analytics Tracker
 * PostHog tracker using the Capture API
 * Mirrors the macOS PostHogTracker.swift implementation
 */

import { AnalyticsTracker, TrackerType, AnalyticsConfiguration } from '../AnalyticsTracker.js';

// Storage key for distinct ID
const POSTHOG_DISTINCT_ID_KEY = 'analytics_posthog_distinct_id';

/**
 * PostHog tracker for product analytics
 */
export class PostHogTracker extends AnalyticsTracker {
  /**
   * Create a PostHog tracker
   * @param {string} apiKey - PostHog API Key
   * @param {string} host - PostHog host URL (default: https://app.posthog.com)
   * @param {AnalyticsConfiguration} configuration - Tracker configuration
   */
  constructor(apiKey, host = 'https://app.posthog.com', configuration = AnalyticsConfiguration.default) {
    super(TrackerType.POSTHOG, configuration);

    this._apiKey = apiKey;
    this._host = host.replace(/\/$/, ''); // Remove trailing slash
    this._distinctId = null;
    this._eventQueue = [];
    this._flushIntervalId = null;
  }

  /**
   * Initialize the tracker
   * @returns {Promise<void>}
   */
  async initialize() {
    // Generate or retrieve persistent distinct ID
    this._distinctId = await this._getOrCreateDistinctId();

    console.log('[PostHogTracker] Initialized');
    console.log(`[PostHogTracker] Host: ${this._host}`);
    console.log(`[PostHogTracker] Distinct ID: ${this._distinctId}`);

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
        console.debug(`[PostHogTracker] Tracker disabled, skipping event: ${event.name}`);
      }
      return;
    }

    if (!this._apiKey) {
      if (this._configuration.isDebugMode) {
        console.debug(`[PostHogTracker] API key not configured, skipping event: ${event.name}`);
      }
      return;
    }

    const queuedEvent = {
      event,
      timestamp: new Date()
    };

    this._eventQueue.push(queuedEvent);

    if (this._configuration.isDebugMode) {
      console.debug(`[PostHogTracker] Queued event: ${event.name}`);
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

    // Send identify call to PostHog
    await this._identify(properties);
    console.debug('[PostHogTracker] User properties updated');
  }

  /**
   * Reset the tracker (e.g., on logout)
   * @returns {Promise<void>}
   */
  async reset() {
    this._eventQueue = [];

    // Generate new distinct ID on reset (e.g., logout)
    const newId = this._generateUUID();
    await this._saveDistinctId(newId);
    this._distinctId = newId;

    await super.reset();
    console.log('[PostHogTracker] Tracker reset with new distinct ID');
  }

  /**
   * Flush pending events to PostHog
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
    console.log(`[PostHogTracker] Tracker ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Clean up resources
   */
  destroy() {
    this._stopPeriodicFlush();
  }

  // Private methods

  /**
   * Get or create persistent distinct ID
   * @returns {Promise<string>}
   * @private
   */
  async _getOrCreateDistinctId() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const result = await chrome.storage.local.get(POSTHOG_DISTINCT_ID_KEY);
        if (result[POSTHOG_DISTINCT_ID_KEY]) {
          return result[POSTHOG_DISTINCT_ID_KEY];
        }

        // Generate new distinct ID
        const newId = this._generateUUID();
        await this._saveDistinctId(newId);
        return newId;
      }
    } catch (error) {
      console.warn('[PostHogTracker] Failed to get distinct ID from storage:', error);
    }

    // Fallback to session-based ID
    return this._generateUUID();
  }

  /**
   * Save distinct ID to storage
   * @param {string} id - Distinct ID
   * @private
   */
  async _saveDistinctId(id) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [POSTHOG_DISTINCT_ID_KEY]: id });
      }
    } catch (error) {
      console.warn('[PostHogTracker] Failed to save distinct ID:', error);
    }
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
        console.error('[PostHogTracker] Periodic flush error:', error);
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
   * Get extension version
   * @returns {string}
   * @private
   */
  _getExtensionVersion() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return chrome.runtime.getManifest().version;
      }
    } catch (e) {
      // Ignore errors
    }
    return 'unknown';
  }

  /**
   * Send identify call to PostHog
   * @param {AnalyticsUserProperties} properties - User properties
   * @private
   */
  async _identify(properties) {
    if (!this._apiKey) return;

    const url = `${this._host}/identify`;

    const setProps = {};
    const setOnceProps = {};

    // Set properties (can be updated)
    const props = properties.asDictionary();
    for (const [key, value] of Object.entries(props)) {
      setProps[key] = value;
    }

    // Set once properties (only set on first identification)
    setOnceProps.first_seen = new Date().toISOString();

    const payload = {
      api_key: this._apiKey,
      distinct_id: properties.userId || this._distinctId,
      $set: setProps,
      $set_once: setOnceProps
    };

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.status === 200) {
        console.debug('[PostHogTracker] Identify successful');
      } else {
        console.warn(`[PostHogTracker] Identify returned status: ${response.status}`);
      }
    } catch (error) {
      console.error('[PostHogTracker] Failed to send identify:', error);
    }
  }

  /**
   * Send events to PostHog
   * @param {Array} events - Events to send
   * @private
   */
  async _sendEvents(events) {
    if (events.length === 0 || !this._apiKey) return;

    const postHogEvents = events.map(({ event, timestamp }) => {
      const properties = { ...event.parameters };

      // Add standard PostHog properties
      properties.$lib = 'promptshields-chrome-extension';
      properties.$lib_version = this._getExtensionVersion();
      properties.$browser = this._getBrowser();

      // Add user properties if available
      if (this._userProperties) {
        if (this._userProperties.userId) {
          properties.$user_id = this._userProperties.userId;
        }
      }

      return {
        event: event.name,
        properties,
        timestamp: timestamp.toISOString(),
        distinct_id: this._userProperties?.userId || this._distinctId
      };
    });

    const payload = {
      api_key: this._apiKey,
      batch: postHogEvents
    };

    const url = `${this._host}/batch`;

    try {
      if (this._configuration.isDebugMode) {
        console.debug('[PostHogTracker] Sending batch:', JSON.stringify(payload, null, 2));
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (response.status === 200) {
        if (this._configuration.isDebugMode) {
          console.debug(`[PostHogTracker] Successfully sent ${events.length} events`);
        }
      } else {
        console.warn(`[PostHogTracker] PostHog returned status code: ${response.status}`);
      }
    } catch (error) {
      console.error('[PostHogTracker] Failed to send events:', error);

      // Re-queue failed events (with limit to prevent infinite growth)
      if (this._eventQueue.length < this._configuration.maxBatchSize * 3) {
        this._eventQueue.unshift(...events);
      }
    }
  }

  /**
   * Get browser name
   * @returns {string}
   * @private
   */
  _getBrowser() {
    const userAgent = navigator.userAgent;
    if (userAgent.includes('Edg/')) return 'Edge';
    if (userAgent.includes('Chrome/')) return 'Chrome';
    if (userAgent.includes('Firefox/')) return 'Firefox';
    if (userAgent.includes('Safari/')) return 'Safari';
    return 'Unknown';
  }

  /**
   * Create a PostHog tracker with default configuration
   * @param {string} apiKey - PostHog API Key
   * @param {string} host - PostHog host URL
   * @param {boolean} isDebug - Whether to use debug configuration
   * @returns {PostHogTracker}
   */
  static createDefault(apiKey, host = 'https://app.posthog.com', isDebug = false) {
    const configuration = isDebug
      ? AnalyticsConfiguration.debug
      : AnalyticsConfiguration.default;

    return new PostHogTracker(apiKey, host, configuration);
  }
}

export default PostHogTracker;
