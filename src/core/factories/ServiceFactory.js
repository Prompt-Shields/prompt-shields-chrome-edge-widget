/**
 * Service Factory Implementation
 * Creates and configures all application services with proper dependency injection
 * Implements Factory Pattern and Dependency Inversion Principle (DIP)
 */

import { AuthenticationService } from '../services/AuthenticationService.js';
import { PersistentCredentialStorage } from '../storage/PersistentCredentialStorage.js';
import { EncryptionService } from '../services/EncryptionService.js';
import { LoggingService } from '../services/LoggingService.js';
import { TokenValidationService } from '../services/TokenValidationService.js';
import { ProfileService } from '../services/ProfileService.js';
import { secureHttpClient } from '../../utils/secureHttpClient.js';
import { config } from '../../config/config.js';

/**
 * Service factory for creating and managing application services
 * Implements Singleton pattern for service instances
 */
export class ServiceFactory {
  constructor() {
    this.services = new Map();
    this.isInitialized = false;
  }

  /**
   * Initialize the service factory
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.isInitialized) {
      return;
    }

    try {
      // Initialize configuration
      config.init();

      // Create core services in dependency order
      await this.createCoreServices();

      // Create application services
      await this.createApplicationServices();

      this.isInitialized = true;

      const logger = this.getService('logger');
      logger.info('Service factory initialized successfully');

    } catch (error) {
      console.error('Service factory initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create core infrastructure services
   * @private
   */
  async createCoreServices() {
    // Logging service (no dependencies)
    const logger = new LoggingService({
      level: this.isDevelopment() ? 'debug' : 'info',
      enableConsole: true,
      enableStorage: true,
      maxEntries: 1000
    });
    this.services.set('logger', logger);

    // Encryption service (depends on logger)
    const encryptionService = new EncryptionService(logger);
    this.services.set('encryption', encryptionService);

    // Validate encryption capability
    const isEncryptionValid = await encryptionService.validateEncryption();
    if (!isEncryptionValid) {
      throw new Error('Encryption service validation failed');
    }

    logger.info('Core services created', {
      services: ['logger', 'encryption']
    });
  }

  /**
   * Create application services with dependency injection
   * @private
   */
  async createApplicationServices() {
    const logger = this.getService('logger');
    const encryptionService = this.getService('encryption');

    // Token validation service
    const tokenValidator = new TokenValidationService(logger);
    this.services.set('tokenValidator', tokenValidator);

    // Credential storage service
    const credentialStorage = new PersistentCredentialStorage(encryptionService, logger);
    this.services.set('credentialStorage', credentialStorage);

    // Profile service
    const profileService = new ProfileService(secureHttpClient, logger, config);
    this.services.set('profileService', profileService);

    // Authentication service (depends on all above services)
    const authService = new AuthenticationService(
      credentialStorage,
      tokenValidator,
      profileService,
      secureHttpClient,
      logger,
      config
    );
    this.services.set('authentication', authService);

    logger.info('Application services created', {
      services: ['tokenValidator', 'credentialStorage', 'profileService', 'authentication']
    });
  }

  /**
   * Get service instance by name
   * @param {string} serviceName - Name of the service
   * @returns {Object} Service instance
   */
  getService(serviceName) {
    if (!this.isInitialized) {
      throw new Error('Service factory not initialized. Call initialize() first.');
    }

    const service = this.services.get(serviceName);
    if (!service) {
      throw new Error(`Service '${serviceName}' not found`);
    }

    return service;
  }

  /**
   * Check if service exists
   * @param {string} serviceName - Name of the service
   * @returns {boolean} True if service exists
   */
  hasService(serviceName) {
    return this.services.has(serviceName);
  }

  /**
   * Get all available service names
   * @returns {Array<string>} Array of service names
   */
  getServiceNames() {
    return Array.from(this.services.keys());
  }

  /**
   * Get authentication service (convenience method)
   * @returns {AuthenticationService} Authentication service instance
   */
  getAuthenticationService() {
    return this.getService('authentication');
  }

