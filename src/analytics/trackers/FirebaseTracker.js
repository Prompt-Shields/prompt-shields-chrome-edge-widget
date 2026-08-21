/**
 * Firebase Tracker - Performance monitoring and crash reporting
 * Mirrors the macOS FirebaseTracker.swift implementation
 *
 * Focus: Performance metrics, crash reports, and critical errors
 * Uses Firebase REST APIs for browser compatibility
 */

import { AnalyticsTracker, AnalyticsConfiguration, TrackerType } from '../AnalyticsTracker.js';

/**
 * Performance trace object
 */
class PerformanceTrace {
  constructor(name, attributes = {}) {
    this.name = name;
    this.startTime = Date.now();
    this.attributes = { ...attributes };
    this.counters = {};
  }
}

/**
 * Crash report object
 */
class CrashReport {
  constructor({ timestamp, reason, stackTrace, userInfo, appState }) {
    this.timestamp = timestamp;
    this.reason = reason;
    this.stackTrace = stackTrace;
    this.userInfo = userInfo;
    this.appState = appState;
  }
}

/**
 * Application state at time of crash/error
 */
class AppState {
  constructor() {
    this.appVersion = this._getExtensionVersion();
    this.buildNumber = this._getBuildNumber();
    this.osVersion = this._getOSVersion();
    this.browserInfo = this._getBrowserInfo();
    this.memoryUsage = this._getMemoryUsage();
  }

  _getExtensionVersion() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
        return chrome.runtime.getManifest().version || '0.0.0';
      }
    } catch (e) {
      // Ignore
    }
    return '0.0.0';
  }

  _getBuildNumber() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime?.getManifest) {
        const manifest = chrome.runtime.getManifest();
        return manifest.version_name || manifest.version || '0';
      }
    } catch (e) {
      // Ignore
    }
    return '0';
  }

  _getOSVersion() {
    if (typeof navigator !== 'undefined') {
      return navigator.userAgent || 'Unknown';
    }
    return 'Unknown';
  }

  _getBrowserInfo() {
    if (typeof navigator !== 'undefined') {
      const ua = navigator.userAgent;
      if (ua.includes('Chrome')) return 'Chrome';
      if (ua.includes('Firefox')) return 'Firefox';
      if (ua.includes('Safari')) return 'Safari';
      if (ua.includes('Edge')) return 'Edge';
      return 'Unknown';
    }
    return 'Unknown';
  }

  _getMemoryUsage() {
    try {
      if (typeof performance !== 'undefined' && performance.memory) {
        return performance.memory.usedJSHeapSize || 0;
      }
    } catch (e) {
      // Ignore - memory API not available
    }
    return 0;
  }
}

/**
 * Firebase Tracker for performance monitoring and crash reporting
 */
export class FirebaseTracker extends AnalyticsTracker {
  /**
   * Create a new Firebase tracker
   * @param {string} apiKey - Firebase API key
   * @param {string} projectId - Firebase project ID
   * @param {string} appId - Firebase app ID
   * @param {AnalyticsConfiguration} configuration - Tracker configuration
   */
  constructor(apiKey, projectId, appId, configuration = AnalyticsConfiguration.default) {
    super(TrackerType.FIREBASE, configuration);

    this.apiKey = apiKey;
    this.projectId = projectId;
    this.appId = appId;
    this.installationId = this._getOrCreateInstallationId();

    this.activeTraces = new Map();
    this.crashQueue = [];
    this.completedTraces = [];
    this.flushIntervalId = null;
  }

  /**
   * Get or create a persistent installation ID
   * @private
   */
  _getOrCreateInstallationId() {
    const storageKey = 'firebase_installation_id';

    try {
      // Try localStorage first
      if (typeof localStorage !== 'undefined') {
        let id = localStorage.getItem(storageKey);
        if (!id) {
          id = this._generateUUID();
          localStorage.setItem(storageKey, id);
        }
        return id;
      }
    } catch (e) {
      // Ignore localStorage errors
    }

    // Fallback to a random ID for this session
    return this._generateUUID();
  }

  /**
   * Generate a UUID
   * @private
   */
  _generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // Fallback UUID generation
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  /**
   * Initialize the tracker
   */
  async initialize() {
    console.info(`🔥 Firebase tracker initialized`);
    console.info(`🔥 Project ID: ${this.projectId}`);
    console.info(`🔥 Installation ID: ${this.installationId}`);

    // Setup global error handler
    this._setupErrorHandler();

    // Send any pending crash reports from previous session
    await this._sendPendingCrashReports();

    // Setup periodic flush
    if (this._configuration.flushInterval > 0) {
      this.flushIntervalId = setInterval(() => {
        this.flush().catch(err => console.error('Firebase flush error:', err));
      }, this._configuration.flushInterval);
    }
  }

