/**
 * Profile Service Implementation
 * Handles user profile data fetching, caching, and management
 * Implements Single Responsibility Principle (SRP)
 */

import { IProfileService } from '../interfaces/IAuthenticationService.js';

/**
 * User profile service with caching and error handling
 */
export class ProfileService extends IProfileService {
  constructor(httpClient, logger, config) {
    super();
    this.httpClient = httpClient;
    this.logger = logger;
    this.config = config;

    this.profileCache = null;
    this.cacheTimestamp = null;
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutes
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second
  }

  /**
   * Fetch user profile from API
   * @param {Object} credentials - User credentials for API authentication
   * @returns {Promise<Object|null>} User profile or null
   */
  async fetchProfile(credentials = null) {
    let attempt = 0;

    while (attempt < this.maxRetries) {
      try {
        this.logger.info('Fetching user profile', { attempt: attempt + 1 });

        // Get credentials if not provided
        if (!credentials) {
          // This would typically come from the credential storage
          // For now, we'll assume it's handled by the caller
          throw new Error('Credentials required for profile fetch');
        }

        if (!credentials.accessToken) {
          throw new Error('Access token required for profile fetch');
        }

        // Get profile service URL
        const profileUrl = this.config.getApiUrl('profileServiceUrl');

        // Make API request
        const response = await this.httpClient.get(profileUrl, {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Accept': 'application/json'
        });

        if (!response.ok) {
          throw new Error(`Profile API request failed: ${response.status} ${response.statusText}`);
        }

        const profileData = await response.json();

        // Validate response structure
        if (!this.validateProfileResponse(profileData)) {
          throw new Error('Invalid profile response structure');
        }

        // Process and cache the profile
        const processedProfile = this.processProfileData(profileData);
        this.cacheProfile(processedProfile);

        this.logger.info('Profile fetched successfully', {
          userId: processedProfile.id,
          hasTeamId: !!processedProfile.default_team_id
        });

        return processedProfile;

      } catch (error) {
        attempt++;
        this.logger.error(`Profile fetch attempt ${attempt} failed`, error);

        if (attempt >= this.maxRetries) {
          this.logger.error('Profile fetch failed after all retries', error);
          return null;
        }

        // Wait before retry
        await this.delay(this.retryDelay * attempt);
      }
    }

    return null;
  }

  /**
   * Get cached user profile
   * @returns {Promise<Object|null>} Cached profile or null
   */
  async getCachedProfile() {
    if (!this.profileCache || !this.cacheTimestamp) {
      this.logger.debug('No cached profile available');
      return null;
    }

    // Check if cache is expired
    const now = Date.now();
    if (now - this.cacheTimestamp > this.cacheTimeout) {
      this.logger.debug('Cached profile expired');
      this.clearProfileCache();
      return null;
    }

    this.logger.debug('Returning cached profile');
    return { ...this.profileCache }; // Return copy to prevent mutation
  }

  /**
   * Clear cached profile data
   * @returns {Promise<void>}
   */
  async clearProfile() {
    this.clearProfileCache();
    this.logger.info('Profile cache cleared');
  }

  /**
   * Get profile with automatic caching
   * @param {Object} credentials - User credentials
   * @param {boolean} forceRefresh - Force refresh from API
   * @returns {Promise<Object|null>} User profile
   */
  async getProfile(credentials = null, forceRefresh = false) {
    try {
      // Return cached profile if available and not forcing refresh
      if (!forceRefresh) {
        const cached = await this.getCachedProfile();
        if (cached) {
          return cached;
        }
      }

      // Fetch fresh profile from API
      return await this.fetchProfile(credentials);

    } catch (error) {
      this.logger.error('Error getting profile', error);

      // Return cached profile as fallback if available
      const cached = await this.getCachedProfile();
      if (cached) {
        this.logger.info('Returning cached profile as fallback');
        return cached;
      }

      return null;
    }
  }

  /**
   * Validate profile response structure
   * @param {Object} profileData - Profile data from API
   * @returns {boolean} True if valid
   * @private
   */
  validateProfileResponse(profileData) {
    if (!profileData || typeof profileData !== 'object') {
      return false;
    }

    // Check for success field
    if (!profileData.success) {
      return false;
    }

    // Check for content field
    if (!profileData.content || typeof profileData.content !== 'object') {
      return false;
    }

    const content = profileData.content;

    // Check required fields
    const requiredFields = ['id'];
    for (const field of requiredFields) {
      if (!content[field]) {
        this.logger.warn(`Missing required profile field: ${field}`);
        return false;
      }
    }

    return true;
  }

