/**
 * Analytics Events - Event definitions for tracking
 * Mirrors the macOS AnalyticsEvent.swift implementation
 */

// Event Categories
export const EventCategory = {
  APP_LIFECYCLE: 'app_lifecycle',
  AUTHENTICATION: 'authentication',
  EXTENSION: 'extension',
  ACCESSIBILITY: 'accessibility',
  TEXT_DETECTION: 'text_detection',
  SUGGESTIONS: 'suggestions',
  TEXT_INJECTION: 'text_injection',
  UI_INTERACTION: 'ui_interaction',
  TEAM: 'team',
  ERRORS: 'errors',
  PERFORMANCE: 'performance',
  CUSTOM: 'custom'
};

// ===========================================
// Privacy Utilities - NEVER send PII to analytics
// ===========================================

/**
 * Hash a string to anonymize it for analytics (SHA-256 truncated)
 * @param {string} value - Value to hash
 * @returns {string} Anonymized hash (first 16 chars)
 */
export function anonymizeValue(value) {
  if (!value) return 'unknown';
  // Simple hash for analytics - not cryptographically secure, just for anonymization
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    const char = value.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return 'anon_' + Math.abs(hash).toString(16).substring(0, 8);
}

/**
 * Extract and return only the domain from a URL (no path, no query params)
 * This is acceptable for analytics as it doesn't reveal specific pages
 * @param {string} urlOrDomain - URL or domain
 * @returns {string} Just the domain
 */
export function extractDomain(urlOrDomain) {
  if (!urlOrDomain) return 'unknown';
  try {
    // If it's a full URL, extract the hostname
    if (urlOrDomain.includes('://')) {
      const url = new URL(urlOrDomain);
      return url.hostname;
    }
    // If it already looks like a domain, return it
    return urlOrDomain.split('/')[0];
  } catch {
    return 'unknown';
  }
}

/**
 * Sanitize error messages to remove any potential PII
 * @param {string} error - Error message
 * @returns {string} Sanitized error message
 */
export function sanitizeError(error) {
  if (!error) return 'unknown_error';
  const errorStr = String(error);

  // Remove email addresses
  let sanitized = errorStr.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL]');

  // Remove potential URLs with paths (keep domain only)
  sanitized = sanitized.replace(/https?:\/\/[^\s]+/g, (match) => {
    try {
      return '[URL:' + new URL(match).hostname + ']';
    } catch {
      return '[URL]';
    }
  });

  // Remove potential file paths
  sanitized = sanitized.replace(/[A-Za-z]:\\[^\s]+/g, '[PATH]');
  sanitized = sanitized.replace(/\/(?:Users|home|var|tmp)\/[^\s]+/g, '[PATH]');

  // Remove potential IP addresses
  sanitized = sanitized.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[IP]');

  // Remove potential tokens/keys (long alphanumeric strings)
  sanitized = sanitized.replace(/[a-zA-Z0-9_-]{32,}/g, '[TOKEN]');

  // Truncate to reasonable length
  if (sanitized.length > 200) {
    sanitized = sanitized.substring(0, 200) + '...';
  }

  return sanitized;
}

