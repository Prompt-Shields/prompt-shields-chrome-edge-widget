/**
 * History service for managing suggestions history
 * Handles API communication for retrieving and managing user's suggestion history
 */

const { SecureApiClient, ErrorHandler, InputValidator } = require('../utils/securityUtils.js');
const { configLoader } = require('../utils/configLoader.js');
const { config } = require('../config/config.js');

/**
 * HistoryService class for managing suggestions history
 */
class HistoryService {
  constructor() {
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes cache
    this.isConfigLoaded = false;
    this.suggestionTypes = null;
    this.suggestionTypesCache = null;
  }

  /**
   * Ensure configuration is loaded
   * @returns {Promise<void>}
   */
  async ensureConfigLoaded() {
    if (!this.isConfigLoaded) {
      await configLoader.loadConfig();
      this.isConfigLoaded = true;
    }
  }

  /**
   * Ensure API configuration is available
   * @returns {void}
   * @throws {Error} If API configuration is not available
   */
  ensureApiConfigLoaded() {
    if (!config.isLoaded()) {
      config.init(); // Auto-initialize if not loaded
    }
  }

  /**
   * Get suggestion types from API
   * @param {Object} credentials - User credentials for API authentication
   * @returns {Promise<Array>} Array of suggestion types
   */
  async getSuggestionTypes(credentials) {
    try {
      // Return cached types if available and not expired
      if (this.suggestionTypesCache &&
        (Date.now() - this.suggestionTypesCache.timestamp) < this.cacheTimeout) {
        return this.suggestionTypesCache.data;
      }

      // Ensure configuration is loaded
      await this.ensureConfigLoaded();
      this.ensureApiConfigLoaded();

      // Validate credentials
      if (!credentials || !credentials.accessToken) {
        throw new Error('Valid credentials required');
      }

      // Build URL using unified config
      const url = config.getApiUrl('suggestionTypesServiceUrl');

      const response = await SecureApiClient.makeRequest(url, {
        method: 'GET'
      }, credentials);

      const data = await response.json();

      // Validate response structure
      if (!data || !data.success || !data.content || !Array.isArray(data.content.items)) {
        throw new Error('Invalid response format from suggestion types API');
      }

      // Process and sanitize the data
      const processedTypes = data.content.items.map(item => ({
        type: InputValidator.sanitizeHtml(item.type || ''),
        name: InputValidator.sanitizeHtml(item.name || '')
      }));

      // Cache the response
      this.suggestionTypesCache = {
        data: processedTypes,
        timestamp: Date.now()
      };

      return processedTypes;
    } catch (error) {
      ErrorHandler.logError(error, { context: 'HistoryService.getSuggestionTypes' });
      throw new Error(ErrorHandler.sanitizeErrorMessage(error));
    }
  }

  /**
   * Get suggestions history with pagination from new API endpoint
   * @param {Object} credentials - User credentials for API authentication
   * @param {Object} profile - User profile with team and suggestion group IDs
   * @param {Object} options - Pagination options
   * @returns {Promise<Object>} History response with items and pagination
   */
  async getSuggestionsHistory(credentials, profile, options = {}) {
    try {
      // Ensure configuration is loaded
      await this.ensureConfigLoaded();
      this.ensureApiConfigLoaded();

      // Validate credentials
      if (!credentials || !credentials.accessToken) {
        throw new Error('Valid credentials required');
      }

      // Validate profile and normalize field names
      if (!profile) {
        throw new Error('Valid profile required');
      }

      // Look for team and suggestion group IDs with different potential naming
      const teamId = profile.default_team_id || profile.team_id || profile.teamId;
      const suggestionGroupId = profile.default_suggestion_group_id || profile.suggestions_group_id || profile.suggestionGroupId;

      if (!teamId || !suggestionGroupId) {
        console.error('Profile missing required IDs:', {
          profile,
          teamId,
          suggestionGroupId,
          availableKeys: Object.keys(profile)
        });
        throw new Error(`Valid profile with team and suggestion group IDs required. Available: ${Object.keys(profile).join(', ')}`);
      }

      // Normalize the profile object to ensure consistent field names
      profile.default_team_id = teamId;
      profile.default_suggestion_group_id = suggestionGroupId;

      // Set default pagination options
      const {
        limit = 20,
        offset = 0
      } = options;

      // Validate pagination parameters
      if (limit < 1 || limit > 100) {
        throw new Error('Limit must be between 1 and 100');
      }
      if (offset < 0) {
        throw new Error('Offset must be non-negative');
      }

      // Build query parameters
      const queryParams = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString()
      });

