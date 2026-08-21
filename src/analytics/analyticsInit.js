/**
 * Analytics Initialization Module
 * Sets up analytics trackers based on configuration
 *
 * Usage in background.js:
 *   import { initializeAnalytics, Analytics, Events } from './analytics/analyticsInit.js';
 *
 *   // Initialize on extension load
 *   await initializeAnalytics();
 *
 *   // Track events
 *   Analytics.track(Events.loginSucceeded('auth0'));
 */

import { AnalyticsManager, Analytics } from './AnalyticsManager.js';
import { Events, AnalyticsUserProperties } from './AnalyticsEvents.js';
import { ConsoleTracker } from './trackers/ConsoleTracker.js';
import { GoogleAnalyticsTracker } from './trackers/GoogleAnalyticsTracker.js';
import { PostHogTracker } from './trackers/PostHogTracker.js';
import { FirebaseTracker } from './trackers/FirebaseTracker.js';

/**
 * Initialize analytics with configuration
 * @param {Object} config - Configuration object (optional, will use Config.getAnalytics() if available)
 * @returns {Promise<AnalyticsManager>}
 */
export async function initializeAnalytics(config = null) {
  // Try to get config from the unified config system
  let analyticsConfig = config;

  if (!analyticsConfig) {
    try {
      // eslint-disable-next-line no-undef
      if (typeof Config !== 'undefined' && Config.getAnalytics) {
        // eslint-disable-next-line no-undef
        analyticsConfig = Config.getAnalytics();
      }
    } catch (error) {
      console.warn('[AnalyticsInit] Could not get config from unified system:', error);
    }
  }

  // Default config if none available
  if (!analyticsConfig) {
    analyticsConfig = {
      enabled: true,
      debugMode: true, // Default to debug mode if no config
      googleAnalytics: { measurementId: '', apiSecret: '' },
      postHog: { apiKey: '', host: 'https://app.posthog.com' },
      firebase: { apiKey: '', projectId: '', appId: '' }
    };
  }

  const trackers = [];

  // Always add console tracker in debug mode
  if (analyticsConfig.debugMode) {
    trackers.push(new ConsoleTracker());
  }

  // Add Google Analytics tracker if configured
  if (analyticsConfig.googleAnalytics?.measurementId && analyticsConfig.googleAnalytics?.apiSecret) {
    const gaTracker = GoogleAnalyticsTracker.createDefault(
      analyticsConfig.googleAnalytics.measurementId,
      analyticsConfig.googleAnalytics.apiSecret,
      analyticsConfig.debugMode
    );
    trackers.push(gaTracker);
  }

  // Add PostHog tracker if configured
  if (analyticsConfig.postHog?.apiKey) {
    const postHogTracker = PostHogTracker.createDefault(
      analyticsConfig.postHog.apiKey,
      analyticsConfig.postHog.host || 'https://app.posthog.com',
      analyticsConfig.debugMode
    );
    trackers.push(postHogTracker);
  }

  // Add Firebase tracker if configured
  if (analyticsConfig.firebase?.apiKey && analyticsConfig.firebase?.projectId && analyticsConfig.firebase?.appId) {
    const firebaseTracker = FirebaseTracker.createDefault(
      analyticsConfig.firebase.apiKey,
      analyticsConfig.firebase.projectId,
      analyticsConfig.firebase.appId,
      analyticsConfig.debugMode
    );
    trackers.push(firebaseTracker);
  }

  // Initialize the analytics manager
  await AnalyticsManager.shared.initialize({ trackers });

  // Set enabled state based on config
  if (!analyticsConfig.enabled) {
    await AnalyticsManager.shared.setEnabled(false);
  }

  console.log(`[AnalyticsInit] Analytics initialized with ${trackers.length} tracker(s)`);
  return AnalyticsManager.shared;
}

/**
 * Set user properties after authentication
 * @param {Object} userData - User data from authentication
 * @param {Object} profileData - Profile data from API (optional)
 */
