/**
 * Authentication Service Implementation
 * Handles OAuth authentication, token management, and user session persistence
 * Implements Single Responsibility Principle (SRP) and Dependency Inversion Principle (DIP)
 */

import { IAuthenticationService, IAuthenticationObserver } from '../interfaces/IAuthenticationService.js';

/**
 * Production-ready authentication service with persistent session management
 */
export class AuthenticationService extends IAuthenticationService {
  constructor(credentialStorage, tokenValidator, profileService, httpClient, logger, config) {
    super();

    // Dependencies (Dependency Injection)
    this.credentialStorage = credentialStorage;
    this.tokenValidator = tokenValidator;
    this.profileService = profileService;
    this.httpClient = httpClient;
    this.logger = logger;
    this.config = config;

    // State management
    this.isInitialized = false;
    this.currentUser = null;
    this.authenticationState = 'unknown'; // 'unknown', 'authenticated', 'unauthenticated'
    this.observers = new Set();
    this.refreshPromise = null;

    // Configuration
    this.refreshThreshold = 15 * 60 * 1000; // 15 minutes before expiry
    this.maxRetries = 3;
    this.retryDelay = 1000; // 1 second

    this.initialize();
  }

  /**
   * Initialize the authentication service
   * @private
   */
  async initialize() {
    try {
      this.logger.info('Initializing authentication service');

      // Check for existing valid credentials
      await this.restoreSession();

      // Setup periodic token refresh
      this.setupTokenRefresh();

      // Setup extension lifecycle handlers
      this.setupLifecycleHandlers();

      this.isInitialized = true;
      this.logger.info('Authentication service initialized', {
        isAuthenticated: this.authenticationState === 'authenticated'
      });

    } catch (error) {
      this.logger.error('Authentication service initialization failed', error);
      this.authenticationState = 'unauthenticated';
    }
  }

  /**
   * Authenticate user with OAuth provider
   * @returns {Promise<Object>} User data and credentials
   */
  async authenticate() {
    try {
      this.logger.info('Starting OAuth authentication');

      const authConfig = this.config.getAuth0();
      const authUrl = this.buildAuthUrl(authConfig);

      // Launch OAuth flow
      const redirectUrl = await this.launchOAuthFlow(authUrl);
      const authCode = this.extractAuthCode(redirectUrl);

      if (!authCode) {
        throw new Error('No authorization code received');
      }

      // Exchange code for tokens
      const tokens = await this.exchangeCodeForTokens(authCode);

      // Validate tokens
      await this.validateTokens(tokens);

      // Store credentials securely
      await this.credentialStorage.storeCredentials(tokens);

      // Extract user data from ID token
      const userData = await this.extractUserDataFromToken(tokens.idToken);

      // Fetch and cache user profile
      try {
        await this.profileService.fetchProfile();
      } catch (profileError) {
        this.logger.warn('Failed to fetch profile after authentication', profileError);
        // Don't fail authentication if profile fetch fails
      }

      // Update state
      this.currentUser = userData;
      this.authenticationState = 'authenticated';

      // Notify observers
      this.notifyObservers(true, userData);

      this.logger.info('Authentication successful', {
        userId: userData.sub,
        email: userData.email
      });

      return userData;

    } catch (error) {
      this.logger.error('Authentication failed', error);
      this.authenticationState = 'unauthenticated';
      this.notifyObserversError(error);
      throw error;
    }
  }

  /**
   * Check if user is currently authenticated
   * @returns {Promise<boolean>} Authentication status
   */
  async isAuthenticated() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Quick check if we have cached state
      if (this.authenticationState === 'authenticated' && this.currentUser) {
        // Verify credentials are still valid
        const hasValid = await this.credentialStorage.hasValidCredentials();
        if (hasValid) {
          return true;
        }
      }

      // Check stored credentials
      const credentials = await this.credentialStorage.getCredentials();
      if (!credentials) {
        this.authenticationState = 'unauthenticated';
        return false;
      }

      // Validate tokens
      const isValid = await this.tokenValidator.validateToken(credentials.accessToken);
      if (!isValid.valid) {
        this.logger.info('Stored credentials are invalid', { reason: isValid.reason });

        // Try to refresh if we have a refresh token
        if (credentials.refreshToken) {
          try {
            await this.refreshTokens();
            return true;
          } catch (refreshError) {
            this.logger.warn('Token refresh failed', refreshError);
          }
        }

        // Clear invalid credentials
        await this.credentialStorage.clearCredentials();
        this.authenticationState = 'unauthenticated';
        return false;
      }

      // Update cached state
      if (this.authenticationState !== 'authenticated') {
        this.currentUser = await this.extractUserDataFromToken(credentials.idToken);
        this.authenticationState = 'authenticated';
        this.notifyObservers(true, this.currentUser);
      }