      // Check cache for this request
      const cacheKey = `suggestions_${profile.default_team_id}_${profile.default_suggestion_group_id}_${limit}_${offset}`;
      const cachedData = this.getCachedData(cacheKey);
      if (cachedData) {
        return cachedData;
      }

      // Build URL using unified config with template
      const baseUrl = config.buildApiUrl('suggestionHistoryUrl', {
        teamId: profile.default_team_id,
        suggestionGroupId: profile.default_suggestion_group_id
      });
      const url = `${baseUrl}?${queryParams.toString()}`;

      const response = await SecureApiClient.makeRequest(url, {
        method: 'GET'
      }, credentials);

      const data = await response.json();

      // Validate response structure
      if (!this.validateNewApiResponse(data)) {
        throw new Error('Invalid response format from suggestions API');
      }

      // Process and sanitize the data
      const processedData = this.processNewApiData(data);

      // Cache the response
      this.setCachedData(cacheKey, processedData);

      return processedData;
    } catch (error) {
      ErrorHandler.logError(error, { context: 'HistoryService.getSuggestionsHistory', options });
      throw new Error(ErrorHandler.sanitizeErrorMessage(error));
    }
  }





  /**
   * Validate new API response structure
   * @param {Object} data - Response data to validate
   * @returns {boolean} True if valid response structure
   * @private
   */
  validateNewApiResponse(data) {
    return data &&
      data.success === true &&
      data.content &&
      Array.isArray(data.content.items) &&
      typeof data.content.offset === 'number' &&
      typeof data.content.total === 'number' &&
      typeof data.content.limit === 'number';
  }


  /**
   * Process and sanitize new API data
   * @param {Object} data - Raw API data
   * @returns {Object} Processed history data
   * @private
   */
  processNewApiData(data) {
    const processedItems = data.content.items.map(item => ({
      id: InputValidator.sanitizeHtml(item.suggestion_group_id || ''),
      original_text: InputValidator.sanitizeHtml(item.original_text || ''),
      suggested_text: InputValidator.sanitizeHtml(item.suggested_text || ''),
      suggestion_type: InputValidator.sanitizeHtml(item.suggestion_type || ''),
      timestamp: item.created_at || null,
      application: InputValidator.sanitizeHtml(item.application || ''),
      user_id: InputValidator.sanitizeHtml(item.user_id || ''),
      accepted: Boolean(item.accepted),
      confidence_score: Number(item.confidence_score) || 0
    }));

    const hasNext = (data.content.offset + data.content.limit) < data.content.total;

    return {
      items: processedItems,
      pagination: {
        offset: data.content.offset,
        limit: data.content.limit,
        total: data.content.total,
        hasNext
      }
    };
  }


  /**
   * Get cached data
   * @param {string} key - Cache key
   * @returns {Object|null} Cached data or null
   * @private
   */
  getCachedData(key) {
    const cached = this.cache.get(key);
    if (!cached) {
      return null;
    }

    const now = Date.now();
    if (now - cached.timestamp > this.cacheTimeout) {
      this.cache.delete(key);
      return null;
    }

    return cached.data;
  }

  /**
   * Set cached data
   * @param {string} key - Cache key
   * @param {Object} data - Data to cache
   * @private
   */
  setCachedData(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });

    // Limit cache size
    if (this.cache.size > 50) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
  }

  /**
   * Clear all cached data
   */
  clearCache() {
    this.cache.clear();
  }

  /**
   * Format timestamp for display
   * @param {string} timestamp - ISO timestamp
   * @returns {string} Formatted timestamp
   */
  formatTimestamp(timestamp) {
    if (!timestamp) {
      return 'Unknown';
    }

    try {
      const date = new Date(timestamp);
      const now = new Date();
      const diffMs = now - date;
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return 'Today';
      } else if (diffDays === 1) {
        return 'Yesterday';
      } else if (diffDays < 7) {
        return `${diffDays} days ago`;
      } else {
        return date.toLocaleDateString();
      }
    } catch (error) {
      return 'Invalid date';
    }
  }

  /**
   * Get suggestion type display information
   * @param {string} type - Suggestion type
   * @param {Array} suggestionTypes - Array of suggestion types from API
   * @returns {Object} Display information for the type
   */
  getSuggestionTypeDisplay(type, suggestionTypes = null) {
    // First try to find from API data if available
    if (suggestionTypes && Array.isArray(suggestionTypes)) {
      const apiType = suggestionTypes.find(t => t.type === type);
      if (apiType) {
        return {
          label: apiType.name,
          color: this.getTypeColor(type),
          icon: this.getTypeIcon(type)
        };
      }
    }

    // Fallback to static mapping
    const typeDisplayMap = {
      'CUSTOMER_SERVICE': {
        label: 'Customer Service',
        color: '#3498db',
        icon: '🎧'
      },
      'RISK_COMPLIANCE': {
        label: 'Risk & Compliance',
        color: '#e74c3c',
        icon: '⚖️'
      },
      'FINANCE_TREASURY': {
        label: 'Finance and treasury',
        color: '#2ecc71',
        icon: '💰'
      },
      'IT_SECURITY': {
        label: 'IT & Security',
        color: '#9b59b6',
        icon: '🔒'
      },
      'HR_PEOPLE': {
        label: 'HR & People',
        color: '#f39c12',
        icon: '👥'
      },
      'grammar': {
        label: 'Grammar',
        color: '#e74c3c',
        icon: '📝'
      },
      'style': {
        label: 'Style',
        color: '#3498db',
        icon: '🎨'
      },
      'tone': {
        label: 'Tone',
        color: '#9b59b6',
        icon: '🎭'
      },
      'clarity': {
        label: 'Clarity',
        color: '#2ecc71',
        icon: '💡'
      },
      'conciseness': {
        label: 'Conciseness',
        color: '#f39c12',
        icon: '✂️'
      },
      'formality': {
        label: 'Formality',
        color: '#34495e',
        icon: '👔'
      },
      'spelling': {
        label: 'Spelling',
        color: '#e67e22',
        icon: '🔤'
      }
    };

    return typeDisplayMap[type] || {
      label: type || 'Unknown',
      color: '#95a5a6',
      icon: '❓'
    };
  }

  /**
   * Get color for suggestion type
   * @param {string} type - Suggestion type
   * @returns {string} Color code
   * @private
   */
  getTypeColor(type) {
    const colors = {
      'CUSTOMER_SERVICE': '#3498db',
      'RISK_COMPLIANCE': '#e74c3c',
      'FINANCE_TREASURY': '#2ecc71',
      'IT_SECURITY': '#9b59b6',
      'HR_PEOPLE': '#f39c12'
    };
    return colors[type] || '#95a5a6';
  }

  /**
   * Get icon for suggestion type
   * @param {string} type - Suggestion type
   * @returns {string} Icon emoji
   * @private
   */
  getTypeIcon(type) {
    const icons = {
      'CUSTOMER_SERVICE': '🎧',
      'RISK_COMPLIANCE': '⚖️',
      'FINANCE_TREASURY': '💰',
      'IT_SECURITY': '🔒',
      'HR_PEOPLE': '👥'
    };
    return icons[type] || '❓';
  }
}

// Export singleton instance
const historyService = new HistoryService();

module.exports = { HistoryService, historyService };