export async function setAnalyticsUser(userData, profileData = null) {
  const properties = new AnalyticsUserProperties({
    userId: profileData?.id || userData?.sub || userData?.user_id,
    email: userData?.email,
    teamId: profileData?.default_team_id
  });

  await AnalyticsManager.shared.setUserProperties(properties);
}

/**
 * Reset analytics on logout
 */
export async function resetAnalyticsUser() {
  await AnalyticsManager.shared.reset();
}

/**
 * Convenience function to track app lifecycle events (matches macOS)
 */
export const trackAppLifecycleEvents = {
  appLaunched: () => Analytics.trackAsync(Events.appLaunched()),
  appTerminated: () => Analytics.trackAsync(Events.appTerminated()),
  appBecameActive: () => Analytics.trackAsync(Events.appBecameActive()),
  appResignedActive: () => Analytics.trackAsync(Events.appResignedActive())
};

/**
 * Convenience function to track extension lifecycle events
 */
export const trackExtensionEvents = {
  installed: (previousVersion = null) => {
    if (previousVersion) {
      Analytics.trackAsync(Events.extensionUpdated(previousVersion, chrome.runtime.getManifest().version));
    } else {
      Analytics.trackAsync(Events.extensionInstalled());
    }
  },

  enabled: () => Analytics.trackAsync(Events.extensionEnabled()),
  disabled: () => Analytics.trackAsync(Events.extensionDisabled()),
  popupOpened: () => Analytics.trackAsync(Events.popupOpened()),
  popupClosed: () => Analytics.trackAsync(Events.popupClosed())
};

/**
 * Convenience function to track accessibility/monitoring events (matches macOS)
 */
export const trackAccessibilityEvents = {
  permissionRequested: () => Analytics.trackAsync(Events.accessibilityPermissionRequested()),
  permissionGranted: () => Analytics.trackAsync(Events.accessibilityPermissionGranted()),
  permissionDenied: () => Analytics.trackAsync(Events.accessibilityPermissionDenied()),
  monitoringEnabled: () => Analytics.trackAsync(Events.monitoringEnabled()),
  monitoringDisabled: () => Analytics.trackAsync(Events.monitoringDisabled()),
  monitoringPaused: (reason) => Analytics.trackAsync(Events.monitoringPaused(reason)),
  monitoringResumed: () => Analytics.trackAsync(Events.monitoringResumed())
};

/**
 * Convenience function to track authentication events
 */
export const trackAuthEvents = {
  loginStarted: () => Analytics.trackAsync(Events.loginStarted()),
  loginSucceeded: (provider = 'auth0') => Analytics.trackAsync(Events.loginSucceeded(provider)),
  loginFailed: (error) => Analytics.trackAsync(Events.loginFailed(error)),
  logoutStarted: () => Analytics.trackAsync(Events.logoutStarted()),
  logoutCompleted: () => Analytics.trackAsync(Events.logoutCompleted()),
  tokenRefreshed: () => Analytics.trackAsync(Events.tokenRefreshed()),
  tokenRefreshFailed: (error) => Analytics.trackAsync(Events.tokenRefreshFailed(error))
};

/**
 * Convenience function to track suggestion events
 */
export const trackSuggestionEvents = {
  categorySelected: (category) => Analytics.trackAsync(Events.suggestionCategorySelected(category)),
  typeSelected: (type, category) => Analytics.trackAsync(Events.suggestionTypeSelected(type, category)),
  processingStarted: (type) => Analytics.trackAsync(Events.suggestionProcessingStarted(type)),
  processingCompleted: (type, duration) => Analytics.trackAsync(Events.suggestionProcessingCompleted(type, duration)),
  processingFailed: (type, error) => Analytics.trackAsync(Events.suggestionProcessingFailed(type, error)),
  accepted: (type) => Analytics.trackAsync(Events.suggestionAccepted(type)),
  rejected: (type) => Analytics.trackAsync(Events.suggestionRejected(type)),
  copied: (type) => Analytics.trackAsync(Events.suggestionCopied(type))
};

/**
 * Convenience function to track UI events
 */
