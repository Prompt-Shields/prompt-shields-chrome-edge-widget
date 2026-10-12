/**
 * Logging Service Implementation
 * Provides structured logging with different levels and secure output
 * Implements Single Responsibility Principle (SRP)
 */

/**
 * Production-ready logging service with security considerations
 */
export class LoggingService {
  constructor(config = {}) {
    this.config = {
      level: config.level || 'info',
      maxEntries: config.maxEntries || 1000,
      enableConsole: config.enableConsole !== false,
      enableStorage: config.enableStorage || false,
      storageKey: config.storageKey || 'ps_logs',
      sensitiveFields: config.sensitiveFields || [
        'password', 'token', 'key', 'secret', 'credential',
        'authorization', 'cookie', 'session', 'accessToken',
        'refreshToken', 'idToken'
      ]
    };

    this.levels = {
      error: 0,
      warn: 1,
      info: 2,
      debug: 3,
      trace: 4
    };

    this.currentLevel = this.levels[this.config.level] || this.levels.info;
    this.logBuffer = [];
    this.context = {};

    this.setupPeriodicCleanup();
  }

  /**
   * Set logging context (e.g., user ID, session ID)
   * @param {Object} contextData - Context data to add
   */
  setContext(contextData) {
    this.context = { ...this.context, ...contextData };
  }

  /**
   * Clear logging context
   */
  clearContext() {
    this.context = {};
  }

  /**
   * Log error message
   * @param {string} message - Log message
   * @param {Error|Object} error - Error object or additional data
   * @param {Object} metadata - Additional metadata
   */
  error(message, error = null, metadata = {}) {
    this.log('error', message, { error, ...metadata });
  }

  /**
   * Log warning message
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  warn(message, data = {}) {
    this.log('warn', message, data);
  }

  /**
   * Log info message
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  info(message, data = {}) {
    this.log('info', message, data);
  }

  /**
   * Log debug message
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  debug(message, data = {}) {
    this.log('debug', message, data);
  }

  /**
   * Log trace message
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   */
  trace(message, data = {}) {
    this.log('trace', message, data);
  }

  /**
   * Core logging method
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   * @private
   */
  log(level, message, data = {}) {
    const levelValue = this.levels[level];
    if (levelValue > this.currentLevel) {
      return; // Skip if level is too verbose
    }

    const logEntry = this.createLogEntry(level, message, data);

    // Add to buffer
    this.addToBuffer(logEntry);

    // Output to console if enabled
    if (this.config.enableConsole) {
      this.outputToConsole(logEntry);
    }

    // Store if enabled
    if (this.config.enableStorage) {
      this.storeLog(logEntry);
    }
  }

  /**
   * Create structured log entry
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} data - Additional data
   * @returns {Object} Log entry
   * @private
   */
  createLogEntry(level, message, data) {
    const timestamp = new Date().toISOString();
    const sanitizedData = this.sanitizeData(data);

    return {
      timestamp,
      level,
      message,
      data: sanitizedData,
      context: { ...this.context },
      source: 'promptshields-extension',
      version: this.getExtensionVersion()
    };
  }

  /**
   * Sanitize sensitive data from log entry
   * @param {Object} data - Data to sanitize
   * @returns {Object} Sanitized data
   * @private
   */
  sanitizeData(data) {
    if (!data || typeof data !== 'object') {
      return data;
    }

    const sanitized = {};

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();

      // Check if field contains sensitive information
      const isSensitive = this.config.sensitiveFields.some(field =>
        lowerKey.includes(field.toLowerCase())
      );

      if (isSensitive) {
        sanitized[key] = '[REDACTED]';
      } else if (value && typeof value === 'object') {
        // Recursively sanitize nested objects
        if (value instanceof Error) {
          sanitized[key] = {
            name: value.name,
            message: value.message,
            stack: value.stack
          };
        } else {
          sanitized[key] = this.sanitizeData(value);
        }
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  /**
   * Add log entry to buffer
   * @param {Object} logEntry - Log entry to add
   * @private
   */
  addToBuffer(logEntry) {
    this.logBuffer.push(logEntry);

    // Limit buffer size
    if (this.logBuffer.length > this.config.maxEntries) {
      this.logBuffer.shift(); // Remove oldest entry
    }
  }

  /**
   * Output log entry to console
   * @param {Object} logEntry - Log entry to output
   * @private
   */
  outputToConsole(logEntry) {
    const { level, message, data, timestamp } = logEntry;
    const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

    switch (level) {
    case 'error':
      console.error(prefix, message, data);
      break;
    case 'warn':
      console.warn(prefix, message, data);
      break;
    case 'info':
      console.info(prefix, message, data);
      break;
    case 'debug':
    case 'trace':
      console.log(prefix, message, data);
      break;
    default:
      console.log(prefix, message, data);
    }
  }

  /**
   * Store log entry to persistent storage
   * @param {Object} logEntry - Log entry to store
   * @private
   */
  async storeLog(logEntry) {
    try {
      // Get existing logs
      const result = await chrome.storage.local.get([this.config.storageKey]);
      const existingLogs = result[this.config.storageKey] || [];

      // Add new log
      existingLogs.push(logEntry);

      // Limit stored logs
      if (existingLogs.length > this.config.maxEntries) {
        existingLogs.splice(0, existingLogs.length - this.config.maxEntries);
      }

      // Store back
      await chrome.storage.local.set({
        [this.config.storageKey]: existingLogs
      });

    } catch (error) {
      // Fallback to console if storage fails
      console.error('Failed to store log entry:', error);
    }
  }

  /**
   * Get extension version
   * @returns {string} Extension version
   * @private
   */
  getExtensionVersion() {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        return chrome.runtime.getManifest().version;
      }
    } catch (error) {
      // Ignore error
    }
    return 'unknown';
  }

