/**
 * Suggestions History Page
 * Handles display and management of user's suggestion history with infinite scroll
 */

const { CommunicationService } = require('../services/communicationService.js');
const { historyService } = require('../services/historyService.js');
const { ErrorHandler, InputValidator } = require('../utils/securityUtils.js');
const { configLoader } = require('../utils/configLoader.js');

/**
 * HistoryManager class for handling history page functionality
 */
class HistoryManager {
  constructor() {
    this.communication = new CommunicationService();
    this.credentials = null;
    this.profile = null;
    this.currentPage = 1;
    this.hasMorePages = true;
    this.isLoading = false;
    this.currentSuggestionId = null;
    this.suggestions = [];


    this.init();
  }

  /**
   * Initialize the history manager
   */
  async init() {
    try {
      this.setupEventListeners();
      // Load configuration first
      await configLoader.loadConfig();
      await this.loadCredentials();
      await this.loadProfile();
      await this.loadHistory();
      this.setupInfiniteScroll();
      this.hideLoading();
      this.showMainContent();
    } catch (error) {
      ErrorHandler.logError(error, { context: 'HistoryManager.init' });
      this.showError('Failed to load suggestions history');
    }
  }

  /**
   * Setup event listeners
   */
  setupEventListeners() {
    // Close page button
    const closePageButton = document.getElementById('close-page-button');
    if (closePageButton) {
      closePageButton.addEventListener('click', () => {
        window.close();
      });
    }



    // Load more functionality
    const loadMoreButton = document.getElementById('load-more-button');
    if (loadMoreButton) {
      loadMoreButton.addEventListener('click', () => {
        this.loadMoreHistory();
      });
    }

    // Modal functionality
    const modalCloseButton = document.getElementById('modal-close-button');

    if (modalCloseButton) {
      modalCloseButton.addEventListener('click', () => {
        this.hideModal();
      });
    }


    // Error handling
    const retryButton = document.getElementById('retry-button');
    const closeErrorButton = document.getElementById('close-error-button');

    if (retryButton) {
      retryButton.addEventListener('click', () => {
        this.hideError();
        this.showLoading();
        this.init();
      });
    }

    if (closeErrorButton) {
      closeErrorButton.addEventListener('click', () => {
        this.hideError();
        window.close();
      });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideModal();
        this.hideDialog();
        this.hideError();
      }
    });

    // Click outside modal to close
    const modalOverlay = document.getElementById('suggestion-modal');
    if (modalOverlay) {
      modalOverlay.addEventListener('click', (e) => {
        if (e.target === modalOverlay) {
          this.hideModal();
        }
      });
    }
  }

  /**
   * Load credentials from extension
   */
  async loadCredentials() {
    this.credentials = await this.communication.getCredentials();
    if (!this.credentials) {
      throw new Error('User not authenticated');
    }
  }

  /**
   * Load profile data from extension
   */
  async loadProfile() {
    this.profile = await this.communication.getProfile();
    if (!this.profile) {
      throw new Error('Failed to load profile data');
    }

    console.log('Profile loaded:', this.profile);
    console.log('Profile keys:', Object.keys(this.profile));

    // Validate that profile has required fields for history API
    // Look for the required fields with potential different naming
    const teamId = this.profile.default_team_id || this.profile.team_id || this.profile.teamId;
    const suggestionGroupId = this.profile.default_suggestion_group_id || this.profile.suggestions_group_id || this.profile.suggestionGroupId;

    if (!teamId || !suggestionGroupId) {
      console.error('Profile structure:', {
        hasDefaultTeamId: !!this.profile.default_team_id,
        hasDefaultSuggestionsGroupId: !!this.profile.default_suggestion_group_id,
        hasTeamId: !!this.profile.team_id,
        hasSuggestionsGroupId: !!this.profile.suggestions_group_id,
        availableKeys: Object.keys(this.profile),
        profile: this.profile
      });

      // For development, create mock IDs if missing
      if (!teamId) {
        console.warn('No team ID found, using default for development');
        this.profile.default_team_id = 'default-team';
      } else {
        this.profile.default_team_id = teamId;
      }

      if (!suggestionGroupId) {
        console.warn('No suggestion group ID found, using default for development');
        this.profile.default_suggestion_group_id = 'default-group';
      } else {
        this.profile.default_suggestion_group_id = suggestionGroupId;
      }
    } else {
      // Normalize the field names
      this.profile.default_team_id = teamId;
      this.profile.default_suggestion_group_id = suggestionGroupId;
    }
  }


  /**
   * Load history with current filters
   */
  async loadHistory(reset = true) {
    try {
      if (reset) {
        this.currentPage = 1;
        this.suggestions = [];
        this.hasMorePages = true;
      }

      if (!this.hasMorePages || this.isLoading) {
        return;
      }

      this.isLoading = true;
      this.showInfiniteLoading();

      const options = {
        page: this.currentPage,
        limit: 20
      };

      // Use regular history API only
      const response = await historyService.getSuggestionsHistory(this.credentials, this.profile, options);

      if (reset) {
        this.suggestions = response.items;
      } else {
        this.suggestions.push(...response.items);
      }

      this.hasMorePages = response.pagination.hasNext;
      this.currentPage++;

      this.renderHistory();
      this.updateLoadMoreButton();

    } catch (error) {
      ErrorHandler.logError(error, { context: 'HistoryManager.loadHistory' });
      this.showErrorToast('Failed to load history');
    } finally {
      this.isLoading = false;
      this.hideInfiniteLoading();
    }
  }

  /**
   * Load more history items
   */
  async loadMoreHistory() {
    await this.loadHistory(false);
  }

  /**
   * Render history items
   */
  renderHistory() {
    const historyList = document.getElementById('history-list');
    const emptyState = document.getElementById('empty-state');

    if (!historyList) return;

    if (this.suggestions.length === 0) {
      historyList.innerHTML = '';
      if (emptyState) {
        const message = document.getElementById('empty-message');
        if (message) {
          message.textContent = 'Your suggestion history will appear here once you start using PromptShields.';
        }
        emptyState.classList.remove('hidden');
        emptyState.classList.add('flex-visible');
      }
      return;
    }

    if (emptyState) {
      emptyState.classList.add('hidden');
      emptyState.classList.remove('flex-visible');
    }

    historyList.innerHTML = this.suggestions.map(suggestion =>
      this.renderSuggestionItem(suggestion)
    ).join('');

    // Add click listeners to suggestion items
    historyList.querySelectorAll('.suggestion-item').forEach((item, index) => {
      item.addEventListener('click', () => {
        this.showSuggestionDetail(this.suggestions[index]);
      });
    });
  }

  /**
   * Render individual suggestion item
   */
  renderSuggestionItem(suggestion) {
    const typeDisplay = historyService.getSuggestionTypeDisplay(suggestion.suggestion_type);
    const timestamp = historyService.formatTimestamp(suggestion.timestamp);

    return `
      <div class="suggestion-item" data-id="${suggestion.id}">
        <div class="suggestion-header">
          <span class="suggestion-type-badge ${suggestion.suggestion_type}">
            ${typeDisplay.icon} ${typeDisplay.label}
          </span>
          <span class="suggestion-timestamp">${timestamp}</span>
        </div>
        <div class="suggestion-content">
          <div class="text-section original">
            <div class="text-label">Original</div>
            <div class="text-content original-text">${InputValidator.sanitizeHtml(this.truncateText(suggestion.original_text, 150))}</div>
          </div>
          <div class="text-section suggested">
            <div class="text-label">Suggestion</div>
            <div class="text-content suggested-text">${InputValidator.sanitizeHtml(this.truncateText(suggestion.suggested_text, 150))}</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Truncate text for display
   */
  truncateText(text, maxLength) {
    if (!text || text.length <= maxLength) {
      return text;
    }
    return `${text.substring(0, maxLength)}...`;
  }

  /**
   * Show suggestion detail modal
   */
  showSuggestionDetail(suggestion) {
    this.currentSuggestionId = suggestion.id;

    const modal = document.getElementById('suggestion-modal');
    const elements = {
      originalText: document.getElementById('modal-original-text'),
      suggestedText: document.getElementById('modal-suggested-text'),
      suggestionType: document.getElementById('modal-suggestion-type'),
      timestamp: document.getElementById('modal-timestamp')
    };

    if (elements.originalText) {
      elements.originalText.textContent = suggestion.original_text;
    }

    if (elements.suggestedText) {
      elements.suggestedText.textContent = suggestion.suggested_text;
    }

    if (elements.suggestionType) {
      const typeDisplay = historyService.getSuggestionTypeDisplay(suggestion.suggestion_type);
      elements.suggestionType.textContent = typeDisplay.label;
      elements.suggestionType.className = `suggestion-type-badge ${suggestion.suggestion_type}`;
      // Color will be handled by CSS classes instead of inline styles
      // elements.suggestionType.style.color = typeDisplay.color;
    }

    if (elements.timestamp) {
      elements.timestamp.textContent = new Date(suggestion.timestamp).toLocaleString();
    }

    if (elements.confidence) {
      const confidence = Math.round(suggestion.confidence_score * 100);
      elements.confidence.textContent = `${confidence}%`;
    }

    if (modal) {
      modal.classList.remove('hidden');
      modal.classList.add('flex-visible');
    }
  }

  /**
   * Hide suggestion detail modal
   */
  hideModal() {
    const modal = document.getElementById('suggestion-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.classList.remove('flex-visible');
    }
    this.currentSuggestionId = null;
  }








  /**
   * Setup infinite scroll
   */
  setupInfiniteScroll() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && this.hasMorePages && !this.isLoading) {
          this.loadMoreHistory();
        }
      });
    }, {
      rootMargin: '100px'
    });

    const loadMoreContainer = document.getElementById('load-more-container');
    if (loadMoreContainer) {
      observer.observe(loadMoreContainer);
    }
  }

  /**
   * Update load more button visibility
   */
  updateLoadMoreButton() {
    const loadMoreContainer = document.getElementById('load-more-container');
    if (loadMoreContainer) {
      if (this.hasMorePages) {
        loadMoreContainer.classList.remove('hidden');
        loadMoreContainer.classList.add('visible');
      } else {
        loadMoreContainer.classList.add('hidden');
        loadMoreContainer.classList.remove('visible');
      }
    }
  }







  /**
   * Show loading overlay
   */
  showLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.classList.remove('hidden');
      loadingOverlay.classList.add('flex-visible');
    }
  }

  /**
   * Hide loading overlay
   */
  hideLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
      loadingOverlay.classList.remove('flex-visible');
    }
  }

  /**
   * Show infinite scroll loading
   */
  showInfiniteLoading() {
    const infiniteLoading = document.getElementById('infinite-loading');
    if (infiniteLoading) {
      infiniteLoading.classList.remove('hidden');
      infiniteLoading.classList.add('flex-visible');
    }
  }

  /**
   * Hide infinite scroll loading
   */
  hideInfiniteLoading() {
    const infiniteLoading = document.getElementById('infinite-loading');
    if (infiniteLoading) {
      infiniteLoading.classList.add('hidden');
      infiniteLoading.classList.remove('flex-visible');
    }
  }

  /**
   * Show main content
   */
  showMainContent() {
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.classList.remove('hidden');
      mainContent.classList.add('visible');
    }
  }

  /**
   * Show error overlay
   */
  showError(message) {
    const errorOverlay = document.getElementById('error-overlay');
    const errorMessage = document.getElementById('error-message');

    if (errorOverlay && errorMessage) {
      errorMessage.textContent = message;
      errorOverlay.classList.remove('hidden');
      errorOverlay.classList.add('flex-visible');
    }
  }

  /**
   * Hide error overlay
   */
  hideError() {
    const errorOverlay = document.getElementById('error-overlay');
    if (errorOverlay) {
      errorOverlay.classList.add('hidden');
      errorOverlay.classList.remove('flex-visible');
    }
  }

  /**
   * Show success toast
   */
  showSuccessToast(message) {
    this.showToast('success', message);
  }

  /**
   * Show error toast
   */
  showErrorToast(message) {
    this.showToast('error', message);
  }

  /**
   * Show toast notification
   */
  showToast(type, message) {
    const toastId = type === 'success' ? 'success-toast' : 'error-toast';
    const messageId = type === 'success' ? 'success-message' : 'toast-error-message';

    const toast = document.getElementById(toastId);
    const messageElement = document.getElementById(messageId);

    if (toast && messageElement) {
      messageElement.textContent = message;
      toast.classList.remove('hidden');
      toast.classList.add('visible', 'show');

      // Auto-hide after 5 seconds
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          toast.classList.add('hidden');
          toast.classList.remove('visible', 'show');
        }, 300);
      }, 5000);
    }
  }
}

// Initialize history manager when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new HistoryManager();
  });
} else {
  new HistoryManager();
}
