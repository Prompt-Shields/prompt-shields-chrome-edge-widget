import { CommunicationService } from './services/communicationService.js';
import { MessageTypes } from './config/messageTypes.js';

/**
 * Popup script for PromptShields extension
 * Handles authentication UI and user interactions
 */
class PopupManager {
  constructor() {
    this.communication = new CommunicationService();
    this.isLoggedIn = false;
    this.init();
  }

  /**
   * Initialize the popup
   */
  init() {
    this.setupMessageListeners();
    this.setupEventListeners();
    // Show loading state while checking authentication
    this.showLoadingState();
    // Send initial ping to check authentication status with existing credentials
    this.communication.sendMessage({ type: MessageTypes.PING });
  }

  /**
   * Setup message listeners using CommunicationService
   */
  setupMessageListeners() {
    // Listen for authentication responses
    this.communication.addMessageListener(MessageTypes.AUTHORIZE, async (response) => {
      if (response.success) {
        this.isLoggedIn = true;
        this.updateUI(response.userData);

        // Fetch profile data after successful authentication
        try {
          const profile = await this.communication.getProfile();
          if (profile) {
            console.log('Profile data fetched after authentication:', profile);
            // Profile is now available if needed for future UI enhancements
          }
        } catch (error) {
          console.warn('Failed to fetch profile after authentication:', error);
        }
      } else {
        this.isLoggedIn = false;
        this.updateUI(null, response.error);
      }
    });

    // Listen for user data responses
    this.communication.addMessageListener(MessageTypes.GET_USER, async (response) => {
      if (response.success) {
        this.isLoggedIn = true;
        this.updateUI(response.userData);

        // Fetch profile data when user is authenticated
        try {
          const profile = await this.communication.getProfile();
          if (profile) {
            console.log('Profile data fetched for popup:', profile);
            // Profile is now available if needed for future UI enhancements
          }
        } catch (error) {
          console.warn('Failed to fetch profile in popup:', error);
        }
      } else {
        this.isLoggedIn = false;
        this.updateUI(null, response.error);
      }
    });

    // Listen for logout responses
    this.communication.addMessageListener(MessageTypes.LOGOUT, (_response) => {
      this.isLoggedIn = false;
      this.updateUI(null);
    });
  }

  /**
   * Setup DOM event listeners
   */
  setupEventListeners() {
    const authButton = document.getElementById('authButton');
    if (authButton) {
      authButton.addEventListener('click', () => {
        this.handleAuthButtonClick();
      });
    }

    // Account button event listener
    const accountButton = document.getElementById('accountButton');
    if (accountButton) {
      accountButton.addEventListener('click', () => {
        this.handleAccountButtonClick();
      });
    }

    // History button event listener
    const historyButton = document.getElementById('historyButton');
    if (historyButton) {
      historyButton.addEventListener('click', () => {
        this.handleHistoryButtonClick();
      });
    }

    // Settings button event listener
    const settingsButton = document.getElementById('settingsButton');
    if (settingsButton) {
      settingsButton.addEventListener('click', () => {
        this.handleSettingsButtonClick();
      });
    }
  }

  /**
   * Handle authentication button click
   */
  handleAuthButtonClick() {
    this.showLoadingState();

    if (!this.isLoggedIn) {
      this.communication.sendMessage({ type: MessageTypes.AUTHORIZE });
    } else {
      this.communication.sendMessage({ type: MessageTypes.LOGOUT });
    }
  }

  /**
   * Handle Account button click
   */
  handleAccountButtonClick() {
    if (!this.isLoggedIn) {
      console.warn('User must be logged in to access account page');
      return;
    }

    try {
      // Open account page in new tab
      const accountPageUrl = chrome.runtime.getURL('pages/account.html');
      chrome.tabs.create({ url: accountPageUrl });

      // Close popup
      window.close();
    } catch (error) {
      console.error('Failed to open account page:', error);
      this.showError('Failed to open account page. Please try again.');
    }
  }

  /**
   * Handle History button click
   */
  handleHistoryButtonClick() {
    if (!this.isLoggedIn) {
      console.warn('User must be logged in to access history page');
      return;
    }

    try {
      // Open history page in new tab
      const historyPageUrl = chrome.runtime.getURL('pages/history.html');
      chrome.tabs.create({ url: historyPageUrl });

      // Close popup
      window.close();
    } catch (error) {
      console.error('Failed to open history page:', error);
      this.showError('Failed to open history page. Please try again.');
    }
  }

  /**
   * Handle Settings button click
   */
  handleSettingsButtonClick() {
    if (!this.isLoggedIn) {
      console.warn('User must be logged in to access settings page');
      return;
    }

    try {
      // Open settings page in new tab
      const settingsPageUrl = chrome.runtime.getURL('pages/settings.html');
      chrome.tabs.create({ url: settingsPageUrl });

      // Close popup
      window.close();
    } catch (error) {
      console.error('Failed to open settings page:', error);
      this.showError('Failed to open settings page. Please try again.');
    }
  }

  /**
   * Show loading state
   */
  showLoadingState() {
    const authButton = document.getElementById('authButton');
    if (authButton) {
      authButton.innerHTML = '';
      authButton.className = 'loader';
    }
  }

  /**
   * Update the UI based on authentication state
   * @param {Object} userData - User data object
   * @param {string} errorMessage - Error message if any
   */
  updateUI(userData, errorMessage) {
    const authText = document.getElementById('auth-text');
    const authUserImage = document.getElementById('auth-user-image');
    const authButton = document.getElementById('authButton');
    const navButtons = document.getElementById('nav-buttons');

    if (!authText || !authUserImage || !authButton) {
      console.warn('Required UI elements not found');
      return;
    }

    if (this.isLoggedIn && userData) {
      const firstName = userData.first_name;
      const email = userData.email;
      const photoUrl = userData.photo_url;

      authText.innerHTML = `${firstName},<br />logged in with email ${email}`;
      authUserImage.src = photoUrl;
      authUserImage.classList.remove('opacity-low');
      authUserImage.classList.add('opacity-full');
      authButton.classList.remove('bg-login');
      authButton.classList.add('bg-logout');
      authButton.innerHTML = 'Log me out';

      // Show navigation buttons for authenticated users
      if (navButtons) {
        navButtons.classList.remove('hidden');
      }
    } else {
      if (errorMessage) {
        authText.innerHTML = `🔴${errorMessage}<br />Please try again. If the problem persists please contact <a href="mailto:support@promptshields.com">support@promptshields.com</a>`;
      } else {
        authText.innerHTML = 'You are currently not logged in';
      }
      authUserImage.src = 'images/anonymous-user.svg';
      authUserImage.classList.remove('opacity-full');
      authUserImage.classList.add('opacity-low');
      authButton.classList.remove('bg-logout');
      authButton.classList.add('bg-login');
      authButton.innerHTML = 'Log me in';

      // Hide navigation buttons for non-authenticated users
      if (navButtons) {
        navButtons.classList.add('hidden');
      }
    }

    authButton.className = 'block';
  }

  /**
   * Show error message to user
   * @param {string} message - Error message to display
   */
  showError(message) {
    const authText = document.getElementById('auth-text');
    if (authText) {
      authText.innerHTML = `🔴 ${message}`;

      // Clear error message after 5 seconds
      setTimeout(() => {
        if (this.isLoggedIn) {
          // Restore user info if logged in
          this.communication.sendMessage({ type: MessageTypes.PING });
        } else {
          authText.innerHTML = 'You are currently not logged in';
        }
      }, 5000);
    }
  }
}

// Initialize popup when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new PopupManager();
  });
} else {
  new PopupManager();
}
