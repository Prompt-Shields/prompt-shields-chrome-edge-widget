import { CommunicationService } from './services/communicationService.js';
import { MessageTypes } from './config/messageTypes.js';

// Debug logging to verify content script is loading
console.log('PromptShields content script loading...', new Date().toISOString());
console.log('DOM Highlighting feature will be available after initialization');

/**
 * Check if extension context is still valid
 * @returns {boolean} True if context is valid
 */
function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (error) {
    return false;
  }
}

/**
 * Safe wrapper for chrome.runtime calls that handles context invalidation
 * @param {Function} chromeApiCall - Function that makes the chrome API call
 * @param {Function} fallback - Optional fallback function if context is invalid
 * @returns {Promise} Promise that resolves with the API result or fallback
 */
async function safeExtensionCall(chromeApiCall, fallback = () => null) {
  if (!isExtensionContextValid()) {
    console.warn('Extension context invalidated, skipping API call');
    return fallback();
  }

  try {
    return await chromeApiCall();
  } catch (error) {
    if (error.message.includes('Extension context invalidated')) {
      console.warn('Extension context invalidated during API call');
      return fallback();
    }
    throw error;
  }
}

/**
 * Inject CSS styles for PromptShields
 */
function injectPromptShieldsCSS() {
  if (document.getElementById('promptshields-styles')) {
    return; // Already injected
  }

  const style = document.createElement('style');
  style.id = 'promptshields-styles';
  style.textContent = `
    .ps-highlight {
      position: absolute;
      border: 1px solid #FFFFFF;
      background: rgba(255, 255, 255, 0.3);
      backdrop-filter: blur(8px);
      border-radius: 10px;
      z-index: 2147483647;
      pointer-events: none;
      transition: all 0.2s ease;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    }
    .ps-status {
      position: fixed;
      top: 10px;
      right: 10px;
      background: rgba(0, 0, 0, 0.7);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 2147483647;
      pointer-events: none;
      backdrop-filter: blur(4px);
    }
    .ps-invisible-layer {
      position: absolute;
      background: transparent;
      z-index: 2147483646;
      pointer-events: auto;
    }
  `;
  document.head.appendChild(style);
}

/**
 * DOM Highlighter class for highlighting DOM elements on hover
 * Similar to Chrome's inspect functionality
 */
class DOMHighlighter {
  constructor() {
    // Inject CSS styles first
    injectPromptShieldsCSS();

    this.highlightElement = null;
    this.buttonElement = null;
    this.invisibleLayerElement = null;
    this.currentTarget = null;
    this.activeTextContainer = null;
    this.lastButtonPosition = null;
    this.isEnabled = true; // Enable by default

    // Button state management
    this.buttonState = 'idle'; // 'idle', 'loading', 'options', 'suggested_text'
    this.suggestionTypes = [];
    this.suggestedTextData = null; // Store the API response data
    this.isUserAuthenticated = false;

    this.init();
  }

  /**
   * Initialize the highlighter
   */
  init() {
    this.createHighlightElement();
    this.createButtonElement();
    this.createInvisibleLayer();
    this.setupEventListeners();
    this.createStatusIndicator();

    // Check authentication status on initialization
    this.checkAuthenticationStatus();
  }

  /**
   * Create the highlight overlay element
   */
  createHighlightElement() {
    this.highlightElement = document.createElement('div');
    this.highlightElement.id = 'prompt-shields-highlight';
    this.highlightElement.style.cssText = `
      position: absolute;
      border: 1px solid #FFFFFF;
      background-color: rgba(66, 133, 244, 0);
      pointer-events: none;
      z-index: 2147483647;
      border-radius: 8px;
      box-shadow: 0 0 0 1px rgba(66, 133, 244, 0.3);
      transition: all 0.15s ease-out;
    `;
    document.body.appendChild(this.highlightElement);

  }



  /**
   * Create a status indicator to show highlighting is active
   */
  createStatusIndicator() {
    const indicator = document.createElement('div');
    indicator.id = 'prompt-shields-status';
    indicator.style.cssText = `
      position: fixed;
      top: 10px;
      right: 10px;
      background: #FFFFFF;
      color: black;
      padding: 5px 10px;
      border-radius: 4px;
      font-size: 12px;
      font-family: monospace;
      z-index: 2147483646;
      pointer-events: none;
      opacity: 0.8;
    `;
    indicator.textContent = 'DOM Highlighting: ON';
    document.body.appendChild(indicator);

    // Update indicator when highlighting is toggled
    this.statusIndicator = indicator;
  }

