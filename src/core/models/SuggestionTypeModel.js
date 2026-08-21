/**
 * SuggestionType Model and Request/Response types
 * Represents a user-customizable suggestion type
 * Suggestion types define how user text is processed by the LLM
 * The promptTemplate field contains instructions that wrap around the user's text
 * using {{TEXT}} as a placeholder for where the user's selected text will be injected
 */

/**
 * Text placeholder used in prompt templates
 */
export const TEXT_PLACEHOLDER = '{{TEXT}}';

/**
 * Category order for display
 */
export const CATEGORY_ORDER = [
  'Writing Clarity',
  'Structure & Adaptation',
  'Security & Compliance',
  'Custom'
];

/**
 * Common icons for suggestion types
 */
export const COMMON_ICONS = [
  '💡', '✂️', '📝', '🔤', '🌍', '👤', '🔗', '⚡',
  '📄', '🧹', '🛡️', '⚠️', '✅', '✨', '🎯', '🔧', '📊', '🎨'
];

/**
 * Get category display name with emoji
 * @param {string} category - Category name
 * @returns {string} Display name with emoji
 */
export function getCategoryDisplayName(category) {
  const categoryEmojis = {
    'Writing Clarity': '🚀 Writing Clarity',
    'Structure & Adaptation': '⚙️ Structure & Adaptation',
    'Security & Compliance': '🔒 Security & Compliance',
    'Custom': '✨ Custom'
  };
  return categoryEmojis[category] || category;
}

/**
 * Get sort order for a category
 * @param {string} category - Category name
 * @returns {number} Sort order index
 */
export function getCategorySortOrder(category) {
  const index = CATEGORY_ORDER.indexOf(category);
  return index >= 0 ? index : Number.MAX_SAFE_INTEGER;
}

/**
 * SuggestionType model class
 */
export class SuggestionTypeModel {
  constructor(data = {}) {
    this.id = data.id || this.generateId();
    this.typeKey = data.type_key || data.typeKey || '';
    this.name = data.name || '';
    this.description = data.description || '';
    this.category = data.category || 'Custom';
    this.promptTemplate = data.prompt_template || data.promptTemplate || '';
    this.suggestionTypeGroupId = data.suggestion_type_group_id || data.suggestionTypeGroupId || '';
    this.icon = data.icon || '✨';
    this.isDefault = data.is_default !== undefined ? data.is_default : (data.isDefault || false);
    this.isEnabled = data.is_enabled !== undefined ? data.is_enabled : (data.isEnabled !== undefined ? data.isEnabled : true);
    this.sortOrder = data.sort_order !== undefined ? data.sort_order : (data.sortOrder || 0);
    this.createdAt = data.created_at || data.createdAt || null;
    this.updatedAt = data.updated_at || data.updatedAt || null;
  }

  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Display name with icon
   */
  get displayName() {
    return `${this.icon} ${this.name}`;
  }

  /**
   * Whether this type can be edited by the user
   */
  get isEditable() {
    return true;
  }

  /**
   * Convert to API request format for creating
   */
  toCreateRequest() {
    return {
      type_key: this.typeKey.toUpperCase().replace(/\s+/g, '_'),
      name: this.name,
      description: this.description,
      category: this.category,
      prompt_template: this.promptTemplate,
      suggestion_type_group_id: this.suggestionTypeGroupId,
      icon: this.icon,
      is_enabled: this.isEnabled,
      sort_order: this.sortOrder
    };
  }

  /**
   * Convert to API request format for updating
   */
  toUpdateRequest() {
    return {
      name: this.name,
      description: this.description,
      category: this.category,
      prompt_template: this.promptTemplate,
      icon: this.icon,
      is_enabled: this.isEnabled,
      sort_order: this.sortOrder
    };
  }

  /**
   * Convert to JSON for storage
   */
  toJSON() {
    return {
      id: this.id,
      type_key: this.typeKey,
      name: this.name,
      description: this.description,
      category: this.category,
      prompt_template: this.promptTemplate,
      suggestion_type_group_id: this.suggestionTypeGroupId,
      icon: this.icon,
      is_default: this.isDefault,
      is_enabled: this.isEnabled,
      sort_order: this.sortOrder,
      created_at: this.createdAt,
      updated_at: this.updatedAt
    };
  }

  /**
   * Create from API response
   * @param {Object} apiResponse - API response data
   * @returns {SuggestionTypeModel}
   */
  static fromApiResponse(apiResponse) {
    return new SuggestionTypeModel(apiResponse);
  }

  /**
   * Create from storage data
   * @param {Object} storageData - Storage data
   * @returns {SuggestionTypeModel}
   */
  static fromStorage(storageData) {
    return new SuggestionTypeModel(storageData);
  }
}

/**
 * Group suggestion types by category
 * @param {SuggestionTypeModel[]} suggestionTypes - Array of suggestion types
 * @returns {Object} Object with categories as keys and arrays of types as values
 */
export function groupSuggestionTypesByCategory(suggestionTypes) {
  const grouped = {};
  
  suggestionTypes.forEach(type => {
    const category = type.category || 'Custom';
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(type);
  });

  // Sort each category's types by sortOrder
  Object.keys(grouped).forEach(category => {
    grouped[category].sort((a, b) => a.sortOrder - b.sortOrder);
  });

  return grouped;
}

/**
 * Get sorted categories
 * @param {Object} groupedTypes - Grouped suggestion types
 * @returns {string[]} Sorted category names
 */
export function getSortedCategories(groupedTypes) {
  return Object.keys(groupedTypes).sort((a, b) => {
    return getCategorySortOrder(a) - getCategorySortOrder(b);
  });
}

/**
 * Validate a suggestion type
 * @param {SuggestionTypeModel} type - Suggestion type to validate
 * @returns {Object} Validation result with isValid and errors
 */
export function validateSuggestionType(type) {
  const errors = [];

  if (!type.name || !type.name.trim()) {
    errors.push('Name is required');
  }

  if (!type.promptTemplate || !type.promptTemplate.trim()) {
    errors.push('Prompt template is required');
  }

  if (type.promptTemplate && type.promptTemplate.length > 5000) {
    errors.push('Prompt template must be 5000 characters or less');
  }

  if (!type.typeKey && !type.id) {
    errors.push('Type key is required for new types');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}
