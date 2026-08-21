/**
 * Analytics Module Index
 * Central export for all analytics components
 *
 * Usage:
 *   import { Analytics, Events, AnalyticsManager } from './analytics';
 *
 *   // Initialize
 *   await AnalyticsManager.shared.initialize({ trackers: [...] });
 *
 *   // Track events
 *   Analytics.track(Events.loginSucceeded('auth0'));
 *   Analytics.trackAsync(Events.popupOpened());
 */

// Core exports
export {
  EventCategory,
  EventName,
  AnalyticsEvent,
  Events,
  AnalyticsUserProperties
} from './AnalyticsEvents.js';

export {
  TrackerType,
  AnalyticsConfiguration,
  AnalyticsTracker
} from './AnalyticsTracker.js';

export {
  AnalyticsManager,
  Analytics
} from './AnalyticsManager.js';

// Tracker exports
export { ConsoleTracker } from './trackers/ConsoleTracker.js';
export { GoogleAnalyticsTracker } from './trackers/GoogleAnalyticsTracker.js';
export { PostHogTracker } from './trackers/PostHogTracker.js';
export { FirebaseTracker } from './trackers/FirebaseTracker.js';

// Default export for convenience
import { Analytics, AnalyticsManager } from './AnalyticsManager.js';
import { Events, AnalyticsUserProperties } from './AnalyticsEvents.js';
import { ConsoleTracker } from './trackers/ConsoleTracker.js';
import { GoogleAnalyticsTracker } from './trackers/GoogleAnalyticsTracker.js';
import { PostHogTracker } from './trackers/PostHogTracker.js';
import { FirebaseTracker } from './trackers/FirebaseTracker.js';

export default {
  Analytics,
  AnalyticsManager,
  Events,
  AnalyticsUserProperties,
  ConsoleTracker,
  GoogleAnalyticsTracker,
  PostHogTracker,
  FirebaseTracker
};