  /**
   * Create the action button element with state management
   */
  createButtonElement() {
    this.buttonElement = document.createElement('div');
    this.buttonElement.id = 'prompt-shields-action-button';
    this.buttonElement.style.cssText = `
      position: absolute;
      z-index: 2147483648;
      pointer-events: auto;
    `;

    // Initialize with idle state
    this.updateButtonState('idle');

    // Add click handler
    this.buttonElement.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.handleButtonClick(e);
    });

    document.body.appendChild(this.buttonElement);
  }

  /**
   * Update button appearance based on current state and authentication
   * @param {string} state - 'idle', 'loading', 'options', 'suggested_text'
   */
  updateButtonState(state) {
    // Skip if extension context is invalid
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalid, cleaning up highlighter');
      this.cleanup();
      return;
    }

    this.buttonState = state;

    const baseStyle = `
      background: #FFFFFF;
      color: black;
      border-radius: 4px;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
      transition: all 0.15s ease-out;
      user-select: none;
      white-space: nowrap;
      border: 1px solid rgba(255, 255, 255, 0);
      padding: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    const loggedOutStyle = `
      background: #f5f5f5;
      color: #999;
      border-radius: 4px;
      font-size: 11px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-weight: 500;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      transition: all 0.15s ease-out;
      user-select: none;
      white-space: nowrap;
      border: 1px solid #ddd;
      padding: 6px 12px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // If user is not authenticated, show login prompt
    if (!this.isUserAuthenticated) {
      this.buttonElement.innerHTML = `
        <div style="${loggedOutStyle}" title="Please log in to use PromptShields features">
          Log In
        </div>
      `;
      this.addLoggedOutHoverEffects();
      return;
    }

    // If authenticated, show normal states
    switch (state) {
    case 'idle':
      this.buttonElement.innerHTML = `
        <div style="${baseStyle}">
          <img src="${isExtensionContextValid() ? chrome.runtime.getURL('images/analyze.png') : 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMzAiIGhlaWdodD0iMzAiIHZpZXdCb3g9IjAgMCAzMCAzMCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHJlY3Qgd2lkdGg9IjMwIiBoZWlnaHQ9IjMwIiByeD0iNCIgZmlsbD0iIzMzNjdkNiIvPgo8dGV4dCB4PSIxNSIgeT0iMjAiIGZvbnQtZmFtaWx5PSJzeXN0ZW0tdWkiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IndoaXRlIiB0ZXh0LWFuY2hvcj0ibWlkZGxlIj5QUzwvdGV4dD4KPHN2Zz4='}" alt="Analyze" style="width: 30px; height: 30px" />
        </div>
      `;
      this.addHoverEffects();
      break;

    case 'loading':
      this.buttonElement.innerHTML = `
        <div style="${baseStyle}">
          <div class="spinner" style="
            width: 20px;
            height: 20px;
            border: 2px solid #f3f3f3;
            border-top: 2px solid #3498db;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          "></div>
        </div>
      `;
      this.addSpinnerAnimation();
      break;

    case 'options':
      this.renderOptionsMenu();
      break;

    case 'suggested_text':
      this.renderSuggestedTextMenu();
      break;
    }
  }

  /**
   * Add hover effects to the button
   */
  addHoverEffects() {
    const innerDiv = this.buttonElement.querySelector('div');
    if (!innerDiv) return;

    const mouseEnterHandler = () => {
      if (this.buttonState === 'idle') {
        innerDiv.style.background = '#3367d6';
        innerDiv.style.transform = 'translateY(-1px)';
        innerDiv.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.2)';
      }
    };

    const mouseLeaveHandler = () => {
      if (this.buttonState === 'idle') {
        innerDiv.style.background = '#FFFFFF';
        innerDiv.style.transform = 'translateY(0)';
        innerDiv.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.15)';
      }
    };

    this.buttonElement.addEventListener('mouseenter', mouseEnterHandler);
    this.buttonElement.addEventListener('mouseleave', mouseLeaveHandler);
  }

  /**
   * Add hover effects to the logged out button
   */
  addLoggedOutHoverEffects() {
    const innerDiv = this.buttonElement.querySelector('div');
    if (!innerDiv) return;

    const mouseEnterHandler = () => {
      innerDiv.style.background = '#e8e8e8';
      innerDiv.style.transform = 'translateY(-1px)';
      innerDiv.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.15)';
    };

    const mouseLeaveHandler = () => {
      innerDiv.style.background = '#f5f5f5';
      innerDiv.style.transform = 'translateY(0)';
      innerDiv.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.1)';
    };

    this.buttonElement.addEventListener('mouseenter', mouseEnterHandler);
    this.buttonElement.addEventListener('mouseleave', mouseLeaveHandler);
  }

  /**
   * Add CSS animation for spinner
   */
  addSpinnerAnimation() {
    // Check if animation is already added
    if (!document.getElementById('prompt-shields-spinner-style')) {
      const style = document.createElement('style');
      style.id = 'prompt-shields-spinner-style';
      style.textContent = `
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `;
      document.head.appendChild(style);
    }
  }

  /**
   * Render the options menu with suggestion types
   */
  renderOptionsMenu() {
    const menuStyle = `
      background: #FFFFFF;
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      border: 1px solid #e0e0e0;
      font-size: 12px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      overflow: hidden;
      min-width: 120px;
    `;

    let optionsHTML = `<div style="${menuStyle}">`;

    const types = (this.suggestionTypes || []);

    if (types.length === 0) {
      optionsHTML += `
        <div style="padding: 8px 12px; color: #666;">
          No options available
        </div>
      `;
    } else {
      optionsHTML += `
        <div style="
          display:flex;
          align-items:center;
          gap:8px;
          padding: 8px 12px;
          border-bottom: 1px solid #e0e0e0;
          background: #f9fafb;
          color:#333;
          font-weight:600;
        ">
        Suggestion types
        </div>
      `;

      types.forEach((item, index) => {
        optionsHTML += `
          <div class="suggestion-option" data-type="${item.type}" data-index="${index}" style="
            padding: 8px 12px;
            cursor: pointer;
            border-bottom: none;
            transition: background-color 0.15s ease;
            background-color: #ffffff;
            color: #333333;
            border-radius: 4px;
            margin-bottom: 4px;
          ">
            ${item.name}
          </div>
        `;
      });
    }

    // Add close button
    optionsHTML += `
      <div class="close-options" style="
        padding: 6px 12px;
        cursor: pointer;
        background: #f8f9fa;
        color: #666;
        text-align: center;
        border-top: 1px solid #e0e0e0;
        font-size: 11px;
      ">
        Close
      </div>
    `;

    optionsHTML += '</div>';

    this.buttonElement.innerHTML = optionsHTML;

    // Add event listeners for options
    this.addOptionsEventListeners();
  }

  /**
   * Render the suggested text preview menu
   */
  renderSuggestedTextMenu() {
    if (!this.suggestedTextData) {
      console.error('No suggested text data available');
      this.updateButtonState('idle');
      return;
    }

    const baseStyle = `
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
      width: 540px;
      background: #f8f9fa;
      border: none;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      overflow: visible;
      position: relative;
    `;

    this.buttonElement.innerHTML = `
      <div style="${baseStyle}">
        <div style="
          padding: 12px;
          color: #333;
          text-align: center;
          width: 100%;
          box-sizing: border-box;
        ">
          <div style="
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 8px;
            opacity: 0.9;
          ">Suggested Text:</div>
          <div style="
            font-size: 13px;
            line-height: 1.4;
            background: #e9ecef;
            padding: 8px;
            border-radius: 4px;
            width: 500px;
            word-wrap: break-word;
            overflow-wrap: break-word;
            word-break: break-word;
            white-space: pre-wrap;
            hyphens: auto;
            margin-bottom: 12px;
            color: #495057;
            box-sizing: border-box;
          ">${this.suggestedTextData.suggested_text}</div>
          <div style="
            display: flex;
            gap: 8px;
            justify-content: center;
            width: 100%;
          ">
            <button class="agree-update-btn" style="
              background: #4CAF50;
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 4px;
              font-size: 11px;
              font-weight: 600;
              cursor: pointer;
              transition: background-color 0.15s ease;
            ">Agree & Update</button>
            <button class="keep-original-btn" style="
              background: #f44336;
              color: white;
              border: none;
              padding: 6px 12px;
              border-radius: 4px;
              font-size: 11px;
              font-weight: 600;
              cursor: pointer;
              transition: background-color 0.15s ease;
            ">Keep Original</button>
          </div>
        </div>
      </div>
    `;

    this.addSuggestedTextEventListeners();
  }

  /**
   * Add event listeners for the suggested text menu
   */
  addSuggestedTextEventListeners() {
    // Agree & Update button
    const agreeBtn = this.buttonElement.querySelector('.agree-update-btn');
    if (agreeBtn) {
      agreeBtn.addEventListener('mouseenter', () => {
        agreeBtn.style.backgroundColor = '#45a049';
      });
      agreeBtn.addEventListener('mouseleave', () => {
        agreeBtn.style.backgroundColor = '#4CAF50';
      });
      agreeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleAgreeAndUpdate();
      });
    }

    // Keep Original button
    const keepBtn = this.buttonElement.querySelector('.keep-original-btn');
    if (keepBtn) {
      keepBtn.addEventListener('mouseenter', () => {
        keepBtn.style.backgroundColor = '#da190b';
      });
      keepBtn.addEventListener('mouseleave', () => {
        keepBtn.style.backgroundColor = '#f44336';
      });
      keepBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.handleKeepOriginal();
      });
    }
  }

  /**
   * Handle Agree & Update button click
   */
  handleAgreeAndUpdate() {
    if (this.suggestedTextData && this.suggestedTextData.suggested_text) {
      this.replaceHighlightedText(this.suggestedTextData.suggested_text);
      console.log('Text updated with suggestion');
    }
    this.suggestedTextData = null;
    this.updateButtonState('idle');
  }

  /**
   * Handle Keep Original button click
   */
  handleKeepOriginal() {
    console.log('User chose to keep original text');
    this.suggestedTextData = null;
    this.hideHighlight();
  }

  /**
   * Add event listeners for the options menu
   */
  addOptionsEventListeners() {
    // Option hover effects
    const options = this.buttonElement.querySelectorAll('.suggestion-option');
    options.forEach(option => {
      option.addEventListener('mouseenter', () => {
        option.style.backgroundColor = '#f5f5f5';
      });

      option.addEventListener('mouseleave', () => {
        option.style.backgroundColor = 'transparent';
      });

      option.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(option.getAttribute('data-index'));
        const filtered = (this.suggestionTypes || []);
        this.handleOptionSelect(filtered[index]);
      });
    });

    // Close button
    const closeButton = this.buttonElement.querySelector('.close-options');
    if (closeButton) {
      closeButton.addEventListener('mouseenter', () => {
        closeButton.style.backgroundColor = '#e9ecef';
      });

      closeButton.addEventListener('mouseleave', () => {
        closeButton.style.backgroundColor = '#f8f9fa';
      });

      closeButton.addEventListener('click', (e) => {
        e.stopPropagation();
        this.updateButtonState('idle');
      });
    }
  }

  /**
   * Handle button clicks based on current state and authentication
   */
  async handleButtonClick(_event) {
    // Skip if highlighter is disabled
    if (!this.isEnabled) {
      return;
    }

    // Skip if extension context is invalid
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalid, cleaning up and hiding button');
      this.cleanup();
      return;
    }

    // If user is not authenticated, redirect to login
    if (!this.isUserAuthenticated) {
      await this.handleLoginClick();
      return;
    }

    // If authenticated, handle normal button states
    if (this.buttonState === 'idle') {
      this.fetchSuggestionTypes();
    } else if (this.buttonState === 'loading') {
      // Do nothing while loading
      return;
    } else if (this.buttonState === 'suggested_text') {
      // Click on suggested text menu - do nothing to allow button selection
      return;
    }
  }

  /**
   * Handle login button click
   */
  async handleLoginClick() {
    // Skip if extension context is invalid
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalid, showing login instructions instead');
      this.showLoginInstructions();
      return;
    }

    // Try to open the extension popup programmatically using safe wrapper
    await safeExtensionCall(
      () => new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'openPopup' }, (response) => {
          if (chrome.runtime.lastError) {
            console.warn('Could not open popup programmatically:', chrome.runtime.lastError.message);
            // Fallback: show user how to access the popup
            this.showLoginInstructions();
          }
          resolve(response);
        });
      }),
      () => {
        // Fallback when extension context is invalid
        this.showLoginInstructions();
      }
    );
  }

  /**
   * Clean up the highlighter when extension context becomes invalid
   */
  cleanup() {
    // Prevent multiple cleanup calls
    if (this.isEnabled === false) {
      return;
    }

    console.log('Cleaning up DOM highlighter due to invalid extension context');

    // Mark as disabled first to prevent further operations
    this.isEnabled = false;

    // Hide and remove all UI elements
    this.hideHighlight();

    if (this.buttonElement && this.buttonElement.parentNode) {
      this.buttonElement.parentNode.removeChild(this.buttonElement);
      this.buttonElement = null;
    }

    if (this.invisibleLayerElement && this.invisibleLayerElement.parentNode) {
      this.invisibleLayerElement.parentNode.removeChild(this.invisibleLayerElement);
      this.invisibleLayerElement = null;
    }

    // Clear references
    this.currentTarget = null;
    this.activeTextContainer = null;
    this.lastButtonPosition = null;
    this.suggestedTextData = null;

    console.log('DOM highlighter cleanup completed');
  }

  /**
   * Show login instructions if popup can't be opened programmatically
   */
  showLoginInstructions() {
    // Create a temporary tooltip to guide the user
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: #333;
      color: white;
      padding: 12px 16px;
      border-radius: 4px;
      font-size: 14px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 2147483649;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      max-width: 300px;
    `;
    tooltip.textContent = 'Please click the PromptShields extension icon in your browser toolbar to log in.';

    document.body.appendChild(tooltip);

    // Remove tooltip after 5 seconds
    setTimeout(() => {
      if (tooltip.parentNode) {
        tooltip.parentNode.removeChild(tooltip);
      }
    }, 5000);
  }

  /**
   * Fetch suggestion types from API (custom suggestion types endpoint)
   */
  async fetchSuggestionTypes() {
    // Skip if highlighter is disabled
    if (!this.isEnabled) {
      return;
    }

    this.updateButtonState('loading');

    try {
      // Get credentials for authenticated API call
      const credentials = await this.getCredentials();
      if (!credentials || !credentials.accessToken) {
        console.warn('No valid credentials available for suggestion types fetch');
        this.updateButtonState('idle');
        return;
      }

      // Get profile to retrieve the suggestion type group ID
      const profile = await this.getProfile();
      if (!profile || !profile.default_suggestion_type_group_id) {
        console.warn('No valid profile data with suggestion type group ID available');
        this.updateButtonState('idle');
        return;
      }

      // Build the URL for custom suggestion types endpoint
      const suggestionTypeGroupId = profile.default_suggestion_type_group_id;
      const baseUrl = window.suggestionTypesBaseUrl || window.suggestionTypesByGroupUrl?.replace('{suggestionTypeGroupId}', suggestionTypeGroupId);
      const url = `${baseUrl}/${suggestionTypeGroupId}`;

      const fetchOptions = {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Accept': 'application/json'
        }
      };

      const response = await fetch(url, fetchOptions);

      if (!response.ok) {
        console.error('Suggestion types fetch failed:', response.status, response.statusText);
        this.updateButtonState('idle');
        return;
      }

      const data = await response.json();

      // Handle custom suggestion types API response format
      if (data.success && data.content) {
        // Filter to only enabled suggestion types for the button menu
        const allTypes = Array.isArray(data.content) ? data.content : (data.content.items || []);
        this.suggestionTypes = allTypes.filter(type => type.is_enabled !== false);
        this.updateButtonState('options');
      } else {
        console.warn('Suggestion types fetch returned unsuccessful response:', data);
        this.updateButtonState('idle');
      }
    } catch (error) {
      console.error('Error fetching suggestion types:', error);
      this.updateButtonState('idle');
    }
  }

  /**
   * Handle selection of a suggestion option
   */
  async handleOptionSelect(selectedOption) {
    // Skip if highlighter is disabled
    if (!this.isEnabled) {
      return;
    }

    // Set button to loading state
    this.updateButtonState('loading');

    try {
      // Get credentials and profile data
      const credentials = await this.getCredentials();
      if (!credentials || !credentials.accessToken) {
        console.warn('No valid credentials available for suggestion processing');
        this.updateButtonState('idle');
        return;
      }

      const profile = await this.getProfile();
      if (!profile || !profile.default_suggestion_group_id || !profile.default_team_id) {
        console.warn('No valid profile data available for suggestion processing');
        this.updateButtonState('idle');
        return;
      }

      // Get the currently highlighted text
      const highlightedText = this.getCurrentHighlightedText();
      if (!highlightedText) {
        console.warn('No highlighted text available for processing');
        this.updateButtonState('idle');
        return;
      }

      // Determine the browser application
      const application = this.getBrowserApplication();

      // Prepare the request payload
      const payload = {
        body: highlightedText,
        team_id: profile.default_team_id,
        suggestion_group_id: profile.default_suggestion_group_id,
        suggestion_type: selectedOption.type_key,
        application
      };

      console.log('Analyze request payload:', {
        ...payload,
        body: highlightedText.substring(0, 100) + (highlightedText.length > 100 ? '...' : '')
      });

      // Make the POST request to suggestion processing service

      const response = await fetch(window.suggestionProcessServiceUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${credentials.accessToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error('Suggestion processing failed:', response.status, response.statusText);
        this.updateButtonState('idle');
        return;
      }

      const result = await response.json();

      // Store the suggestion data and show preview
      if (result.content && result.content.suggested_text) {
        this.suggestedTextData = result.content;
        console.log('Suggestion received, showing preview:', result.content);
        this.updateButtonState('suggested_text');
      } else {
        console.warn('No suggested text received from the API');
        console.log('API response:', result);
        this.updateButtonState('idle');
      }

    } catch (error) {
      console.error('Error processing suggestion:', error);
      this.updateButtonState('idle');
    }
  }

  /**
   * Check authentication status and update button accordingly
   */
  async checkAuthenticationStatus() {
    // Skip if extension context is invalid
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalid, cleaning up highlighter');
      this.cleanup();
      return;
    }

    try {
      const credentials = await this.getCredentials();
      const wasAuthenticated = this.isUserAuthenticated;
      this.isUserAuthenticated = !!(credentials && credentials.accessToken);

      // Update button state if authentication status changed
      if (wasAuthenticated !== this.isUserAuthenticated) {
        this.updateButtonState(this.buttonState);
      }
    } catch (error) {
      console.warn('Failed to check authentication status:', error);
      this.isUserAuthenticated = false;
      if (isExtensionContextValid()) {
        this.updateButtonState(this.buttonState);
      }
    }
  }

  /**
   * Set authentication status and update button
   * @param {boolean} isAuthenticated - Whether user is authenticated
   */
  setAuthenticationStatus(isAuthenticated) {
    const wasAuthenticated = this.isUserAuthenticated;
    this.isUserAuthenticated = isAuthenticated;

    console.log('Authentication status updated:', this.isUserAuthenticated ? 'Logged in' : 'Logged out');

    // Update button state if authentication status changed
    if (wasAuthenticated !== this.isUserAuthenticated) {
      this.updateButtonState(this.buttonState);
    }
  }

  /**
   * Get credentials from background script
   */
  async getCredentials() {
    return safeExtensionCall(
      () => new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'getCredentials' }, (response) => {
          resolve(response?.credentials || null);
        });
      }),
      () => null
    );
  }

  /**
   * Get profile data from background script
   */
  async getProfile() {
    return safeExtensionCall(
      () => new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: 'getProfile' }, (response) => {
          resolve(response?.profile || null);
        });
      }),
      () => null
    );
  }

  /**
   * Get the currently highlighted text from the active text container
   */
  getCurrentHighlightedText() {
    console.log('Getting current highlighted text from:', {
      currentTarget: this.currentTarget,
      tagName: this.currentTarget?.tagName,
      contentEditable: this.currentTarget?.contentEditable
    });

    if (!this.currentTarget) {
      console.warn('No current target for getting highlighted text');
      return null;
    }

    let text = null;

    // Get text content from the target element
    if (this.currentTarget.tagName === 'INPUT' || this.currentTarget.tagName === 'TEXTAREA') {
      text = this.currentTarget.value;
      console.log('Got text from input/textarea:', { text: `${text.substring(0, 100)}...` });
    } else if (this.currentTarget.contentEditable === 'true') {
      text = this.currentTarget.textContent || this.currentTarget.innerText;
      console.log('Got text from contenteditable:', { text: `${text.substring(0, 100)}...` });
    } else {
      console.warn('Unknown element type for getting text:', this.currentTarget);
    }

    return text;
  }

  /**
   * Determine the browser application (chrome or edge)
   */
  getBrowserApplication() {
    // Check user agent or chrome API to determine browser
    const userAgent = navigator.userAgent.toLowerCase();

    if (userAgent.includes('edg/')) {
      return 'edge';
    } else if (userAgent.includes('chrome')) {
      return 'chrome';
    }

    // Fallback to chrome
    return 'chrome';
  }

  /**
   * Replace the highlighted text with the suggested text
   */
  replaceHighlightedText(suggestedText) {
    console.log('Attempting to replace text:', {
      suggestedText,
      currentTarget: this.currentTarget,
      targetType: this.currentTarget?.tagName,
      isContentEditable: this.currentTarget?.contentEditable
    });

    if (!this.currentTarget || !suggestedText) {
      console.warn('Cannot replace text: missing target or suggested text');
      return;
    }

    // Replace text in the target element
    if (this.currentTarget.tagName === 'INPUT' || this.currentTarget.tagName === 'TEXTAREA') {
      console.log('Replacing text in input/textarea element');
      const oldValue = this.currentTarget.value;
      this.currentTarget.value = suggestedText;
      console.log('Text replaced:', { oldValue, newValue: this.currentTarget.value });

      // Trigger multiple events to ensure compatibility
      this.currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
      this.currentTarget.dispatchEvent(new Event('change', { bubbles: true }));

    } else if (this.currentTarget.contentEditable === 'true') {
      console.log('Replacing text in contenteditable element');
      const oldText = this.currentTarget.textContent;
      this.currentTarget.textContent = suggestedText;
      console.log('Text replaced:', { oldText, newText: this.currentTarget.textContent });

      // Trigger events for contenteditable elements
      this.currentTarget.dispatchEvent(new Event('input', { bubbles: true }));
      this.currentTarget.dispatchEvent(new Event('DOMSubtreeModified', { bubbles: true }));

    } else {
      console.warn('Unknown element type for text replacement:', this.currentTarget);
    }

    // Give a small delay before hiding highlight to ensure text is updated
    setTimeout(() => {
      console.log('Hiding highlight after text replacement');
      this.hideHighlight();
    }, 100);
  }

  /**
   * Create an invisible layer that covers the highlight and button area
   * This prevents highlighting of other elements when moving mouse to the button
   * while still allowing clicks to pass through for text container focusing
   */
  createInvisibleLayer() {
    this.invisibleLayerElement = document.createElement('div');
    this.invisibleLayerElement.id = 'prompt-shields-invisible-layer';
    this.invisibleLayerElement.style.cssText = `
      position: absolute;
      background: transparent;
      pointer-events: auto;
      z-index: 2147483646;
      display: none;
      cursor: default;
    `;

    // Simple click handler to pass clicks through to underlying elements
    this.invisibleLayerElement.addEventListener('click', (event) => {
      // Get the element that would receive the click if this layer wasn't there
      this.invisibleLayerElement.style.pointerEvents = 'none';
      const elementBelow = document.elementFromPoint(event.clientX, event.clientY);
      this.invisibleLayerElement.style.pointerEvents = 'auto';

      if (elementBelow && elementBelow !== this.invisibleLayerElement) {
        // Create and dispatch a new click event on the underlying element
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          clientX: event.clientX,
          clientY: event.clientY,
          button: event.button,
          buttons: event.buttons
        });
        elementBelow.dispatchEvent(clickEvent);
      }

      // Prevent the original click from bubbling
      event.stopPropagation();
      event.preventDefault();
    });

    document.body.appendChild(this.invisibleLayerElement);
  }

  /**
   * Setup event listeners for focus and hover functionality
   */
  setupEventListeners() {
    // Input event for highlighting text-enabled containers when typing
    document.addEventListener('input', (event) => {
      if (!this.isEnabled) return;

      const target = event.target;
      if (target && target !== this.highlightElement && target !== this.buttonElement) {
        // Check if this is a text-enabled container
        if (this.isTextEnabledContainer(target)) {
          // Set this as the active text container and show highlight
          this.setActiveTextContainer(target);
          this.showHighlight(target, 'element');

        }
      }
    });

    // Keydown event for highlighting text-enabled containers on first keystroke
    document.addEventListener('keydown', (event) => {
      if (!this.isEnabled) return;

      const target = event.target;
      if (target && target !== this.highlightElement && target !== this.buttonElement) {
        // Check if this is a text-enabled container and user is typing
        if (this.isTextEnabledContainer(target) && this.isTypingKey(event.key)) {
          // Set this as the active text container and maintain highlighting during typing
          this.setActiveTextContainer(target);
          this.showHighlight(target, 'element');

        }
      }
    });

    // Blur event to hide highlight when focus is lost
    document.addEventListener('focusout', (_event) => {
      // Only hide if focus is not moving to another element within the same container
      setTimeout(() => {
        if (!document.activeElement ||
          document.activeElement === this.highlightElement ||
          document.activeElement === this.buttonElement) {
          this.hideHighlight();
          // Clear active text container when focus is lost
          this.clearActiveTextContainer();
        }
      }, 100);
    });

    // Click event to disable highlighting when clicking outside
    document.addEventListener('click', (event) => {
      // Check if click is on the button or its children
      if (event.target === this.buttonElement ||
        this.buttonElement.contains(event.target) ||
        event.target === this.invisibleLayerElement) {
        // Let the button handle its own click or ignore invisible layer clicks
        return;
      }

      // Don't hide highlight if clicking on a focusable element
      if (!event.target.matches('input, textarea, select, button, a, [tabindex], [contenteditable]')) {
        this.hideHighlight();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (event) => {
      // Ctrl+Shift+I to toggle highlighting (similar to Chrome DevTools)
      if (event.ctrlKey && event.shiftKey && event.key === 'I') {
        event.preventDefault();
        this.toggleHighlighting();
      }
      // Escape to hide highlight
      if (event.key === 'Escape') {
        this.hideHighlight();
      }
      // Tab navigation - highlighting removed, only typing/selection triggers highlights now
      if (event.key === 'Tab') {
        // Focus changes no longer trigger highlighting
      }
    });

  }

  /**
   * Enable or disable highlighting
   */
  toggleHighlighting() {
    this.isEnabled = !this.isEnabled;
    if (!this.isEnabled) {
      this.hideAllHighlights();
    }

    // Update status indicator
    if (this.statusIndicator) {
      this.statusIndicator.textContent = `DOM Highlighting: ${this.isEnabled ? 'ON' : 'OFF'}`;
      this.statusIndicator.style.background = this.isEnabled ? '#FFFFFF' : '#666';
    }


  }

  /**
   * Highlight a DOM element or text selection
   * @param {HTMLElement|Range} target - Element to highlight or text range
   * @param {string} type - Type of highlight: 'element' or 'selection'
   */
  showHighlight(target, _type = 'element') {
    if (!this.isEnabled || !target) return;
    // Handle element highlighting (focus/hover)
    this.currentTarget = target;

    const rect = target.getBoundingClientRect();
    const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
    const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;

    const highlightMargin = 8;

    // Position the highlight
    this.highlightElement.style.top = `${rect.top + scrollTop - highlightMargin}px`;
    this.highlightElement.style.left = `${rect.left + scrollLeft - highlightMargin}px`;
    this.highlightElement.style.width = `${rect.width}px`;
    this.highlightElement.style.height = `${rect.height}px`;
    this.highlightElement.style.display = 'block';

    // Apply element styling (blue)
    this.highlightElement.style.border = '1px solid #FFFFFF';
    this.highlightElement.style.backgroundColor = 'rgba(66, 133, 244, 0)';
    this.highlightElement.style.boxShadow = '0 0 0 1px rgba(66, 133, 244, 0)';

    // Position the button at the top-left outside of the highlight box
    // Get current button dimensions dynamically based on state
    const buttonRect = this.buttonElement.getBoundingClientRect();
    const buttonWidth = buttonRect.width || 50; // Fallback width
    const buttonHeight = buttonRect.height || 40; // Fallback height
    const margin = 8; // Margin from the highlight

    // Position button at top-left outside of the highlight with fallback positioning
    let buttonTop, buttonLeft;

    // Try to place button above and to the left of the highlight
    if (rect.top + scrollTop - buttonHeight - margin >= 0 && rect.left + scrollLeft - buttonWidth - margin >= 0) {
      // Button fits above and to the left - ideal position
      buttonTop = rect.top + scrollTop - buttonHeight - margin;
      buttonLeft = rect.left + scrollLeft - buttonWidth - margin;
    } else if (rect.top + scrollTop - buttonHeight - margin >= 0) {
      // Button fits above but not to the left - place above, aligned with left edge
      buttonTop = rect.top + scrollTop - buttonHeight - margin;
      buttonLeft = rect.left + scrollLeft;
    } else if (rect.left + scrollLeft - buttonWidth - margin >= 0) {
      // Button fits to the left but not above - place to the left, aligned with top edge
      buttonTop = rect.top + scrollTop;
      buttonLeft = rect.left + scrollLeft - buttonWidth - margin;
    } else {
      // Fallback: place inside the highlight at top-left
      buttonTop = rect.top + scrollTop + margin;
      buttonLeft = rect.left + scrollLeft + margin;
    }

    // Store button position to prevent trembling
    this.lastButtonPosition = { top: buttonTop, left: buttonLeft };

    this.buttonElement.style.top = `${buttonTop}px`;
    this.buttonElement.style.left = `${buttonLeft}px`;
    this.buttonElement.style.display = 'block';

    // Position the invisible layer to cover both highlight and button with extended safe zone
    const extraPadding = 20; // Extra padding to create a larger safe zone
    const layerTop = Math.min(rect.top + scrollTop, buttonTop);
    const layerLeft = Math.min(rect.left + scrollLeft, buttonLeft);
    const layerRight = Math.max(rect.left + scrollLeft + rect.width, buttonLeft + buttonWidth);
    const layerBottom = Math.max(rect.top + scrollTop + rect.height, buttonTop + buttonHeight);

    this.invisibleLayerElement.style.top = `${layerTop - margin - extraPadding}px`;
    this.invisibleLayerElement.style.left = `${layerLeft - margin - extraPadding}px`;
    this.invisibleLayerElement.style.width = `${layerRight - layerLeft + (margin * 2) + (extraPadding * 2)}px`;
    this.invisibleLayerElement.style.height = `${layerBottom - layerTop + (margin * 2) + (extraPadding * 2)}px`;
    this.invisibleLayerElement.style.display = 'block';

  }

  /**
   * Hide the focus highlight and button (keeps selection highlight)
   */
  hideHighlight() {
    console.log('hideHighlight called');

    if (this.highlightElement) {
      console.log('Hiding highlight element');
      this.highlightElement.style.display = 'none';
    }
    if (this.buttonElement) {
      console.log('Hiding button element');
      this.buttonElement.style.display = 'none';
    }
    if (this.invisibleLayerElement) {
      console.log('Hiding invisible layer element');
      this.invisibleLayerElement.style.display = 'none';
    }

    console.log('Clearing currentTarget and lastButtonPosition');
    this.currentTarget = null;
    this.lastButtonPosition = null;

    console.log('hideHighlight completed');
    // Note: Selection highlight is kept separate and won't be hidden here
  }





  /**
   * Hide all highlights (both focus and selection)
   */
  hideAllHighlights() {
    this.hideHighlight();
  }

  /**
   * Check if an element is a text-enabled container
   * @param {HTMLElement} element - Element to check
   * @returns {boolean} True if element can contain editable text
   */
  isTextEnabledContainer(element) {
    if (!element) return false;

    // Standard input types that accept text
    if (element.tagName === 'INPUT') {
      const inputType = element.type?.toLowerCase();
      const textInputTypes = [
        'text', 'email', 'password', 'search', 'tel', 'url', 'number',
        'date', 'datetime-local', 'month', 'time', 'week'
      ];
      return textInputTypes.includes(inputType);
    }

    // Textarea elements
    if (element.tagName === 'TEXTAREA') {
      return true;
    }

    // Contenteditable elements
    if (element.contentEditable === 'true' || element.contentEditable === 'plaintext-only') {
      return true;
    }

    // Elements with role="textbox"
    if (element.getAttribute('role') === 'textbox') {
      return true;
    }

    // Elements with tabindex that might be text containers
    if (element.hasAttribute('tabindex') && element.tabIndex >= 0) {
      // Check if it's likely a text container based on common patterns
      const className = element.className?.toLowerCase() || '';
      const id = element.id?.toLowerCase() || '';
      const textContainerPatterns = [
        'editor', 'textarea', 'input', 'text', 'content', 'message', 'comment',
        'note', 'description', 'body', 'field', 'form', 'composer'
      ];

      return textContainerPatterns.some(pattern =>
        className.includes(pattern) || id.includes(pattern)
      );
    }

    return false;
  }

  /**
   * Check if a key press represents typing (not navigation or special keys)
   * @param {string} key - The key that was pressed
   * @returns {boolean} True if the key represents typing
   */
  isTypingKey(key) {
    if (!key) return false;

    // Single character keys (letters, numbers, symbols)
    if (key.length === 1) {
      return true;
    }

    // Common typing keys
    const typingKeys = [
      'Backspace', 'Delete', 'Enter', 'Space', 'Tab'
    ];

    return typingKeys.includes(key);
  }

  /**
   * Set the active text container that's currently being typed in
   * @param {HTMLElement} element - The text container element
   */
  setActiveTextContainer(element) {
    this.activeTextContainer = element;
  }

  /**
   * Clear the active text container
   */
  clearActiveTextContainer() {
    this.activeTextContainer = null;
  }

  /**
   * Check if an element is the currently active text container
   * @param {HTMLElement} element - Element to check
   * @returns {boolean} True if element is the active text container
   */
  isActiveTextContainer(element) {
    return this.activeTextContainer === element;
  }

  /**
   * Check if we should maintain highlighting for the current element
   * @param {HTMLElement} element - Element to check
   * @returns {boolean} True if highlighting should be maintained
   */
  shouldMaintainHighlight(element) {
    // Maintain highlight if this is an active text container
    if (this.isActiveTextContainer(element)) {
      return true;
    }

    // Maintain highlight if this is a focused text container
    if (element === document.activeElement && this.isTextEnabledContainer(element)) {
      return true;
    }

    return false;
  }

  // handleAnalyzeClick method removed - replaced with state-based button system

  /**
   * Clean up resources
   */
  destroy() {
    if (this.highlightElement && this.highlightElement.parentNode) {
      this.highlightElement.parentNode.removeChild(this.highlightElement);
    }
    if (this.buttonElement && this.buttonElement.parentNode) {
      this.buttonElement.parentNode.removeChild(this.buttonElement);
    }
    if (this.invisibleLayerElement && this.invisibleLayerElement.parentNode) {
      this.invisibleLayerElement.parentNode.removeChild(this.invisibleLayerElement);
    }
  }
}

/**
 * Main content script for PromptShields Chrome extension
 * Handles text input monitoring - ready for new flow implementation
 */
class PromptShieldsContent {
  constructor() {

    this.communication = new CommunicationService();
    this.domHighlighter = new DOMHighlighter();
    this.currentTarget = null;
    this.isInitialized = false;
    this.lastAnalyzedText = null;
  }

  /**
   * Initialize the content script
   */
  init() {

    if (this.isInitialized) return;

    this.setupEventListeners();
    this.setupMessageListeners();

    this.isInitialized = true;

  }

  /**
   * Setup DOM event listeners
   */
  setupEventListeners() {
    // Listen for custom analyze events from DOM highlighter
    document.addEventListener('promptshields-analyze', (event) => {
      const { target, text } = event.detail;
      if (target && text) {
        this.currentTarget = target;
        this.processText(target, text);
      }
    });
  }

  /**
   * Setup message listeners
   */
  setupMessageListeners() {
    // Handle runtime messages through CommunicationService
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalid, skipping message listener setup');
      return;
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      // Check if extension context is still valid when receiving messages
      if (!isExtensionContextValid()) {
        console.warn('Extension context invalid, ignoring message');
        return false;
      }

      console.log('Received runtime message:', message);
      if (message.type === MessageTypes.AUTHENTICATION_UPDATE) {
        console.log('Processing authentication update message');
        this.communication.setAuthenticationStatus(message.isAuthenticated);

        // Update DOM highlighter authentication status
        if (this.domHighlighter) {
          this.domHighlighter.setAuthenticationStatus(message.isAuthenticated);
        }

        sendResponse({ reply: 'Hello from content.js!' });
      }
      return true;
    });
  }


  /**
   * Get credentials from background script
   */
  async getCredentials() {
    return safeExtensionCall(
      () => new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: MessageTypes.GET_CREDENTIALS }, (response) => {
          resolve(response?.credentials || null);
        });
      }),
      () => null
    );
  }


  /**
   * Process text - placeholder for new flow implementation
   * @param {HTMLElement} target - Target element
   * @param {string} text - Text to process
   */
  async processText(target, text) {
    if (!target || !text) return;

    this.currentTarget = target;

    // Skip if we've already analyzed this exact text
    if (this.lastAnalyzedText === text) {
      console.log('Skipping analysis - text already analyzed');
      return;
    }

    // New text processing flow will be implemented here
    console.log('Processing text:', `${text.substring(0, 50)}...`);
    this.lastAnalyzedText = text;
  }









  /**
   * Get current state information (for debugging/testing)
   * @returns {Object} Current state
   */
  getState() {
    return {
      isInitialized: this.isInitialized,
      currentTarget: this.currentTarget,
      isAuthenticated: this.communication.getAuthenticationStatus(),
      portConnected: this.communication.isPortConnected()
    };
  }

  /**
   * Update authentication status
   * @param {boolean} isAuthenticated - Authentication status
   */
  updateAuthenticationStatus(isAuthenticated) {
    this.communication.setAuthenticationStatus(isAuthenticated);

    // Update DOM highlighter authentication status
    if (this.domHighlighter) {
      this.domHighlighter.setAuthenticationStatus(isAuthenticated);
    }
  }

  /**
   * Enable DOM highlighting functionality
   */
  enableDOMHighlighting() {
    this.domHighlighter.toggleHighlighting();
  }

  /**
   * Disable DOM highlighting functionality
   */
  disableDOMHighlighting() {
    if (this.domHighlighter.isEnabled) {
      this.domHighlighter.toggleHighlighting();
    }
  }

  /**
   * Get DOM highlighting status
   * @returns {boolean} True if highlighting is enabled
   */
  isDOMHighlightingEnabled() {
    return this.domHighlighter.isEnabled;
  }



  /**
   * Manual highlighting function - focus alone no longer triggers highlighting
   * Highlighting now only occurs on typing and text selection
   */
  highlightFocusedElement() {
    console.log('Manual highlighting disabled - highlighting now only occurs on typing and text selection');
    return false;
  }

  /**
   * Get information about the currently focused element
   */
  getFocusedElementInfo() {
    const activeElement = document.activeElement;
    if (activeElement &&
      activeElement !== document.body &&
      activeElement !== document.documentElement) {
      return {
        tagName: activeElement.tagName,
        id: activeElement.id,
        className: activeElement.className,
        type: activeElement.type || 'N/A',
        value: activeElement.value || 'N/A',
        textContent: activeElement.textContent?.substring(0, 100) || 'N/A'
      };
    }
    return null;
  }

  /**
   * Get information about the current text selection
   */
  getSelectionInfo() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      return {
        text: selection.toString(),
        length: selection.toString().length,
        startContainer: range.startContainer.nodeName,
        endContainer: range.endContainer.nodeName,
        startOffset: range.startOffset,
        endOffset: range.endOffset
      };
    }
    return null;
  }

  /**
   * Hide all highlights (both focus and selection)
   */
  hideAllHighlights() {
    this.domHighlighter.hideAllHighlights();
  }

  /**
   * Update selection highlight
   */
  updateSelectionHighlight() {
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0 && selection.toString().trim()) {
      const range = selection.getRangeAt(0);
      this.domHighlighter.showHighlight(range, 'selection');
    }
  }

  /**
   * Check if an element is a text-enabled container
   * @param {HTMLElement} element - Element to check
   * @returns {boolean} True if element can contain editable text
   */
  isTextEnabledContainer(element) {
    return this.domHighlighter.isTextEnabledContainer(element);
  }

  /**
   * Get information about text-enabled containers on the page
   * @returns {Array} Array of text-enabled container information
   */
  getTextEnabledContainers() {
    const containers = [];
    const allElements = document.querySelectorAll('*');

    allElements.forEach(element => {
      if (this.domHighlighter.isTextEnabledContainer(element)) {
        containers.push({
          tagName: element.tagName,
          id: element.id,
          className: element.className,
          type: element.type || 'N/A',
          contentEditable: element.contentEditable || 'N/A',
          role: element.getAttribute('role') || 'N/A',
          tabIndex: element.tabIndex || 'N/A'
        });
      }
    });

    return containers;
  }
}

// Global error handler for extension context invalidation
window.addEventListener('error', (event) => {
  if (event.error && event.error.message && event.error.message.includes('Extension context invalidated')) {
    console.warn('Extension context invalidated, stopping content script operations');
    event.preventDefault();
    return false;
  }
});

// Global unhandled promise rejection handler
window.addEventListener('unhandledrejection', (event) => {
  if (event.reason && event.reason.message && event.reason.message.includes('Extension context invalidated')) {
    console.warn('Extension context invalidated in promise, stopping operations');
    event.preventDefault();
    return false;
  }
});

// Initialize the content script when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    if (!isExtensionContextValid()) {
      console.warn('Extension context invalid, skipping initialization');
      return;
    }

    const promptShields = new PromptShieldsContent();
    promptShields.init();

    // Expose DOM highlighting functionality globally for debugging/testing
    window.promptShields = {
      enableHighlighting: () => promptShields.enableDOMHighlighting(),
      disableHighlighting: () => promptShields.disableDOMHighlighting(),
      isHighlightingEnabled: () => promptShields.isDOMHighlightingEnabled(),
      getState: () => promptShields.getState(),

      highlightFocused: () => promptShields.highlightFocusedElement(),
      getFocusedInfo: () => promptShields.getFocusedElementInfo()
    };

    console.log('🎯 DOM Highlighting feature ready! Use Ctrl+Shift+I to toggle. Highlighting occurs on typing and text selection only.');
  });
} else {
  if (!isExtensionContextValid()) {
    console.warn('Extension context invalid, skipping initialization');
  } else {
    const promptShields = new PromptShieldsContent();
    promptShields.init();

    // Expose DOM highlighting functionality globally for debugging/testing
    window.promptShields = {
      enableHighlighting: () => promptShields.enableDOMHighlighting(),
      disableHighlighting: () => promptShields.disableDOMHighlighting(),
      isHighlightingEnabled: () => promptShields.isDOMHighlightingEnabled(),
      getState: () => promptShields.getState(),

      highlightFocused: () => promptShields.highlightFocusedElement(),
      getFocusedInfo: () => promptShields.getFocusedElementInfo(),
      getSelectionInfo: () => promptShields.getSelectionInfo(),
      hideAllHighlights: () => promptShields.hideAllHighlights(),
      updateSelectionHighlight: () => promptShields.updateSelectionHighlight(),
      isTextEnabledContainer: (element) => promptShields.isTextEnabledContainer(element),
      getTextEnabledContainers: () => promptShields.getTextEnabledContainers(),
      debugTextContainer: (element) => {
        if (!element) {
          console.log('No element provided for debugging');
          return;
        }
        console.log('Debugging element:', element.tagName, element.className || element.id || 'no-class-or-id');
        console.log('Is text container:', promptShields.isTextEnabledContainer(element));
        console.log('Is active text container:', promptShields.domHighlighter.isActiveTextContainer(element));
        console.log('Should maintain highlight:', promptShields.domHighlighter.shouldMaintainHighlight(element));
        console.log('Current target:', promptShields.domHighlighter.currentTarget);
        console.log('Active text container:', promptShields.domHighlighter.activeTextContainer);
      }
    };

    console.log('🎯 DOM Highlighting feature ready! Use Ctrl+Shift+I to toggle. Highlighting occurs on typing and text selection only.');
  }
}

// Mount the in-page AI chat panel (FAB + slide-in panel), ported from Safari.
// chat-panel.js self-registers window.PromptShieldsChatPanel; init() mounts the UI
// into document.body, so wait for the DOM to be ready before calling it.
function initPromptShieldsChatPanel() {
  if (typeof window !== 'undefined' && window.PromptShieldsChatPanel && typeof document !== 'undefined') {
    window.PromptShieldsChatPanel.init();
  }
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPromptShieldsChatPanel);
} else {
  initPromptShieldsChatPanel();
}