  /**
   * Process and normalize profile data
   * @param {Object} profileData - Raw profile data from API
   * @returns {Object} Processed profile data
   * @private
   */
  processProfileData(profileData) {
    const content = profileData.content;

    // Normalize field names and provide defaults
    const processed = {
      id: content.id,
      default_organisation_id: content.default_organisation_id || content.organisation_id || null,
      default_subscription_id: content.default_subscription_id || content.subscription_id || null,
      default_project_id: content.default_project_id || content.project_id || null,
      default_tenant_id: content.default_tenant_id || content.tenant_id || null,
      default_team_id: content.default_team_id || content.team_id || null,
      default_suggestion_group_id: content.default_suggestion_group_id || content.suggestion_group_id || null,
      created_at: content.created_at || null,
      updated_at: content.updated_at || null,

      // Additional fields that might be present
      email: content.email || null,
      first_name: content.first_name || null,
      last_name: content.last_name || null,
      avatar_url: content.avatar_url || null,
      preferences: content.preferences || {},
      permissions: content.permissions || [],

      // Metadata
      fetched_at: new Date().toISOString(),
      version: '1.0'
    };

    // Validate critical IDs
    if (!processed.default_team_id || !processed.default_suggestion_group_id) {
      this.logger.warn('Profile missing critical IDs', {
        hasTeamId: !!processed.default_team_id,
        hasSuggestionGroupId: !!processed.default_suggestion_group_id
      });
    }

    return processed;
  }

  /**
   * Cache profile data
   * @param {Object} profile - Profile data to cache
   * @private
   */
  cacheProfile(profile) {
    this.profileCache = { ...profile }; // Store copy
    this.cacheTimestamp = Date.now();

    this.logger.debug('Profile cached', {
      userId: profile.id,
      cacheTimestamp: this.cacheTimestamp
    });
  }

  /**
   * Clear profile cache
   * @private
   */
  clearProfileCache() {
    this.profileCache = null;
    this.cacheTimestamp = null;
  }

  /**
   * Delay execution for specified milliseconds
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   * @private
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Update profile data (partial update)
   * @param {Object} updates - Profile updates
   * @param {Object} credentials - User credentials
   * @returns {Promise<Object|null>} Updated profile
   */
  async updateProfile(updates, credentials) {
    try {
      this.logger.info('Updating profile', { updates: Object.keys(updates) });

      if (!credentials || !credentials.accessToken) {
        throw new Error('Access token required for profile update');
      }

      const profileUrl = this.config.getApiUrl('profileServiceUrl');

      const response = await this.httpClient.put(profileUrl, updates, {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json'
      });

      if (!response.ok) {
        throw new Error(`Profile update failed: ${response.status} ${response.statusText}`);
      }

      const updatedData = await response.json();

      if (this.validateProfileResponse(updatedData)) {
        const processedProfile = this.processProfileData(updatedData);
        this.cacheProfile(processedProfile);

        this.logger.info('Profile updated successfully');
        return processedProfile;
      } else {
        throw new Error('Invalid profile update response');
      }

    } catch (error) {
      this.logger.error('Profile update failed', error);
      return null;
    }
  }

  /**
   * Check if profile has required data for application functionality
   * @param {Object} profile - Profile to check
   * @returns {Object} Validation result
   */
  validateProfileCompleteness(profile) {
    if (!profile) {
      return {
        isComplete: false,
        missing: ['profile'],
        message: 'No profile data available'
      };
    }

    const missing = [];

    // Check critical IDs
    if (!profile.default_team_id) {
      missing.push('team_id');
    }

    if (!profile.default_suggestion_group_id) {
      missing.push('suggestion_group_id');
    }

    const isComplete = missing.length === 0;

    return {
      isComplete,
      missing,
      message: isComplete ? 'Profile is complete' : `Missing: ${missing.join(', ')}`
    };
  }

  /**
   * Get profile service statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      hasCachedProfile: !!this.profileCache,
      cacheAge: this.cacheTimestamp ? Date.now() - this.cacheTimestamp : null,
      cacheTimeout: this.cacheTimeout,
      maxRetries: this.maxRetries,
      retryDelay: this.retryDelay
    };
  }

  /**
   * Health check for profile service
   * @returns {Promise<Object>} Health check result
   */
  async healthCheck() {
    try {
      // Check if we can construct API URLs
      const profileUrl = this.config.getApiUrl('profileServiceUrl');

      return {
        status: 'healthy',
        canConstructUrls: !!profileUrl,
        hasCachedData: !!this.profileCache,
        httpClientAvailable: !!this.httpClient
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message
      };
    }
  }

  /**
   * Configure profile service
   * @param {Object} newConfig - New configuration
   */
  configure(newConfig) {
    if (newConfig.cacheTimeout) {
      this.cacheTimeout = newConfig.cacheTimeout;
    }

    if (newConfig.maxRetries) {
      this.maxRetries = newConfig.maxRetries;
    }

    if (newConfig.retryDelay) {
      this.retryDelay = newConfig.retryDelay;
    }

    this.logger.info('Profile service configured', newConfig);
  }
}