// Event Names
export const EventName = {
  // App Lifecycle Events (matches macOS)
  APP_LAUNCHED: 'app_launched',
  APP_TERMINATED: 'app_terminated',
  APP_BECAME_ACTIVE: 'app_became_active',
  APP_RESIGNED_ACTIVE: 'app_resigned_active',
  EXTENSION_INSTALLED: 'extension_installed',
  EXTENSION_UPDATED: 'extension_updated',
  EXTENSION_ENABLED: 'extension_enabled',
  EXTENSION_DISABLED: 'extension_disabled',
  POPUP_OPENED: 'popup_opened',
  POPUP_CLOSED: 'popup_closed',

  // Authentication Events
  LOGIN_STARTED: 'login_started',
  LOGIN_SUCCEEDED: 'login_succeeded',
  LOGIN_FAILED: 'login_failed',
  LOGOUT_STARTED: 'logout_started',
  LOGOUT_COMPLETED: 'logout_completed',
  TOKEN_REFRESHED: 'token_refreshed',
  TOKEN_REFRESH_FAILED: 'token_refresh_failed',

  // Accessibility/Monitoring Events (matches macOS)
  ACCESSIBILITY_PERMISSION_REQUESTED: 'accessibility_permission_requested',
  ACCESSIBILITY_PERMISSION_GRANTED: 'accessibility_permission_granted',
  ACCESSIBILITY_PERMISSION_DENIED: 'accessibility_permission_denied',
  MONITORING_ENABLED: 'monitoring_enabled',
  MONITORING_DISABLED: 'monitoring_disabled',
  MONITORING_PAUSED: 'monitoring_paused',
  MONITORING_RESUMED: 'monitoring_resumed',

  // Extension Events
  PERMISSION_REQUESTED: 'permission_requested',
  PERMISSION_GRANTED: 'permission_granted',
  PERMISSION_DENIED: 'permission_denied',
  SITE_ALLOWED: 'site_allowed',
  SITE_BLOCKED: 'site_blocked',

  // Text Detection Events
  TEXT_FIELD_DETECTED: 'text_field_detected',
  TEXT_FIELD_LOST: 'text_field_lost',
  SELECTED_TEXT_DETECTED: 'selected_text_detected',

  // Suggestion Events
  SUGGESTION_CATEGORY_SELECTED: 'suggestion_category_selected',
  SUGGESTION_TYPE_SELECTED: 'suggestion_type_selected',
  SUGGESTION_PROCESSING_STARTED: 'suggestion_processing_started',
  SUGGESTION_PROCESSING_COMPLETED: 'suggestion_processing_completed',
  SUGGESTION_PROCESSING_FAILED: 'suggestion_processing_failed',
  SUGGESTION_ACCEPTED: 'suggestion_accepted',
  SUGGESTION_REJECTED: 'suggestion_rejected',
  SUGGESTION_COPIED: 'suggestion_copied',

  // Text Injection Events
  TEXT_INJECTION_STARTED: 'text_injection_started',
  TEXT_INJECTION_SUCCEEDED: 'text_injection_succeeded',
  TEXT_INJECTION_FAILED: 'text_injection_failed',

  // UI Events (matches macOS)
  MAIN_WINDOW_OPENED: 'main_window_opened',
  MAIN_WINDOW_CLOSED: 'main_window_closed',
  ACTION_BUTTON_CLICKED: 'action_button_clicked',
  ACTION_MENU_OPENED: 'action_menu_opened',
  ACTION_MENU_CLOSED: 'action_menu_closed',
  OVERLAY_DISPLAYED: 'overlay_displayed',
  OVERLAY_HIDDEN: 'overlay_hidden',
  ABOUT_WINDOW_OPENED: 'about_window_opened',
  SETTINGS_OPENED: 'settings_opened',
  HISTORY_OPENED: 'history_opened',
  ACCOUNT_OPENED: 'account_opened',

  // Team Events
  TEAM_SWITCHED: 'team_switched',
  TEAM_CREATED: 'team_created',
  TEAM_JOINED: 'team_joined',

  // Error Events
  ERROR_OCCURRED: 'error_occurred',
  API_ERROR: 'api_error',

  // Performance Events
  PERFORMANCE_METRIC: 'performance_metric',
  PAGE_LOAD_TIME: 'page_load_time',
  API_RESPONSE_TIME: 'api_response_time',

  // Crash Events
  CRASH_DETECTED: 'crash_detected'
};

/**
 * Analytics Event class
 * Represents a trackable event with name, category, and parameters
 */
export class AnalyticsEvent {
  /**
   * Create an analytics event
   * @param {string} name - Event name
   * @param {string} category - Event category
   * @param {Object} parameters - Event parameters
   */
  constructor(name, category, parameters = {}) {
    this.name = name;
    this.category = category;
    this.timestamp = new Date().toISOString();
    this.parameters = {
      event_category: category,
      timestamp: this.timestamp,
      ...parameters
    };
  }

  /**
   * Get full event parameters
   * @returns {Object} All event parameters
   */
  getParameters() {
    return { ...this.parameters };
  }
}

/**
 * Factory functions for creating events
 * NOTE: All events use privacy utilities to ensure no PII is sent to analytics
 */