  /**
   * Setup global error handler for crash detection
   * @private
   */
  _setupErrorHandler() {
    if (typeof self !== 'undefined') {
      // Service worker context
      self.addEventListener('error', (event) => {
        this._recordNonFatalError('global', 'uncaught', event.message || 'Unknown error');
      });

      self.addEventListener('unhandledrejection', (event) => {
        const reason = event.reason?.message || event.reason || 'Unhandled Promise rejection';
        this._recordNonFatalError('global', 'unhandled_rejection', String(reason));
      });
    }
  }

  /**
   * Track an analytics event
   * @param {Object} event - The event to track
   */
  async track(event) {
    if (!this._isEnabled) {
      console.debug(`🔥 Tracker disabled, skipping event: ${event.name}`);
      return;
    }

    if (!this.apiKey) {
      console.debug(`🔥 Firebase API key not configured, skipping event: ${event.name}`);
      return;
    }

    // Firebase tracker focuses on performance and errors
    const eventName = event.name;
    const params = event.params || {};

    switch (eventName) {
      case 'performance_metric':
        await this._trackPerformanceMetric(
          params.metric_name || 'unknown',
          params.value || 0,
          params.unit || 'ms'
        );
        break;

      case 'error_occurred':
        await this._trackNonFatalError(
          params.error_domain || 'unknown',
          params.error_code || '0',
          params.error_message || 'Unknown error'
        );
        break;

      case 'crash_detected':
        await this._recordCrash(params.reason || 'Unknown crash');
        break;

      case 'suggestion_processing_started':
        this.startTrace(`suggestion_${params.type || 'unknown'}`);
        break;

      case 'suggestion_processing_completed':
        this.endTrace(`suggestion_${params.type || 'unknown'}`, params.duration);
        break;

      case 'suggestion_processing_failed':
        this.endTrace(`suggestion_${params.type || 'unknown'}`, null, params.error);
        break;

      case 'text_injection_started':
        this.startTrace(`text_injection_${params.app || 'unknown'}`);
        break;

      case 'text_injection_succeeded':
        this.endTrace(`text_injection_${params.app || 'unknown'}`);
        break;

      case 'text_injection_failed':
        this.endTrace(`text_injection_${params.app || 'unknown'}`, null, params.error);
        break;

      case 'app_launched':
      case 'extension_installed':
        this.startTrace('app_startup');
        break;

      default:
        // Other events are handled by other trackers
        break;
    }
  }

  /**
   * Set user properties
   * @param {Object} properties - User properties
   */
  async setUserProperties(properties) {
    await super.setUserProperties(properties);
    console.debug('🔥 User properties updated');
  }

  /**
   * Reset the tracker
   */
  async reset() {
    this.activeTraces.clear();
    this.crashQueue = [];
    this.completedTraces = [];
    await super.reset();
    console.info('🔥 Firebase tracker reset');
  }

  /**
   * Flush pending data
   */
  async flush() {
    await this._sendCompletedTraces();
    await this._sendPendingCrashReports();
  }

  /**
   * Enable or disable the tracker
   * @param {boolean} enabled - Whether to enable
   */
  async setEnabled(enabled) {
    await super.setEnabled(enabled);
    console.info(`🔥 Firebase tracker ${enabled ? 'enabled' : 'disabled'}`);
  }

  // ===========================================
  // Performance Tracing
  // ===========================================

  /**
   * Start a performance trace
   * @param {string} name - Trace name
   * @param {Object} attributes - Initial attributes
   */
  startTrace(name, attributes = {}) {
    const trace = new PerformanceTrace(name, attributes);
    this.activeTraces.set(name, trace);

    if (this._configuration.isDebugMode) {
      console.debug(`🔥 Started trace: ${name}`);
    }
  }

  /**
   * End a performance trace
   * @param {string} name - Trace name
   * @param {number} duration - Optional explicit duration in ms
   * @param {string} error - Optional error message
   */
  endTrace(name, duration = null, error = null) {
    const trace = this.activeTraces.get(name);
    if (!trace) {
      console.warn(`🔥 Trace not found: ${name}`);
      return;
    }

    this.activeTraces.delete(name);

    if (error) {
      trace.attributes.error = error;
    }

    const actualDuration = duration ?? (Date.now() - trace.startTime);

    this._recordTrace(trace, actualDuration);
  }

  /**
   * Increment a counter in an active trace
   * @param {string} traceName - Name of the trace
   * @param {string} counterName - Name of the counter
   * @param {number} value - Value to increment by
   */
  incrementCounter(traceName, counterName, value = 1) {
    const trace = this.activeTraces.get(traceName);
    if (!trace) return;

    trace.counters[counterName] = (trace.counters[counterName] || 0) + value;
  }