  /**
   * Get recent log entries
   * @param {number} count - Number of entries to return
   * @param {string} level - Minimum log level to include
   * @returns {Array} Recent log entries
   */
  getRecentLogs(count = 50, level = 'info') {
    const minLevel = this.levels[level] || this.levels.info;

    return this.logBuffer
      .filter(entry => this.levels[entry.level] <= minLevel)
      .slice(-count);
  }

  /**
   * Get stored logs from persistent storage
   * @param {number} count - Number of entries to return
   * @returns {Promise<Array>} Stored log entries
   */
  async getStoredLogs(count = 100) {
    try {
      if (!this.config.enableStorage) {
        return [];
      }

      const result = await chrome.storage.local.get([this.config.storageKey]);
      const logs = result[this.config.storageKey] || [];

      return logs.slice(-count);
    } catch (error) {
      this.error('Failed to retrieve stored logs', error);
      return [];
    }
  }

  /**
   * Clear all logs
   * @returns {Promise<void>}
   */
  async clearLogs() {
    try {
      // Clear buffer
      this.logBuffer = [];

      // Clear stored logs
      if (this.config.enableStorage) {
        await chrome.storage.local.remove([this.config.storageKey]);
      }

      this.info('All logs cleared');
    } catch (error) {
      this.error('Failed to clear logs', error);
    }
  }

  /**
   * Set log level
   * @param {string} level - New log level
   */
  setLevel(level) {
    if (Object.prototype.hasOwnProperty.call(this.levels, level)) {
      this.config.level = level;
      this.currentLevel = this.levels[level];
      this.info('Log level changed', { newLevel: level });
    } else {
      this.warn('Invalid log level', { level, validLevels: Object.keys(this.levels) });
    }
  }

  /**
   * Get logging statistics
   * @returns {Object} Logging statistics
   */
  getStats() {
    const levelCounts = {};
    this.logBuffer.forEach(entry => {
      levelCounts[entry.level] = (levelCounts[entry.level] || 0) + 1;
    });

    return {
      currentLevel: this.config.level,
      bufferSize: this.logBuffer.length,
      maxEntries: this.config.maxEntries,
      levelCounts,
      enableConsole: this.config.enableConsole,
      enableStorage: this.config.enableStorage
    };
  }

  /**
   * Setup periodic cleanup of old logs
   * @private
   */
  setupPeriodicCleanup() {
    // Clean up every hour
    setInterval(async () => {
      try {
        if (this.config.enableStorage) {
          const logs = await this.getStoredLogs();
          const cutoffTime = Date.now() - (24 * 60 * 60 * 1000); // 24 hours ago

          const recentLogs = logs.filter(log =>
            new Date(log.timestamp).getTime() > cutoffTime
          );

          if (recentLogs.length < logs.length) {
            await chrome.storage.local.set({
              [this.config.storageKey]: recentLogs
            });
            this.debug('Cleaned up old logs', {
              removed: logs.length - recentLogs.length
            });
          }
        }
      } catch (error) {
        console.error('Log cleanup failed:', error);
      }
    }, 60 * 60 * 1000); // 1 hour
  }

  /**
   * Export logs for debugging
   * @param {string} format - Export format ('json' or 'text')
   * @returns {Promise<string>} Exported logs
   */
  async exportLogs(format = 'json') {
    try {
      const logs = await this.getStoredLogs();

      if (format === 'text') {
        return logs.map(log =>
          `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message} ${JSON.stringify(log.data)}`
        ).join('\n');
      }

      return JSON.stringify(logs, null, 2);
    } catch (error) {
      this.error('Failed to export logs', error);
      throw error;
    }
  }
}