export const Events = {
  // ===========================================
  // App Lifecycle Events (matches macOS)
  // ===========================================

  appLaunched: () => new AnalyticsEvent(
    EventName.APP_LAUNCHED,
    EventCategory.APP_LIFECYCLE
  ),

  appTerminated: () => new AnalyticsEvent(
    EventName.APP_TERMINATED,
    EventCategory.APP_LIFECYCLE
  ),

  appBecameActive: () => new AnalyticsEvent(
    EventName.APP_BECAME_ACTIVE,
    EventCategory.APP_LIFECYCLE
  ),

  appResignedActive: () => new AnalyticsEvent(
    EventName.APP_RESIGNED_ACTIVE,
    EventCategory.APP_LIFECYCLE
  ),

  extensionInstalled: () => new AnalyticsEvent(
    EventName.EXTENSION_INSTALLED,
    EventCategory.APP_LIFECYCLE
  ),

  extensionUpdated: (previousVersion, currentVersion) => new AnalyticsEvent(
    EventName.EXTENSION_UPDATED,
    EventCategory.APP_LIFECYCLE,
    { previous_version: previousVersion, current_version: currentVersion }
  ),

  extensionEnabled: () => new AnalyticsEvent(
    EventName.EXTENSION_ENABLED,
    EventCategory.APP_LIFECYCLE
  ),

  extensionDisabled: () => new AnalyticsEvent(
    EventName.EXTENSION_DISABLED,
    EventCategory.APP_LIFECYCLE
  ),

  popupOpened: () => new AnalyticsEvent(
    EventName.POPUP_OPENED,
    EventCategory.APP_LIFECYCLE
  ),

  popupClosed: () => new AnalyticsEvent(
    EventName.POPUP_CLOSED,
    EventCategory.APP_LIFECYCLE
  ),

  // ===========================================
  // Authentication Events
  // ===========================================

  loginStarted: () => new AnalyticsEvent(
    EventName.LOGIN_STARTED,
    EventCategory.AUTHENTICATION
  ),

  loginSucceeded: (provider = 'auth0') => new AnalyticsEvent(
    EventName.LOGIN_SUCCEEDED,
    EventCategory.AUTHENTICATION,
    { provider }
  ),

  // Error is sanitized to remove any PII
  loginFailed: (error) => new AnalyticsEvent(
    EventName.LOGIN_FAILED,
    EventCategory.AUTHENTICATION,
    { error: sanitizeError(error) }
  ),

  logoutStarted: () => new AnalyticsEvent(
    EventName.LOGOUT_STARTED,
    EventCategory.AUTHENTICATION
  ),

  logoutCompleted: () => new AnalyticsEvent(
    EventName.LOGOUT_COMPLETED,
    EventCategory.AUTHENTICATION
  ),

  tokenRefreshed: () => new AnalyticsEvent(
    EventName.TOKEN_REFRESHED,
    EventCategory.AUTHENTICATION
  ),

  // Error is sanitized to remove any PII
  tokenRefreshFailed: (error) => new AnalyticsEvent(
    EventName.TOKEN_REFRESH_FAILED,
    EventCategory.AUTHENTICATION,
    { error: sanitizeError(error) }
  ),

  // ===========================================
  // Accessibility/Monitoring Events (matches macOS)
  // ===========================================

  accessibilityPermissionRequested: () => new AnalyticsEvent(
    EventName.ACCESSIBILITY_PERMISSION_REQUESTED,
    EventCategory.ACCESSIBILITY
  ),

  accessibilityPermissionGranted: () => new AnalyticsEvent(
    EventName.ACCESSIBILITY_PERMISSION_GRANTED,
    EventCategory.ACCESSIBILITY
  ),

  accessibilityPermissionDenied: () => new AnalyticsEvent(
    EventName.ACCESSIBILITY_PERMISSION_DENIED,
    EventCategory.ACCESSIBILITY
  ),

  monitoringEnabled: () => new AnalyticsEvent(
    EventName.MONITORING_ENABLED,
    EventCategory.ACCESSIBILITY
  ),

  monitoringDisabled: () => new AnalyticsEvent(
    EventName.MONITORING_DISABLED,
    EventCategory.ACCESSIBILITY
  ),

  monitoringPaused: (reason) => new AnalyticsEvent(
    EventName.MONITORING_PAUSED,
    EventCategory.ACCESSIBILITY,
    { reason: sanitizeError(reason) }
  ),

  monitoringResumed: () => new AnalyticsEvent(
    EventName.MONITORING_RESUMED,
    EventCategory.ACCESSIBILITY
  ),

  // ===========================================
  // Extension Events
  // ===========================================

  permissionRequested: (permission) => new AnalyticsEvent(
    EventName.PERMISSION_REQUESTED,
    EventCategory.EXTENSION,
    { permission }
  ),

  permissionGranted: (permission) => new AnalyticsEvent(
    EventName.PERMISSION_GRANTED,
    EventCategory.EXTENSION,
    { permission }
  ),

  permissionDenied: (permission) => new AnalyticsEvent(
    EventName.PERMISSION_DENIED,
    EventCategory.EXTENSION,
    { permission }
  ),

  // Domain is anonymized to prevent tracking browsing behavior
  siteAllowed: (domain) => new AnalyticsEvent(
    EventName.SITE_ALLOWED,
    EventCategory.EXTENSION,
    { domain_hash: anonymizeValue(extractDomain(domain)) }
  ),

  // Domain is anonymized to prevent tracking browsing behavior
  siteBlocked: (domain) => new AnalyticsEvent(
    EventName.SITE_BLOCKED,
    EventCategory.EXTENSION,
    { domain_hash: anonymizeValue(extractDomain(domain)) }
  ),

  // ===========================================
  // Text Detection Events
  // ===========================================

  // Site is anonymized - we only track that detection occurred, not where
  textFieldDetected: (site) => new AnalyticsEvent(
    EventName.TEXT_FIELD_DETECTED,
    EventCategory.TEXT_DETECTION,
    { site_hash: anonymizeValue(extractDomain(site)) }
  ),

  textFieldLost: () => new AnalyticsEvent(
    EventName.TEXT_FIELD_LOST,
    EventCategory.TEXT_DETECTION
  ),

  // Site is anonymized - we only track that detection occurred, not where
  selectedTextDetected: (site, length) => new AnalyticsEvent(
    EventName.SELECTED_TEXT_DETECTED,
    EventCategory.TEXT_DETECTION,
    { site_hash: anonymizeValue(extractDomain(site)), text_length: length }
  ),

  // ===========================================
  // Suggestion Events
  // ===========================================

  suggestionCategorySelected: (category) => new AnalyticsEvent(
    EventName.SUGGESTION_CATEGORY_SELECTED,
    EventCategory.SUGGESTIONS,
    { category }
  ),

  suggestionTypeSelected: (type, category) => new AnalyticsEvent(
    EventName.SUGGESTION_TYPE_SELECTED,
    EventCategory.SUGGESTIONS,
    { suggestion_type: type, category }
  ),

  suggestionProcessingStarted: (type) => new AnalyticsEvent(
    EventName.SUGGESTION_PROCESSING_STARTED,
    EventCategory.SUGGESTIONS,
    { suggestion_type: type }
  ),

  suggestionProcessingCompleted: (type, duration) => new AnalyticsEvent(
    EventName.SUGGESTION_PROCESSING_COMPLETED,
    EventCategory.SUGGESTIONS,
    { suggestion_type: type, duration_seconds: duration }
  ),

  // Error is sanitized to remove any PII
  suggestionProcessingFailed: (type, error) => new AnalyticsEvent(
    EventName.SUGGESTION_PROCESSING_FAILED,
    EventCategory.SUGGESTIONS,
    { suggestion_type: type, error: sanitizeError(error) }
  ),

  suggestionAccepted: (type) => new AnalyticsEvent(
    EventName.SUGGESTION_ACCEPTED,
    EventCategory.SUGGESTIONS,
    { suggestion_type: type }
  ),

  suggestionRejected: (type) => new AnalyticsEvent(
    EventName.SUGGESTION_REJECTED,
    EventCategory.SUGGESTIONS,
    { suggestion_type: type }
  ),

  suggestionCopied: (type) => new AnalyticsEvent(
    EventName.SUGGESTION_COPIED,
    EventCategory.SUGGESTIONS,
    { suggestion_type: type }
  ),

  // ===========================================
  // Text Injection Events
  // ===========================================

  // Site is anonymized - we only track that injection occurred, not where
  textInjectionStarted: (site) => new AnalyticsEvent(
    EventName.TEXT_INJECTION_STARTED,
    EventCategory.TEXT_INJECTION,
    { site_hash: anonymizeValue(extractDomain(site)) }
  ),

  // Site is anonymized - we only track that injection occurred, not where
  textInjectionSucceeded: (site, method) => new AnalyticsEvent(
    EventName.TEXT_INJECTION_SUCCEEDED,
    EventCategory.TEXT_INJECTION,
    { site_hash: anonymizeValue(extractDomain(site)), injection_method: method }
  ),

  // Site is anonymized, error is sanitized
  textInjectionFailed: (site, error) => new AnalyticsEvent(
    EventName.TEXT_INJECTION_FAILED,
    EventCategory.TEXT_INJECTION,
    { site_hash: anonymizeValue(extractDomain(site)), error: sanitizeError(error) }
  ),

  // ===========================================
  // UI Events (matches macOS)
  // ===========================================

  mainWindowOpened: () => new AnalyticsEvent(
    EventName.MAIN_WINDOW_OPENED,
    EventCategory.UI_INTERACTION
  ),

  mainWindowClosed: () => new AnalyticsEvent(
    EventName.MAIN_WINDOW_CLOSED,
    EventCategory.UI_INTERACTION
  ),

  actionButtonClicked: (action) => new AnalyticsEvent(
    EventName.ACTION_BUTTON_CLICKED,
    EventCategory.UI_INTERACTION,
    { action }
  ),

  actionMenuOpened: () => new AnalyticsEvent(
    EventName.ACTION_MENU_OPENED,
    EventCategory.UI_INTERACTION
  ),

  actionMenuClosed: () => new AnalyticsEvent(
    EventName.ACTION_MENU_CLOSED,
    EventCategory.UI_INTERACTION
  ),

  overlayDisplayed: () => new AnalyticsEvent(
    EventName.OVERLAY_DISPLAYED,
    EventCategory.UI_INTERACTION
  ),

  overlayHidden: () => new AnalyticsEvent(
    EventName.OVERLAY_HIDDEN,
    EventCategory.UI_INTERACTION
  ),

  aboutWindowOpened: () => new AnalyticsEvent(
    EventName.ABOUT_WINDOW_OPENED,
    EventCategory.UI_INTERACTION
  ),

  settingsOpened: () => new AnalyticsEvent(
    EventName.SETTINGS_OPENED,
    EventCategory.UI_INTERACTION
  ),

  historyOpened: () => new AnalyticsEvent(
    EventName.HISTORY_OPENED,
    EventCategory.UI_INTERACTION
  ),

  accountOpened: () => new AnalyticsEvent(
    EventName.ACCOUNT_OPENED,
    EventCategory.UI_INTERACTION
  ),

  // ===========================================
  // Team Events
  // Team IDs are internal UUIDs, not PII
  // ===========================================

  teamSwitched: (teamId) => new AnalyticsEvent(
    EventName.TEAM_SWITCHED,
    EventCategory.TEAM,
    { team_id: teamId }
  ),

  teamCreated: () => new AnalyticsEvent(
    EventName.TEAM_CREATED,
    EventCategory.TEAM
  ),

  teamJoined: (teamId) => new AnalyticsEvent(
    EventName.TEAM_JOINED,
    EventCategory.TEAM,
    { team_id: teamId }
  ),

  // ===========================================
  // Error Events
  // All error messages are sanitized
  // ===========================================

  errorOccurred: (domain, code, message) => new AnalyticsEvent(
    EventName.ERROR_OCCURRED,
    EventCategory.ERRORS,
    { error_domain: domain, error_code: code, error_message: sanitizeError(message) }
  ),

  // Endpoint paths are anonymized, error messages sanitized
  apiError: (endpoint, statusCode, message) => new AnalyticsEvent(
    EventName.API_ERROR,
    EventCategory.ERRORS,
    {
      endpoint_hash: anonymizeValue(endpoint),
      status_code: statusCode,
      error_message: sanitizeError(message)
    }
  ),

  // ===========================================
  // Performance Events
  // ===========================================

  performanceMetric: (name, value, unit = 'ms') => new AnalyticsEvent(
    EventName.PERFORMANCE_METRIC,
    EventCategory.PERFORMANCE,
    { metric_name: name, metric_value: value, metric_unit: unit }
  ),

  // Page is anonymized
  pageLoadTime: (page, duration) => new AnalyticsEvent(
    EventName.PAGE_LOAD_TIME,
    EventCategory.PERFORMANCE,
    { page_hash: anonymizeValue(page), duration_ms: duration }
  ),

  // Endpoint is anonymized
  apiResponseTime: (endpoint, duration) => new AnalyticsEvent(
    EventName.API_RESPONSE_TIME,
    EventCategory.PERFORMANCE,
    { endpoint_hash: anonymizeValue(endpoint), duration_ms: duration }
  ),

  // ===========================================
  // Crash Event
  // ===========================================

  crashDetected: (reason) => new AnalyticsEvent(
    EventName.CRASH_DETECTED,
    EventCategory.ERRORS,
    { reason: sanitizeError(reason) }
  ),

  // ===========================================
  // Custom Event
  // WARNING: Caller is responsible for ensuring no PII in parameters
  // ===========================================

  custom: (name, parameters = {}) => new AnalyticsEvent(
    name,
    EventCategory.CUSTOM,
    parameters
  )
};

