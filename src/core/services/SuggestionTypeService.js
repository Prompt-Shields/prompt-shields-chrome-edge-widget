/**
 * SuggestionType Service Implementation
 * Handles CRUD operations for custom suggestion types
 * Ports the logic from macOS SuggestionDomainService
 */

import { SuggestionTypeModel } from '../models/SuggestionTypeModel.js';

/**
 * Service for managing custom suggestion types
 */
export class SuggestionTypeService {
  constructor(logger = console) {
    this.logger = logger;
    this.suggestionTypesCache = [];
    this.cacheTimestamp = null;
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Build URL from template with parameters
   * @param {string} urlTemplate - URL template with placeholders
   * @param {Object} params - Parameters to substitute
   * @returns {string} Built URL
   */
  buildUrl(urlTemplate, params = {}) {
    let url = urlTemplate;
    Object.entries(params).forEach(([key, value]) => {
      url = url.replace(`{${key}}`, encodeURIComponent(value));
    });
    return url;
  }

  /**
   * Fetch suggestion types from server
   * @param {Object} credentials - User credentials with accessToken
   * @param {Object} profile - User profile with suggestionTypeGroupId
   * @returns {Promise<SuggestionTypeModel[]>} Array of suggestion types
   */
  async fetchSuggestionTypes(credentials, profile) {
    this.logger.log('Fetching suggestion types from server');

    if (!credentials || !credentials.accessToken) {
      throw new Error('No valid credentials available');
    }

    if (!profile || !profile.default_suggestion_type_group_id) {
      throw new Error('Profile or suggestion type group ID not available');
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = this.getBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}?offset=0&limit=100`;

    const response = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch suggestion types: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Handle paginated response (matches macOS implementation)
    const items = data.items || data.content?.items || [];
    const suggestionTypes = items.map(item => new SuggestionTypeModel(item));

    // Update cache
    this.suggestionTypesCache = suggestionTypes;
    this.cacheTimestamp = Date.now();

    this.logger.log(`Fetched ${suggestionTypes.length} suggestion types from server`);
    return suggestionTypes;
  }

  /**
   * List suggestion types (from cache or server)
   * @param {Object} credentials - User credentials
   * @param {Object} profile - User profile
   * @param {boolean} enabledOnly - Filter to enabled types only
   * @returns {Promise<SuggestionTypeModel[]>} Array of suggestion types
   */
  async listSuggestionTypes(credentials, profile, enabledOnly = false) {
    // Check cache first
    if (this.isCacheValid()) {
      let types = [...this.suggestionTypesCache];
      if (enabledOnly) {
        types = types.filter(t => t.isEnabled);
      }
      return types.sort((a, b) => a.sortOrder - b.sortOrder);
    }

    // Fetch from server
    const types = await this.fetchSuggestionTypes(credentials, profile);

    if (enabledOnly) {
      return types.filter(t => t.isEnabled).sort((a, b) => a.sortOrder - b.sortOrder);
    }
    return types.sort((a, b) => a.sortOrder - b.sortOrder);
  }

  /**
   * Create a new suggestion type
   * @param {SuggestionTypeModel} suggestionType - Suggestion type to create
   * @param {Object} credentials - User credentials
   * @returns {Promise<SuggestionTypeModel>} Created suggestion type
   */
  async createSuggestionType(suggestionType, credentials) {
    this.logger.log('Creating suggestion type:', suggestionType.name);

    if (!credentials || !credentials.accessToken) {
      throw new Error('No valid credentials available');
    }

    const baseUrl = this.getBaseUrl();
    const request = suggestionType.toCreateRequest();

    const response = await fetch(`${baseUrl}/`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create suggestion type: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const createdType = new SuggestionTypeModel(data);

    // Update cache
    this.suggestionTypesCache.push(createdType);

    this.logger.log('Created suggestion type:', createdType.id);
    return createdType;
  }

  /**
   * Update an existing suggestion type
   * @param {SuggestionTypeModel} suggestionType - Suggestion type to update
   * @param {Object} credentials - User credentials
   * @param {Object} profile - User profile
   * @returns {Promise<SuggestionTypeModel>} Updated suggestion type
   */
  async updateSuggestionType(suggestionType, credentials, profile) {
    this.logger.log('Updating suggestion type:', suggestionType.id);

    if (!credentials || !credentials.accessToken) {
      throw new Error('No valid credentials available');
    }

    if (!profile || !profile.default_suggestion_type_group_id) {
      throw new Error('Profile or suggestion type group ID not available');
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = this.getBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}/suggestion-type-id/${suggestionType.id}`;
    const request = suggestionType.toUpdateRequest();

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(request)
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update suggestion type: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const updatedType = new SuggestionTypeModel(data);

    // Update cache
    const index = this.suggestionTypesCache.findIndex(t => t.id === updatedType.id);
    if (index >= 0) {
      this.suggestionTypesCache[index] = updatedType;
    }

    this.logger.log('Updated suggestion type:', updatedType.id);
    return updatedType;
  }

  /**
   * Delete a suggestion type
   * @param {SuggestionTypeModel} suggestionType - Suggestion type to delete
   * @param {Object} credentials - User credentials
   * @param {Object} profile - User profile
   * @returns {Promise<void>}
   */
  async deleteSuggestionType(suggestionType, credentials, profile) {
    this.logger.log('Deleting suggestion type:', suggestionType.id);

    if (!credentials || !credentials.accessToken) {
      throw new Error('No valid credentials available');
    }

    if (!profile || !profile.default_suggestion_type_group_id) {
      throw new Error('Profile or suggestion type group ID not available');
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = this.getBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}/suggestion-type-id/${suggestionType.id}`;

    const response = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to delete suggestion type: ${response.status} ${errorText}`);
    }