      return true;

    } catch (error) {
      this.logger.error('Error checking authentication status', error);
      this.authenticationState = 'unauthenticated';
      return false;
    }
  }

  /**
   * Get current user data
   * @returns {Promise<Object|null>} User data or null if not authenticated
   */
  async getCurrentUser() {
    try {
      const isAuth = await this.isAuthenticated();
      if (!isAuth) {
        return null;
      }

      // Return cached user data if available
      if (this.currentUser) {
        return this.currentUser;
      }

      // Extract from stored credentials
      const credentials = await this.credentialStorage.getCredentials();
      if (credentials && credentials.idToken) {
        this.currentUser = await this.extractUserDataFromToken(credentials.idToken);
        return this.currentUser;
      }

      return null;

    } catch (error) {
      this.logger.error('Error getting current user', error);
      return null;
    }
  }

  /**
   * Logout current user
   * @returns {Promise<void>}
   */
  async logout() {
    try {
      this.logger.info('Logging out user');

      // Clear stored credentials
      await this.credentialStorage.clearCredentials();

      // Clear profile cache
      await this.profileService.clearProfile();

      // Update state
      this.currentUser = null;
      this.authenticationState = 'unauthenticated';

      // Clear refresh promise
      this.refreshPromise = null;

      // Notify observers
      this.notifyObservers(false, null);

      this.logger.info('Logout completed');

    } catch (error) {
      this.logger.error('Logout failed', error);
      throw error;
    }
  }

  /**
   * Refresh authentication tokens
   * @returns {Promise<Object>} New credentials
   */
  async refreshTokens() {
    // Prevent multiple concurrent refresh attempts
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.performTokenRefresh();

    try {
      const result = await this.refreshPromise;
      this.refreshPromise = null;
      return result;
    } catch (error) {
      this.refreshPromise = null;
      throw error;
    }
  }

  /**
   * Perform actual token refresh
   * @returns {Promise<Object>} New credentials
   * @private
   */
  async performTokenRefresh() {
    try {
      this.logger.info('Refreshing authentication tokens');

      const credentials = await this.credentialStorage.getCredentials();
      if (!credentials || !credentials.refreshToken) {
        throw new Error('No refresh token available');
      }

      const authConfig = this.config.getAuth0();
      const tokenUrl = authConfig.tokenUrl;

      const response = await this.httpClient.post(tokenUrl, {
        grant_type: 'refresh_token',
        client_id: authConfig.clientId,
        refresh_token: credentials.refreshToken
      });

      const tokenData = await response.json();

      if (!tokenData.access_token) {
        throw new Error('Invalid token refresh response');
      }

      // Create new credentials object
      const newCredentials = {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || credentials.refreshToken,
        idToken: tokenData.id_token || credentials.idToken
      };

      // Validate new tokens
      await this.validateTokens(newCredentials);

      // Store new credentials
      await this.credentialStorage.storeCredentials(newCredentials);

      this.logger.info('Token refresh successful');
      return newCredentials;

    } catch (error) {
      this.logger.error('Token refresh failed', error);

      // If refresh fails, clear credentials and logout
      await this.logout();
      throw error;
    }
  }

  /**
   * Restore session from stored credentials
   * @private
   */
  async restoreSession() {
    try {
      const isAuth = await this.isAuthenticated();
      if (isAuth) {
        this.logger.info('Session restored successfully');
      } else {
        this.logger.debug('No valid session to restore');
      }
    } catch (error) {
      this.logger.error('Session restoration failed', error);
      this.authenticationState = 'unauthenticated';
    }
  }

  /**
   * Setup periodic token refresh
   * @private
   */
  setupTokenRefresh() {
    setInterval(async () => {
      try {
        if (this.authenticationState === 'authenticated') {
          const credentials = await this.credentialStorage.getCredentials();
          if (credentials && await this.shouldRefreshToken(credentials.accessToken)) {
            await this.refreshTokens();
          }
        }
      } catch (error) {
        this.logger.error('Periodic token refresh failed', error);
      }
    }, 5 * 60 * 1000); // Check every 5 minutes
  }

  /**
   * Check if token should be refreshed
   * @param {string} accessToken - Access token to check
   * @returns {Promise<boolean>} True if should refresh
   * @private
   */
  async shouldRefreshToken(accessToken) {
    try {
      const payload = await this.tokenValidator.extractTokenPayload(accessToken);
      if (!payload || !payload.exp) {
        return true;
      }

      const expirationTime = payload.exp * 1000;
      const timeUntilExpiry = expirationTime - Date.now();

      return timeUntilExpiry <= this.refreshThreshold;
    } catch (error) {
      this.logger.error('Error checking token expiration', error);
      return true;
    }
  }

  /**
   * Setup extension lifecycle handlers
   * @private
   */
  setupLifecycleHandlers() {
    // Handle extension suspension
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onSuspend) {
      chrome.runtime.onSuspend.addListener(() => {
        this.logger.info('Extension suspending, preserving authentication state');
        // Don't clear credentials on suspension - they're persisted
      });
    }

    // Handle extension startup
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onStartup) {
      chrome.runtime.onStartup.addListener(() => {
        this.logger.info('Extension starting up, restoring session');
        this.restoreSession();
      });
    }
  }

  /**
   * Build OAuth authorization URL
   * @param {Object} authConfig - Auth0 configuration
   * @returns {string} Authorization URL
   * @private
   */
  buildAuthUrl(authConfig) {
    const params = new URLSearchParams({
      audience: authConfig.audience,
      client_id: authConfig.clientId,
      redirect_uri: authConfig.redirectUri,
      response_type: 'code',
      scope: 'openid profile email offline_access',
      nonce: this.generateNonce()
    });

    return `${authConfig.authUrl}?${params.toString()}`;
  }

  /**
   * Launch OAuth web auth flow
   * @param {string} authUrl - Authorization URL
   * @returns {Promise<string>} Redirect URL
   * @private
   */
  async launchOAuthFlow(authUrl) {
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow({
        url: authUrl,
        interactive: true
      }, (redirectUrl) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(redirectUrl);
        }
      });
    });
  }

  /**
   * Extract authorization code from redirect URL
   * @param {string} redirectUrl - OAuth redirect URL
   * @returns {string|null} Authorization code
   * @private
   */
  extractAuthCode(redirectUrl) {
    try {
      const url = new URL(redirectUrl);
      return url.searchParams.get('code');
    } catch (error) {
      this.logger.error('Failed to extract auth code', error);
      return null;
    }
  }

  /**
   * Exchange authorization code for tokens
   * @param {string} authCode - Authorization code
   * @returns {Promise<Object>} Token response
   * @private
   */
  async exchangeCodeForTokens(authCode) {
    const authConfig = this.config.getAuth0();

    const response = await this.httpClient.post(authConfig.tokenUrl, {
      grant_type: 'authorization_code',
      client_id: authConfig.clientId,
      code: authCode,
      redirect_uri: authConfig.redirectUri
    });

    const tokenData = await response.json();

    if (!tokenData.access_token || !tokenData.id_token) {
      throw new Error('Invalid token response');
    }

    return {
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      idToken: tokenData.id_token
    };
  }

  /**
   * Validate JWT tokens
   * @param {Object} tokens - Tokens to validate
   * @private
   */
  async validateTokens(tokens) {
    const authConfig = this.config.getAuth0();
    const jwksUrl = authConfig.jwksUrl;

    // Validate access token
    const accessTokenValidation = await this.tokenValidator.validateToken(tokens.accessToken, jwksUrl);
    if (!accessTokenValidation.valid) {
      throw new Error(`Access token validation failed: ${accessTokenValidation.reason}`);
    }

    // Validate ID token
    const idTokenValidation = await this.tokenValidator.validateToken(tokens.idToken, jwksUrl);
    if (!idTokenValidation.valid) {
      throw new Error(`ID token validation failed: ${idTokenValidation.reason}`);
    }
  }

  /**
   * Extract user data from ID token
   * @param {string} idToken - JWT ID token
   * @returns {Promise<Object>} User data
   * @private
   */
  async extractUserDataFromToken(idToken) {
    const payload = await this.tokenValidator.extractTokenPayload(idToken);

    return {
      sub: payload.sub,
      email: payload.email || 'user@example.com',
      first_name: payload.given_name || payload.name || 'User',
      last_name: payload.family_name || '',
      photo_url: payload.picture || '',
      email_verified: payload.email_verified || false
    };
  }

  /**
   * Generate secure nonce for OAuth
   * @returns {string} Random nonce
   * @private
   */
  generateNonce() {
    const array = new Uint8Array(16);
    crypto.getRandomValues(array);
    return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Add authentication observer
   * @param {IAuthenticationObserver} observer - Observer to add
   */
  addObserver(observer) {
    if (observer instanceof IAuthenticationObserver) {
      this.observers.add(observer);
    }
  }

  /**
   * Remove authentication observer
   * @param {IAuthenticationObserver} observer - Observer to remove
   */
  removeObserver(observer) {
    this.observers.delete(observer);
  }

  /**
   * Notify observers of authentication state change
   * @param {boolean} isAuthenticated - Authentication state
   * @param {Object|null} userData - User data
   * @private
   */
  notifyObservers(isAuthenticated, userData) {
    this.observers.forEach(observer => {
      try {
        observer.onAuthenticationStateChanged(isAuthenticated, userData);
      } catch (error) {
        this.logger.error('Observer notification failed', error);
      }
    });
  }

  /**
   * Notify observers of authentication error
   * @param {Error} error - Authentication error
   * @private
   */
  notifyObserversError(error) {
    this.observers.forEach(observer => {
      try {
        observer.onAuthenticationError(error);
      } catch (observerError) {
        this.logger.error('Observer error notification failed', observerError);
      }
    });
  }

  /**
   * Get authentication service statistics
   * @returns {Object} Service statistics
   */
  getStats() {
    return {
      isInitialized: this.isInitialized,
      authenticationState: this.authenticationState,
      hasCurrentUser: !!this.currentUser,
      observerCount: this.observers.size,
      isRefreshing: !!this.refreshPromise
    };
  }
}