/**
 * User properties for analytics
 *
 * PRIVACY NOTICE:
 * - User IDs are internal UUIDs from our system, not PII
 * - Email addresses are NEVER sent - only the domain is extracted for aggregate stats
 * - Team IDs are internal UUIDs, not PII
 * - All user-identifying information is stripped before sending to analytics
 */
export class AnalyticsUserProperties {
  constructor({
    userId = null,
    email = null,
    teamId = null
  } = {}) {
    // Store internally but don't expose directly
    this._userId = userId;
    this._email = email;
    this._teamId = teamId;
    this.extensionVersion = this._getExtensionVersion();
    this.browser = this._getBrowser();
    this.browserVersion = this._getBrowserVersion();
    this.platform = 'chrome_extension';
  }

  // Expose anonymized user ID (first 8 chars of hash)
  get userId() {
    return this._userId ? anonymizeValue(this._userId) : null;
  }

  // Expose only email domain, never the full email
  get emailDomain() {
    if (!this._email) return null;
    const parts = this._email.split('@');
    return parts.length > 1 ? parts[1] : 'unknown';
  }

  // Expose anonymized team ID
  get teamId() {
    return this._teamId ? anonymizeValue(this._teamId) : null;
  }

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

  _getBrowser() {
    try {
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      if (userAgent.includes('Edg/')) return 'edge';
      if (userAgent.includes('Chrome/')) return 'chrome';
      if (userAgent.includes('Firefox/')) return 'firefox';
      if (userAgent.includes('Safari/')) return 'safari';
    } catch (e) {
      // Ignore errors
    }
    return 'unknown';
  }

