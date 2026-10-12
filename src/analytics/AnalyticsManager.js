/**
 * Analytics Manager - Central manager for all analytics tracking
 * Mirrors the macOS AnalyticsManager.swift implementation
 *
 * Orchestrates multiple trackers and provides a unified API
 * Following Open/Closed Principle - open for extension (new trackers), closed for modification
 */

import { Events, AnalyticsUserProperties } from './AnalyticsEvents.js';

// Storage key for analytics enabled state
const ANALYTICS_ENABLED_KEY = 'analytics_enabled';

/**
 * Analytics Manager singleton class
 */
class AnalyticsManager {
  constructor() {
    this._trackers = [];
    this._userProperties = null;
    this._isEnabled = true;
    this._isInitialized = false;
  }

  /**
   * Get the singleton instance
   * @returns {AnalyticsManager}
   */
  static get shared() {
    if (!AnalyticsManager._instance) {
      AnalyticsManager._instance = new AnalyticsManager();
    }
    return AnalyticsManager._instance;
  }

  /**
   * Get number of active trackers
   * @returns {number}
   */
  get activeTrackerCount() {
    return this._trackers.length;
  }

  /**
   * Check if analytics is enabled
   * @returns {boolean}
   */
  get isEnabled() {
    return this._isEnabled;
  }

  /**
   * Check if manager is initialized
   * @returns {boolean}
   */
  get isInitialized() {
    return this._isInitialized;
  }

  /**
   * Get all active trackers
   * @returns {Array}
   */
  get allTrackers() {
    return [...this._trackers];
  }

  /**
   * Initialize the analytics manager
   * @param {Object} options - Initialization options
   * @param {Array} options.trackers - Array of tracker instances to add
   * @returns {Promise<void>}
   */
  async initialize(options = {}) {
    if (this._isInitialized) {
      console.warn('[AnalyticsManager] Already initialized');
      return;
    }

    console.log('[AnalyticsManager] Initializing...');

    // Load enabled state from storage
    await this._loadEnabledState();

    // Add provided trackers
    if (options.trackers && Array.isArray(options.trackers)) {
      for (const tracker of options.trackers) {
        await this.addTracker(tracker);
      }
    }

    this._isInitialized = true;
    console.log(`[AnalyticsManager] Initialized with ${this._trackers.length} tracker(s)`);

    // Track extension start
    await this.track(Events.extensionEnabled());
  }

  /**
   * Add a new tracker
   * @param {AnalyticsTracker} tracker - The tracker to add
   * @returns {Promise<void>}
   */
  async addTracker(tracker) {
    // Check if tracker already exists
    if (this._trackers.some(t => t.identifier === tracker.identifier)) {
      console.warn(`[AnalyticsManager] Tracker ${tracker.identifier} already registered`);
      return;
    }

    await tracker.initialize();
    this._trackers.push(tracker);

    // Set user properties if already configured
    if (this._userProperties) {
      await tracker.setUserProperties(this._userProperties);
    }

    console.log(`[AnalyticsManager] Added tracker: ${tracker.identifier}`);
  }

  /**
   * Remove a tracker by identifier
   * @param {string} identifier - The tracker identifier to remove
   * @returns {Promise<void>}
   */
  async removeTracker(identifier) {
    const index = this._trackers.findIndex(t => t.identifier === identifier);
    if (index !== -1) {
      this._trackers.splice(index, 1);
      console.log(`[AnalyticsManager] Removed tracker: ${identifier}`);
    }
  }

  /**
   * Get a tracker by identifier
   * @param {string} identifier - The tracker identifier
   * @returns {AnalyticsTracker|null}
   */
  getTracker(identifier) {
    return this._trackers.find(t => t.identifier === identifier) || null;
  }

  /**
   * Track an analytics event
   * @param {AnalyticsEvent} event - The event to track
   * @returns {Promise<void>}
   */
  async track(event) {
    if (!this._isEnabled) {
      console.debug(`[AnalyticsManager] Analytics disabled, skipping event: ${event.name}`);
      return;
    }

    // Send to all trackers concurrently
    const promises = this._trackers.map(tracker =>
      tracker.track(event).catch(error => {
        console.error(`[AnalyticsManager] Error tracking event in ${tracker.identifier}:`, error);
      })
    );

    await Promise.all(promises);
  }

  /**
   * Track an event with fire-and-forget (no await)
   * Use this for convenience when you don't need to await
   * @param {AnalyticsEvent} event - The event to track
   */
  trackAsync(event) {
    this.track(event).catch(error => {
      console.error('[AnalyticsManager] Error in trackAsync:', error);
    });
  }

  /**
   * Set user properties for all trackers
   * @param {AnalyticsUserProperties} properties - The user properties to set
   * @returns {Promise<void>}
   */
  async setUserProperties(properties) {
    this._userProperties = properties;

    const promises = this._trackers.map(tracker =>
      tracker.setUserProperties(properties).catch(error => {
        console.error(`[AnalyticsManager] Error setting user properties in ${tracker.identifier}:`, error);
      })
    );

    await Promise.all(promises);
    console.log('[AnalyticsManager] User properties updated across all trackers');
  }

