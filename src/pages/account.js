/**
 * Account Management Page
 * Handles user account information and photo management
 */

const { CommunicationService } = require('../services/communicationService.js');
const { SecureApiClient, InputValidator, ErrorHandler } = require('../utils/securityUtils.js');
const { configLoader } = require('../utils/configLoader.js');

/**
 * AccountManager class for handling account page functionality
 */
class AccountManager {
  constructor() {
    this.communication = new CommunicationService();
    this.userData = null;
    this.profile = null;
    this.credentials = null;

    this.init();
  }

  /**
   * Initialize the account manager
   */
  async init() {
    try {
      this.setupEventListeners();
      // Load configuration first
      await configLoader.loadConfig();
      await this.loadAccountData();

      this.hideLoading();
      this.showMainContent();
    } catch (error) {
      ErrorHandler.logError(error, { context: 'AccountManager.init' });
      this.showError('Failed to load account information');
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

    // Photo management
    const changePhotoButton = document.getElementById('change-photo-button');
    const deletePhotoButton = document.getElementById('delete-photo-button');
    const photoUploadInput = document.getElementById('photo-upload-input');

    if (changePhotoButton) {
      changePhotoButton.addEventListener('click', () => {
        photoUploadInput?.click();
      });
    }

    if (deletePhotoButton) {
      deletePhotoButton.addEventListener('click', () => {
        this.handleDeletePhoto();
      });
    }

    if (photoUploadInput) {
      photoUploadInput.addEventListener('change', (e) => {
        this.handlePhotoUpload(e.target.files[0]);
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

    // Dialog handling
    const dialogCancelButton = document.getElementById('dialog-cancel-button');
    const dialogConfirmButton = document.getElementById('dialog-confirm-button');

    if (dialogCancelButton) {
      dialogCancelButton.addEventListener('click', () => {
        this.hideDialog();
      });
    }

    if (dialogConfirmButton) {
      dialogConfirmButton.addEventListener('click', () => {
        this.handleDialogConfirm();
      });
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.hideDialog();
        this.hideError();
      }
    });
  }

  /**
   * Load account data from extension
   */
  async loadAccountData() {
    try {
      // Get credentials
      this.credentials = await this.communication.getCredentials();
      if (!this.credentials) {
        throw new Error('User not authenticated');
      }

      // Get profile data
      this.profile = await this.communication.getProfile();
      if (!this.profile) {
        throw new Error('Failed to load profile data');
      }

      // Get user data (from JWT token)
      this.userData = await this.getUserDataFromToken();

      // Update UI
      await this.updateUserInterface();
    } catch (error) {
      throw new Error(`Failed to load account data: ${error.message}`, { cause: error });
    }
  }


  /**
   * Get user data from JWT token
   */
  async getUserDataFromToken() {
    try {
      if (!this.credentials || !this.credentials.idToken) {
        throw new Error('No ID token available');
      }

      // Decode JWT token (simplified version - in production use proper JWT library)
      const tokenParts = this.credentials.idToken.split('.');
      if (tokenParts.length !== 3) {
        throw new Error('Invalid JWT token format');
      }

      const payload = JSON.parse(atob(tokenParts[1].replace(/-/g, '+').replace(/_/g, '/')));

      return {
        first_name: payload.given_name || payload.name || 'User',
        email: payload.email || 'user@example.com',
        photo_url: payload.picture || '../images/anonymous-user.svg'
      };
    } catch (error) {
      throw new Error(`Failed to decode user data: ${error.message}`, { cause: error });
    }
  }

  /**
   * Update user interface with loaded data
   */
  async updateUserInterface() {
    this.updateUserProfile();
  }


  /**
   * Update user profile section
   */
  updateUserProfile() {
    const userNameElement = document.getElementById('user-name');
    const userEmailElement = document.getElementById('user-email');
    const profileImageElement = document.getElementById('user-profile-image');
    const deletePhotoButton = document.getElementById('delete-photo-button');

    if (userNameElement && this.userData) {
      userNameElement.textContent = this.userData.first_name;
    }

    if (userEmailElement && this.userData) {
      userEmailElement.textContent = this.userData.email;
    }

    if (profileImageElement && this.userData) {
      profileImageElement.src = this.userData.photo_url;
      profileImageElement.alt = `${this.userData.first_name}'s profile picture`;

      // Show delete button if user has uploaded photo
      if (deletePhotoButton && this.userData.photo_url && !this.userData.photo_url.includes('anonymous-user.svg')) {
        deletePhotoButton.classList.remove('hidden');
      }
    }
  }



  /**
   * Handle photo upload
   */
  async handlePhotoUpload(file) {
    if (!file) return;

    try {
      // Validate file
      const validation = InputValidator.validateImageFile(file);
      if (!validation.isValid) {
        this.showErrorToast(validation.error);
        return;
      }

      this.showLoading();

      // Upload photo via API
      const uploadUrl = configLoader.get('profilePhotoServiceUrl');
      const response = await SecureApiClient.uploadFile(uploadUrl, file, this.credentials);
      const result = await response.json();

      if (result.success && result.photo_url) {
        // Update user data and UI
        this.userData.photo_url = result.photo_url;
        this.updateUserProfile();
        this.showSuccessToast('Profile photo updated successfully');
      } else {
        throw new Error(result.message || 'Failed to upload photo');
      }
    } catch (error) {
      ErrorHandler.logError(error, { context: 'AccountManager.handlePhotoUpload' });
      this.showErrorToast(ErrorHandler.sanitizeErrorMessage(error));
    } finally {
      this.hideLoading();
    }
  }

  /**
   * Handle photo deletion
   */
  async handleDeletePhoto() {
    this.showDialog(
      'Delete Profile Photo',
      'Are you sure you want to delete your profile photo? This action cannot be undone.',
      'delete-photo'
    );
  }

  /**
   * Execute photo deletion
   */
  async executeDeletePhoto() {
    try {
      this.showLoading();

      const deleteUrl = configLoader.get('profilePhotoServiceUrl');
      const response = await SecureApiClient.makeRequest(deleteUrl, {
        method: 'DELETE'
      }, this.credentials);

      const result = await response.json();

      if (result.success) {
        // Update user data and UI
        this.userData.photo_url = '../images/anonymous-user.svg';
        this.updateUserProfile();
        this.showSuccessToast('Profile photo deleted successfully');
      } else {
        throw new Error(result.message || 'Failed to delete photo');
      }
    } catch (error) {
      ErrorHandler.logError(error, { context: 'AccountManager.executeDeletePhoto' });
      this.showErrorToast(ErrorHandler.sanitizeErrorMessage(error));
    } finally {
      this.hideLoading();
    }
  }


  /**
   * Show loading overlay
   */
  showLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.classList.remove('hidden');
    }
  }