  /**
   * Add attribute to an active trace
   * @param {string} traceName - Name of the trace
   * @param {string} key - Attribute key
   * @param {string} value - Attribute value
   */
  addAttribute(traceName, key, value) {
    const trace = this.activeTraces.get(traceName);
    if (!trace) return;

    trace.attributes[key] = value;
  }

  // ===========================================
  // Performance Metrics
  // ===========================================

  /**
   * Track a performance metric
   * @private
   */
  async _trackPerformanceMetric(name, value, unit) {
    if (!this.apiKey) return;

    const trace = new PerformanceTrace(name, { unit, value: String(value) });
    await this._recordTrace(trace, value);
  }

  /**
   * Record a completed trace
   * @private
   */
  async _recordTrace(trace, duration) {
    if (!this.apiKey) return;

    const tracePayload = {
      name: trace.name,
      start_time: trace.startTime,
      duration: Math.round(duration), // milliseconds
      attributes: trace.attributes,
      counters: trace.counters
    };

    this.completedTraces.push(tracePayload);

    // Send immediately in debug mode or if batch is full
    if (this._configuration.isDebugMode || this.completedTraces.length >= this._configuration.maxBatchSize) {
      await this._sendCompletedTraces();
    }
  }

  /**
   * Send completed traces to Firebase
   * @private
   */
  async _sendCompletedTraces() {
    if (this.completedTraces.length === 0) return;

    const tracesToSend = [...this.completedTraces];
    this.completedTraces = [];

    const appState = new AppState();

    const payload = {
      app_id: this.appId,
      app_version: appState.appVersion,
      os_version: appState.osVersion,
      device_model: appState.browserInfo,
      traces: tracesToSend
    };

    await this._sendPerformancePayload(payload);
  }

  /**
   * Send performance payload to Firebase
   * @private
   */
  async _sendPerformancePayload(payload) {
    // Firebase Performance Monitoring REST endpoint
    // Note: In production, you'd use the Firebase SDK or a server-side relay
    const url = `https://firebaselogging.googleapis.com/v0/performance/${this.projectId}`;

    try {
      if (this._configuration.isDebugMode) {
        console.debug(`🔥 Recording performance traces: ${payload.traces.map(t => t.name).join(', ')}`);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey
        },
        body: JSON.stringify(payload)
      });