  /**
   * Update user properties with new values
   * @param {Object} updates - Partial user properties to update
   * @returns {Promise<void>}
   */
  async updateUserProperties(updates = {}) {
    const currentProps = this._userProperties || new AnalyticsUserProperties();

    const properties = new AnalyticsUserProperties({
      userId: updates.userId ?? currentProps.userId,
      email: updates.email ?? currentProps.email,
      teamId: updates.teamId ?? currentProps.teamId
    });

    await this.setUserProperties(properties);
  }

  /**
   * Enable or disable all analytics tracking
   * @param {boolean} enabled - Whether analytics should be enabled
   * @returns {Promise<void>}
   */
  async setEnabled(enabled) {
    this._isEnabled = enabled;
    await this._saveEnabledState(enabled);

    const promises = this._trackers.map(tracker =>
      tracker.setEnabled(enabled).catch(error => {
        console.error(`[AnalyticsManager] Error setting enabled state in ${tracker.identifier}:`, error);
      })
    );

    await Promise.all(promises);
    console.log(`[AnalyticsManager] Analytics ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Toggle analytics on/off
   * @returns {Promise<void>}
   */
  async toggleEnabled() {
    await this.setEnabled(!this._isEnabled);
  }

  /**
   * Reset all trackers (e.g., on logout)
   * @returns {Promise<void>}
   */
  async reset() {
    this._userProperties = null;

    const promises = this._trackers.map(tracker =>
      tracker.reset().catch(error => {
        console.error(`[AnalyticsManager] Error resetting ${tracker.identifier}:`, error);
      })
    );

    await Promise.all(promises);
    console.log('[AnalyticsManager] All trackers reset');
  }

  /**
   * Flush all pending events
   * @returns {Promise<void>}
   */
  async flush() {
    const promises = this._trackers.map(tracker =>
      tracker.flush().catch(error => {
        console.error(`[AnalyticsManager] Error flushing ${tracker.identifier}:`, error);
      })
    );

    await Promise.all(promises);
    console.debug('[AnalyticsManager] All trackers flushed');
  }

  // Convenience methods

  /**
   * Track a custom event
   * @param {string} name - Event name
   * @param {Object} parameters - Event parameters
   * @returns {Promise<void>}
   */
  async trackCustom(name, parameters = {}) {
    await this.track(Events.custom(name, parameters));
  }

  /**
   * Track an error
   * @param {Error|string} error - The error to track
   * @param {string} domain - Error domain (default: 'app')
   * @returns {Promise<void>}
   */
  async trackError(error, domain = 'app') {
    const message = error instanceof Error ? error.message : String(error);
    const code = error instanceof Error && error.code ? String(error.code) : 'unknown';
    await this.track(Events.errorOccurred(domain, code, message));
  }

  /**
   * Track a performance metric
   * @param {string} name - Metric name
   * @param {number} value - Metric value
   * @param {string} unit - Metric unit (default: 'ms')
   * @returns {Promise<void>}
   */
  async trackPerformance(name, value, unit = 'ms') {
    await this.track(Events.performanceMetric(name, value, unit));
  }

  /**
   * Measure and track execution time of an async operation
   * @param {string} name - Operation name
   * @param {Function} operation - Async operation to measure
   * @returns {Promise<*>} Result of the operation
   */
  async measureAsync(name, operation) {
    const start = performance.now();
    try {
      const result = await operation();
      const duration = performance.now() - start;
      await this.trackPerformance(name, duration);
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      await this.trackPerformance(name, duration);
      throw error;
    }
  }

  // Private methods

  /**
   * Load enabled state from storage
   * @private
   */
  async _loadEnabledState() {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const result = await chrome.storage.local.get(ANALYTICS_ENABLED_KEY);
        if (result[ANALYTICS_ENABLED_KEY] !== undefined) {
          this._isEnabled = result[ANALYTICS_ENABLED_KEY];
        }
      }
    } catch (error) {
      console.warn('[AnalyticsManager] Failed to load enabled state:', error);
    }
  }

  /**
   * Save enabled state to storage
   * @param {boolean} enabled
   * @private
   */
  async _saveEnabledState(enabled) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.set({ [ANALYTICS_ENABLED_KEY]: enabled });
      }
    } catch (error) {
      console.warn('[AnalyticsManager] Failed to save enabled state:', error);
    }
  }
}

// Singleton instance
AnalyticsManager._instance = null;

/**
 * Global convenience object for tracking events
 * Usage: Analytics.track(Events.appLaunched())
 */
export const Analytics = {
  /**
   * Track an event
   * @param {AnalyticsEvent} event - The event to track
   * @returns {Promise<void>}
   */
  track: (event) => AnalyticsManager.shared.track(event),

  /**
   * Fire-and-forget tracking
   * @param {AnalyticsEvent} event - The event to track
   */
  trackAsync: (event) => AnalyticsManager.shared.trackAsync(event),

  /**
   * Get the analytics manager instance
   * @returns {AnalyticsManager}
   */
  get manager() {
    return AnalyticsManager.shared;
  }
};

export { AnalyticsManager };
export default AnalyticsManager;