  /**
   * Hide loading overlay
   */
  hideLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) {
      loadingOverlay.classList.add('hidden');
    }
  }

  /**
   * Show main content
   */
  showMainContent() {
    const mainContent = document.getElementById('main-content');
    if (mainContent) {
      mainContent.classList.remove('hidden');
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
    }
  }

  /**
   * Hide error overlay
   */
  hideError() {
    const errorOverlay = document.getElementById('error-overlay');
    if (errorOverlay) {
      errorOverlay.classList.add('hidden');
    }
  }

  /**
   * Show confirmation dialog
   */
  showDialog(title, message, action) {
    const dialogOverlay = document.getElementById('confirmation-dialog');
    const dialogTitle = document.getElementById('dialog-title');
    const dialogMessage = document.getElementById('dialog-message');
    const confirmButton = document.getElementById('dialog-confirm-button');

    if (dialogOverlay && dialogTitle && dialogMessage && confirmButton) {
      dialogTitle.textContent = title;
      dialogMessage.textContent = message;
      confirmButton.dataset.action = action;
      dialogOverlay.classList.remove('hidden');
    }
  }

  /**
   * Hide confirmation dialog
   */
  hideDialog() {
    const dialogOverlay = document.getElementById('confirmation-dialog');
    if (dialogOverlay) {
      dialogOverlay.classList.add('hidden');
    }
  }

  /**
   * Handle dialog confirmation
   */
  async handleDialogConfirm() {
    const confirmButton = document.getElementById('dialog-confirm-button');
    const action = confirmButton?.dataset.action;

    this.hideDialog();

    switch (action) {
    case 'delete-photo':
      await this.executeDeletePhoto();
      break;
    default:
      console.warn('Unknown dialog action:', action);
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
   * Show info toast
   */
  showInfoToast(message) {
    this.showToast('info', message);
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
      toast.classList.add('show');

      // Auto-hide after 5 seconds
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
          toast.classList.add('hidden');
        }, 300);
      }, 5000);
    }
  }
}

// Initialize account manager when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new AccountManager();
  });
} else {
  new AccountManager();
}
