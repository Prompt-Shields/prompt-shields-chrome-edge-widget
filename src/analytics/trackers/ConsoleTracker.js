/**
 * Console Analytics Tracker
 * Debug tracker that logs events to the console
 * Mirrors the macOS ConsoleAnalyticsTracker.swift implementation
 */

import { AnalyticsTracker, TrackerType, AnalyticsConfiguration } from '../AnalyticsTracker.js';

/**
 * Console tracker for development and debugging
 */
export class ConsoleTracker extends AnalyticsTracker {
  /**
   * Create a console tracker
   * @param {AnalyticsConfiguration} configuration - Tracker configuration
   */
  constructor(configuration = AnalyticsConfiguration.debug) {
    super(TrackerType.CONSOLE, configuration);
  }

  /**
   * Initialize the tracker
   * @returns {Promise<void>}
   */
  async initialize() {
    console.log('📊 [ConsoleTracker] Console Analytics Tracker initialized');
  }

  /**
   * Track an analytics event
   * @param {AnalyticsEvent} event - The event to track
   * @returns {Promise<void>}
   */
  async track(event) {
    if (!this._isEnabled) return;

    const params = Object.entries(event.parameters)
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    const emoji = this._getEmoji(event.category);
    console.log(`📊 ${emoji} [${event.category}] ${event.name} - {${params}}`);
  }

  /**
   * Set user properties for the tracker
   * @param {AnalyticsUserProperties} properties - User properties to set
   * @returns {Promise<void>}
   */
  async setUserProperties(properties) {
    await super.setUserProperties(properties);

    const propsString = Object.entries(properties.asDictionary())
      .map(([key, value]) => `${key}: ${value}`)
      .join(', ');

    console.log(`📊 👤 [ConsoleTracker] User properties set: {${propsString}}`);
  }

  /**
   * Reset the tracker
   * @returns {Promise<void>}
   */
  async reset() {
    await super.reset();
    console.log('📊 🔄 [ConsoleTracker] Console Analytics Tracker reset');
  }

  /**
   * Flush pending events
   * @returns {Promise<void>}
   */
  async flush() {
    console.debug('📊 [ConsoleTracker] Flush (no-op for console tracker)');
  }

  /**
   * Enable or disable the tracker
   * @param {boolean} enabled - Whether to enable the tracker
   * @returns {Promise<void>}
   */
  async setEnabled(enabled) {
    await super.setEnabled(enabled);
    console.log(`📊 [ConsoleTracker] Console tracker ${enabled ? 'enabled' : 'disabled'}`);
  }

  /**
   * Get emoji for event category
   * @param {string} category - Event category
   * @returns {string} Emoji
   * @private
   */
  _getEmoji(category) {
    const emojis = {
      app_lifecycle: '🚀',
      authentication: '🔐',
      extension: '🧩',
      text_detection: '📝',
      suggestions: '💡',
      text_injection: '✍️',
      ui_interaction: '🖱️',
      team: '👥',
      errors: '❌',
      performance: '⚡',
      custom: '🎯'
    };
    return emojis[category] || '📊';
  }
}

export default ConsoleTracker;