  /**
   * Get logging service (convenience method)
   * @returns {LoggingService} Logging service instance
   */
  getLoggingService() {
    return this.getService('logger');
  }

  /**
   * Get credential storage service (convenience method)
   * @returns {PersistentCredentialStorage} Credential storage service instance
   */
  getCredentialStorage() {
    return this.getService('credentialStorage');
  }

  /**
   * Get profile service (convenience method)
   * @returns {ProfileService} Profile service instance
   */
  getProfileService() {
    return this.getService('profileService');
  }

  /**
   * Check if running in development environment
   * @returns {boolean} True if development environment
   * @private
   */
  isDevelopment() {
    try {
      return config.getEnvironment() === 'dev';
    } catch (error) {
      // Fallback detection
      return typeof chrome !== 'undefined' &&
             chrome.runtime &&
             chrome.runtime.id &&
             chrome.runtime.id.length > 32;
    }
  }

  /**
   * Cleanup all services
   * @returns {Promise<void>}
   */
  async cleanup() {
    const logger = this.services.get('logger');

    try {
      logger?.info('Starting service cleanup');

      // Cleanup services in reverse dependency order
      const cleanupOrder = [
        'authentication',
        'profileService',
        'credentialStorage',
        'tokenValidator',
        'encryption'
      ];

      for (const serviceName of cleanupOrder) {
        const service = this.services.get(serviceName);
        if (service && typeof service.cleanup === 'function') {
          try {
            await service.cleanup();
            logger?.debug(`Cleaned up service: ${serviceName}`);
          } catch (error) {
            logger?.error(`Failed to cleanup service: ${serviceName}`, error);
          }
        }
      }

      this.services.clear();
      this.isInitialized = false;

      logger?.info('Service cleanup completed');

    } catch (error) {
      console.error('Service cleanup failed:', error);
    }
  }

  /**
   * Restart all services (useful for configuration changes)
   * @returns {Promise<void>}
   */
  async restart() {
    await this.cleanup();
    await this.initialize();
  }

  /**
   * Get service factory statistics
   * @returns {Object} Factory statistics
   */
  getStats() {
    const serviceStats = {};

    for (const [name, service] of this.services.entries()) {
      if (typeof service.getStats === 'function') {
        try {
          serviceStats[name] = service.getStats();
        } catch (error) {
          serviceStats[name] = { error: error.message };
        }
      } else {
        serviceStats[name] = { available: true };
      }
    }

    return {
      isInitialized: this.isInitialized,
      serviceCount: this.services.size,
      services: serviceStats,
      environment: this.isDevelopment() ? 'development' : 'production'
    };
  }

  /**
   * Health check for all services
   * @returns {Promise<Object>} Health check results
   */
  async healthCheck() {
    const results = {
      overall: 'healthy',
      services: {},
      timestamp: new Date().toISOString()
    };

    let hasUnhealthyService = false;

    for (const [name, service] of this.services.entries()) {
      try {
        if (typeof service.healthCheck === 'function') {
          results.services[name] = await service.healthCheck();
        } else {
          results.services[name] = { status: 'available' };
        }

        if (results.services[name].status !== 'healthy' &&
            results.services[name].status !== 'available') {
          hasUnhealthyService = true;
        }
      } catch (error) {
        results.services[name] = {
          status: 'error',
          error: error.message
        };
        hasUnhealthyService = true;
      }
    }

    if (hasUnhealthyService) {
      results.overall = 'degraded';
    }

    return results;
  }

  /**
   * Configure service with new settings
   * @param {string} serviceName - Name of the service
   * @param {Object} config - New configuration
   * @returns {Promise<void>}
   */
  async configureService(serviceName, config) {
    const service = this.getService(serviceName);

    if (typeof service.configure === 'function') {
      await service.configure(config);

      const logger = this.getService('logger');
      logger.info(`Service configured: ${serviceName}`, { config });
    } else {
      throw new Error(`Service '${serviceName}' does not support configuration`);
    }
  }
}

// Create singleton instance
export const serviceFactory = new ServiceFactory();