  _getBrowserVersion() {
    try {
      const userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '';
      const match = userAgent.match(/(Chrome|Edg|Firefox|Safari)\/(\d+)/);
      return match ? match[2] : 'unknown';
    } catch (e) {
      // Ignore errors
    }
    return 'unknown';
  }

  /**
   * Convert to dictionary for analytics
   * This method ensures NO PII is included in the output
   * @returns {Object} Privacy-safe user properties as dictionary
   */
  asDictionary() {
    const dict = {
      extension_version: this.extensionVersion,
      browser: this.browser,
      browser_version: this.browserVersion,
      platform: this.platform
    };

    // Only include anonymized user ID (hash, not actual ID)
    if (this._userId) {
      dict.user_id_hash = anonymizeValue(this._userId);
    }

    // Only include email domain, never the full email
    if (this._email) {
      const parts = this._email.split('@');
      dict.email_domain = parts.length > 1 ? parts[1] : 'unknown';
    }

    // Only include anonymized team ID (hash, not actual ID)
    if (this._teamId) {
      dict.team_id_hash = anonymizeValue(this._teamId);
    }

    return dict;
  }
}

// Export privacy utilities for use in other modules
export const PrivacyUtils = {
  anonymizeValue,
  extractDomain,
  sanitizeError
};

export default {
  EventCategory,
  EventName,
  AnalyticsEvent,
  Events,
  AnalyticsUserProperties,
  PrivacyUtils,
  anonymizeValue,
  extractDomain,
  sanitizeError
};