      if (response.ok || response.status === 204) {
        if (this._configuration.isDebugMode) {
          console.debug('🔥 Performance traces recorded successfully');
        }
      } else {
        console.warn(`🔥 Firebase Performance returned status: ${response.status}`);
      }
    } catch (error) {
      console.error(`🔥 Failed to send performance data: ${error.message}`);
    }
  }

  // ===========================================
  // Crash Reporting
  // ===========================================

  /**
   * Record a crash
   * @private
   */
  async _recordCrash(reason) {
    const appState = new AppState();
    const userInfo = {};

    if (this._userProperties) {
      if (this._userProperties.userId) {
        userInfo.user_id = this._userProperties.userId;
      }
    }

    const crash = new CrashReport({
      timestamp: new Date(),
      reason,
      stackTrace: this._getStackTrace(),
      userInfo,
      appState
    });

    this.crashQueue.push(crash);

    // Persist crash for next session
    this._saveCrashReport(crash);

    // Try to send immediately
    await this._sendCrashReport(crash);
  }

  /**
   * Track non-fatal error
   * @private
   */
  async _trackNonFatalError(domain, code, message) {
    if (!this.apiKey) return;

    const appState = new AppState();

    const customKeys = {
      error_domain: domain,
      error_code: code
    };

    if (this._userProperties?.userId) {
      customKeys.user_id = this._userProperties.userId;
    }

    const payload = {
      app_id: this.appId,
      installation_id: this.installationId,
      timestamp: new Date().toISOString(),
      reason: message,
      stack_trace: this._getStackTrace(),
      app_version: appState.appVersion,
      build_number: appState.buildNumber,
      os_version: appState.osVersion,
      memory_usage: appState.memoryUsage,
      custom_keys: customKeys
    };

    await this._sendCrashlyticsPayload(payload, false);
  }

  /**
   * Alias for tracking non-fatal errors (for external use)
   */
  async _recordNonFatalError(domain, code, message) {
    await this._trackNonFatalError(domain, code, message);
  }

  /**
   * Get current stack trace
   * @private
   */
  _getStackTrace() {
    try {
      throw new Error('Stack trace');
    } catch (e) {
      return e.stack || 'No stack trace available';
    }
  }

  /**
   * Save crash report to storage for recovery on next launch
   * @private
   */
  _saveCrashReport(crash) {
    try {
      const key = 'firebase_pending_crashes';
      let pending = [];

      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem(key);
        if (stored) {
          pending = JSON.parse(stored);
        }
      }

      pending.push({
        timestamp: crash.timestamp.getTime(),
        reason: crash.reason,
        stackTrace: crash.stackTrace,
        userInfo: crash.userInfo
      });

      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(pending));
      }
    } catch (e) {
      console.error('🔥 Failed to save crash report:', e);
    }
  }

  /**
   * Send pending crash reports from previous session
   * @private
   */
  async _sendPendingCrashReports() {
    try {
      const key = 'firebase_pending_crashes';

      if (typeof localStorage === 'undefined') return;

      const stored = localStorage.getItem(key);
      if (!stored) return;

      const pending = JSON.parse(stored);
      const appState = new AppState();

      for (const crashData of pending) {
        const crash = new CrashReport({
          timestamp: new Date(crashData.timestamp),
          reason: crashData.reason,
          stackTrace: crashData.stackTrace,
          userInfo: crashData.userInfo || {},
          appState
        });

        await this._sendCrashReport(crash);
      }

      // Clear pending crashes
      localStorage.removeItem(key);
    } catch (e) {
      console.error('🔥 Failed to send pending crash reports:', e);
    }
  }

  /**
   * Send a crash report to Crashlytics
   * @private
   */
  async _sendCrashReport(crash) {
    if (!this.apiKey) return;

    const payload = {
      app_id: this.appId,
      installation_id: this.installationId,
      timestamp: crash.timestamp.toISOString(),
      reason: crash.reason,
      stack_trace: crash.stackTrace,
      app_version: crash.appState.appVersion,
      build_number: crash.appState.buildNumber,
      os_version: crash.appState.osVersion,
      memory_usage: crash.appState.memoryUsage,
      custom_keys: crash.userInfo
    };

    await this._sendCrashlyticsPayload(payload, true);
  }

  /**
   * Send payload to Crashlytics
   * @private
   */
  async _sendCrashlyticsPayload(payload, isFatal) {
    // Firebase Crashlytics REST endpoint
    // Note: In production, you'd typically use a server-side relay or the official SDK
    const endpoint = isFatal ? 'crashes' : 'errors';
    const url = `https://firebasecrashlytics.googleapis.com/v0/${this.projectId}/${endpoint}`;

    try {
      if (this._configuration.isDebugMode) {
        console.debug(`🔥 Sending ${isFatal ? 'crash' : 'error'} report: ${payload.reason}`);
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': this.apiKey
        },
        body: JSON.stringify(payload)
      });

      if (response.ok || response.status === 204) {
        console.info(`🔥 ${isFatal ? 'Crash' : 'Error'} report sent successfully`);
      } else {
        console.warn(`🔥 Crashlytics returned status: ${response.status}`);
      }
    } catch (error) {
      console.error(`🔥 Failed to send ${isFatal ? 'crash' : 'error'} report: ${error.message}`);
    }
  }

  // ===========================================
  // Factory Method
  // ===========================================

  /**
   * Create a Firebase tracker with default configuration
   * @param {string} apiKey - Firebase API key
   * @param {string} projectId - Firebase project ID
   * @param {string} appId - Firebase app ID
   * @param {boolean} debugMode - Whether to enable debug mode
   * @returns {FirebaseTracker}
   */
  static createDefault(apiKey, projectId, appId, debugMode = false) {
    const configuration = debugMode
      ? AnalyticsConfiguration.debug
      : AnalyticsConfiguration.default;

    return new FirebaseTracker(apiKey, projectId, appId, configuration);
  }

  // ===========================================
  // Performance Measurement Helpers
  // ===========================================

  /**
   * Measure the duration of an async operation
   * @param {string} name - Trace name
   * @param {Function} operation - Async function to measure
   * @returns {Promise<*>} Result of the operation
   */
  async measureAsync(name, operation) {
    this.startTrace(name);
    try {
      const result = await operation();
      this.endTrace(name);
      return result;
    } catch (error) {
      this.endTrace(name, null, error.message);
      throw error;
    }
  }

  /**
   * Measure a synchronous operation
   * @param {string} name - Trace name
   * @param {Function} operation - Function to measure
   * @returns {*} Result of the operation
   */
  measure(name, operation) {
    this.startTrace(name);
    try {
      const result = operation();
      this.endTrace(name);
      return result;
    } catch (error) {
      this.endTrace(name, null, error.message);
      throw error;
    }
  }
}

export default FirebaseTracker;
