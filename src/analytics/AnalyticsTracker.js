/**
 * Analytics Tracker - Base interface for analytics trackers
 * Mirrors the macOS AnalyticsTracker.swift implementation
 */

/**
 * Tracker types enumeration
 */
export const TrackerType = {
  GOOGLE_ANALYTICS: 'google_analytics',
  POSTHOG: 'posthog',
  CONSOLE: 'console',
  FIREBASE: 'firebase'
};

/**
 * Analytics configuration
 */
export class AnalyticsConfiguration {
  constructor({
    isEnabled = true,
    isDebugMode = false,
    flushInterval = 30000, // 30 seconds in milliseconds
    maxBatchSize = 20
  } = {}) {
    this.isEnabled = isEnabled;
    this.isDebugMode = isDebugMode;
    this.flushInterval = flushInterval;
    this.maxBatchSize = maxBatchSize;
  }

  static get default() {
    return new AnalyticsConfiguration({
      isEnabled: true,
      isDebugMode: false,
      flushInterval: 30000,
      maxBatchSize: 20
    });
  }

  static get debug() {
    return new AnalyticsConfiguration({
      isEnabled: true,
      isDebugMode: true,
      flushInterval: 5000,
      maxBatchSize: 5
    });
  }
}

/**
 * Base Analytics Tracker interface
 * All trackers should extend this class
 */
export class AnalyticsTracker {
  /**
   * Create a new tracker
   * @param {string} identifier - Unique identifier for this tracker
   * @param {AnalyticsConfiguration} configuration - Tracker configuration
   */
  constructor(identifier, configuration = AnalyticsConfiguration.default) {
    if (this.constructor === AnalyticsTracker) {
      throw new Error('AnalyticsTracker is an abstract class and cannot be instantiated directly');
    }
    this._identifier = identifier;
    this._isEnabled = configuration.isEnabled;
    this._configuration = configuration;
    this._userProperties = null;
  }

  /**
   * Get the tracker identifier
   * @returns {string} Tracker identifier
   */
  get identifier() {
    return this._identifier;
  }

  /**
   * Check if tracker is enabled
   * @returns {boolean} Whether tracker is enabled
   */
  get isEnabled() {
    return this._isEnabled;
  }

  /**
   * Get the configuration
   * @returns {AnalyticsConfiguration} Tracker configuration
   */
  get configuration() {
    return this._configuration;
  }

  /**
   * Initialize the tracker
   * @returns {Promise<void>}
   */
  async initialize() {
    throw new Error('Method initialize() must be implemented');
  }

  /**
   * Track an analytics event
   * @param {AnalyticsEvent} event - The event to track
   * @returns {Promise<void>}
   */
  // eslint-disable-next-line no-unused-vars -- abstract method; the parameter documents the contract
  async track(event) {
    throw new Error('Method track() must be implemented');
  }

  /**
   * Set user properties for the tracker
   * @param {AnalyticsUserProperties} properties - User properties to set
   * @returns {Promise<void>}
   */
  async setUserProperties(properties) {
    this._userProperties = properties;
  }

  /**
   * Reset the tracker (e.g., on logout)
   * @returns {Promise<void>}
   */
  async reset() {
    this._userProperties = null;
  }

  /**
   * Flush any pending events
   * @returns {Promise<void>}
   */
  async flush() {
    // Default implementation does nothing
  }

  /**
   * Enable or disable the tracker
   * @param {boolean} enabled - Whether to enable the tracker
   * @returns {Promise<void>}
   */
  async setEnabled(enabled) {
    this._isEnabled = enabled;
  }
}

export default {
  TrackerType,
  AnalyticsConfiguration,
  AnalyticsTracker
};