export const trackUIEvents = {
  actionButtonClicked: (action) => Analytics.trackAsync(Events.actionButtonClicked(action)),
  overlayDisplayed: () => Analytics.trackAsync(Events.overlayDisplayed()),
  overlayHidden: () => Analytics.trackAsync(Events.overlayHidden()),
  settingsOpened: () => Analytics.trackAsync(Events.settingsOpened()),
  historyOpened: () => Analytics.trackAsync(Events.historyOpened()),
  accountOpened: () => Analytics.trackAsync(Events.accountOpened())
};

/**
 * Convenience function to track error events
 */
export const trackErrorEvents = {
  error: (domain, code, message) => Analytics.trackAsync(Events.errorOccurred(domain, code, message)),
  apiError: (endpoint, statusCode, message) => Analytics.trackAsync(Events.apiError(endpoint, statusCode, message)),
  crashDetected: (reason) => Analytics.trackAsync(Events.crashDetected(reason))
};

/**
 * Convenience function to track performance events
 */
export const trackPerformanceEvents = {
  metric: (name, value, unit = 'ms') => Analytics.trackAsync(Events.performanceMetric(name, value, unit)),
  pageLoadTime: (page, duration) => Analytics.trackAsync(Events.pageLoadTime(page, duration)),
  apiResponseTime: (endpoint, duration) => Analytics.trackAsync(Events.apiResponseTime(endpoint, duration))
};

/**
 * Get the Firebase tracker instance for performance tracing
 * @returns {FirebaseTracker|null} Firebase tracker instance or null if not configured
 */
export function getFirebaseTracker() {
  const trackers = AnalyticsManager.shared.trackers || [];
  return trackers.find(t => t.identifier === 'firebase') || null;
}

/**
 * Performance tracing helpers using Firebase
 */
export const Performance = {
  /**
   * Start a performance trace
   * @param {string} name - Trace name
   * @param {Object} attributes - Initial attributes
   */
  startTrace: (name, attributes = {}) => {
    const firebaseTracker = getFirebaseTracker();
    if (firebaseTracker) {
      firebaseTracker.startTrace(name, attributes);
    }
  },

  /**
   * End a performance trace
   * @param {string} name - Trace name
   * @param {number} duration - Optional explicit duration
   * @param {string} error - Optional error message
   */
  endTrace: (name, duration = null, error = null) => {
    const firebaseTracker = getFirebaseTracker();
    if (firebaseTracker) {
      firebaseTracker.endTrace(name, duration, error);
    }
  },

  /**
   * Increment a counter in an active trace
   * @param {string} traceName - Name of the trace
   * @param {string} counterName - Name of the counter
   * @param {number} value - Value to increment by
   */
  incrementCounter: (traceName, counterName, value = 1) => {
    const firebaseTracker = getFirebaseTracker();
    if (firebaseTracker) {
      firebaseTracker.incrementCounter(traceName, counterName, value);
    }
  },

  /**
   * Add attribute to an active trace
   * @param {string} traceName - Name of the trace
   * @param {string} key - Attribute key
   * @param {string} value - Attribute value
   */
  addAttribute: (traceName, key, value) => {
    const firebaseTracker = getFirebaseTracker();
    if (firebaseTracker) {
      firebaseTracker.addAttribute(traceName, key, value);
    }
  },

  /**
   * Measure the duration of an async operation
   * @param {string} name - Trace name
   * @param {Function} operation - Async function to measure
   * @returns {Promise<*>} Result of the operation
   */
  measureAsync: async (name, operation) => {
    const firebaseTracker = getFirebaseTracker();
    if (firebaseTracker) {
      return firebaseTracker.measureAsync(name, operation);
    }
    // Fallback: just run the operation without measuring
    return operation();
  },

  /**
   * Measure a synchronous operation
   * @param {string} name - Trace name
   * @param {Function} operation - Function to measure
   * @returns {*} Result of the operation
   */
  measure: (name, operation) => {
    const firebaseTracker = getFirebaseTracker();
    if (firebaseTracker) {
      return firebaseTracker.measure(name, operation);
    }
    // Fallback: just run the operation without measuring
    return operation();
  }
};

// Re-export commonly used items
export { Analytics, Events, AnalyticsManager, AnalyticsUserProperties, FirebaseTracker };