    // Update cache
    this.suggestionTypesCache = this.suggestionTypesCache.filter(t => t.id !== suggestionType.id);

    this.logger.log('Deleted suggestion type:', suggestionType.id);
  }

  /**
   * Toggle suggestion type enabled state
   * @param {SuggestionTypeModel} suggestionType - Suggestion type to toggle
   * @param {boolean} isEnabled - New enabled state
   * @param {Object} credentials - User credentials
   * @param {Object} profile - User profile
   * @returns {Promise<SuggestionTypeModel>} Updated suggestion type
   */
  async toggleSuggestionType(suggestionType, isEnabled, credentials, profile) {
    this.logger.log(`Toggling suggestion type ${suggestionType.id} to enabled: ${isEnabled}`);

    if (!credentials || !credentials.accessToken) {
      throw new Error('No valid credentials available');
    }

    if (!profile || !profile.default_suggestion_type_group_id) {
      throw new Error('Profile or suggestion type group ID not available');
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = this.getBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}/suggestion-type-id/${suggestionType.id}/toggle?is_enabled=${isEnabled}`;

    const response = await fetch(endpoint, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to toggle suggestion type: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const updatedType = new SuggestionTypeModel(data);

    // Update cache
    const index = this.suggestionTypesCache.findIndex(t => t.id === updatedType.id);
    if (index >= 0) {
      this.suggestionTypesCache[index] = updatedType;
    }

    this.logger.log('Toggled suggestion type:', updatedType.id);
    return updatedType;
  }

  /**
   * Reset suggestion types to defaults
   * @param {Object} credentials - User credentials
   * @param {Object} profile - User profile
   * @returns {Promise<number>} Number of types reset
   */
  async resetSuggestionTypes(credentials, profile) {
    this.logger.log('Resetting suggestion types to defaults');

    if (!credentials || !credentials.accessToken) {
      throw new Error('No valid credentials available');
    }

    if (!profile || !profile.default_suggestion_type_group_id) {
      throw new Error('Profile or suggestion type group ID not available');
    }

    const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
    const baseUrl = this.getBaseUrl();
    const endpoint = `${baseUrl}/${suggestionTypeGroupId}/reset`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${credentials.accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({})
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to reset suggestion types: ${response.status} ${errorText}`);
    }

    const data = await response.json();
    const count = data.count || 0;

    // Refresh cache
    await this.fetchSuggestionTypes(credentials, profile);

    this.logger.log(`Reset suggestion types: ${count} defaults created`);
    return count;
  }

  /**
   * Get suggestion types from cache
   * @returns {SuggestionTypeModel[]} Cached suggestion types
   */
  getCachedSuggestionTypes() {
    return [...this.suggestionTypesCache];
  }

  /**
   * Clear the cache
   */
  clearCache() {
    this.suggestionTypesCache = [];
    this.cacheTimestamp = null;
  }

  /**
   * Check if cache is valid
   * @returns {boolean} True if cache is valid
   */
  isCacheValid() {
    if (!this.cacheTimestamp || this.suggestionTypesCache.length === 0) {
      return false;
    }
    return (Date.now() - this.cacheTimestamp) < this.cacheTimeout;
  }

  /**
   * Get base URL for suggestion types API
   * @returns {string} Base URL
   */
  getBaseUrl() {
    // Try to get from config in different contexts
    if (typeof self !== 'undefined' && self.Config) {
      try {
        const config = new self.Config();
        return config.getApiUrl(window.suggestionTypesBaseUrl);
      } catch (e) {
        // Fallback
      }
    }

    if (typeof window !== 'undefined' && window.suggestionTypesBaseUrl) {
      return window.suggestionTypesBaseUrl;
    }

    // Fallback to default dev URL
    return '-';
  }
}

// Create singleton instance
export const suggestionTypeService = new SuggestionTypeService();
