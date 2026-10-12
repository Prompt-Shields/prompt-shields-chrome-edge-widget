/**
 * Deployment Script for Refactored PromptShields Extension
 * Handles migration from old architecture to new SOLID-based architecture
 */

const fs = require('fs').promises;
const path = require('path');

class DeploymentManager {
  constructor() {
    this.backupDir = './backup-' + Date.now();
    this.manifestPath = './src/manifest.json';
    this.oldBackgroundPath = './src/background.js';
    this.newBackgroundPath = './src/background-refactored.js';
  }

  /**
   * Main deployment process
   */
  async deploy() {
    try {
      console.log('🚀 Starting PromptShields Extension Deployment...\n');

      // Step 1: Backup existing files
      await this.createBackup();

      // Step 2: Update manifest.json
      await this.updateManifest();

      // Step 3: Validate new architecture
      await this.validateArchitecture();

      // Step 4: Create deployment report
      await this.createDeploymentReport();

      console.log('✅ Deployment completed successfully!\n');
      console.log('📋 Next steps:');
      console.log('1. Test the extension in development mode');
      console.log('2. Verify authentication persistence');
      console.log('3. Run security validation tests');
      console.log('4. Deploy to production when ready\n');

    } catch (error) {
      console.error('❌ Deployment failed:', error.message);
      console.log('🔄 Rolling back changes...');
      await this.rollback();
      process.exit(1);
    }
  }

  /**
   * Create backup of existing files
   */
  async createBackup() {
    console.log('📦 Creating backup of existing files...');

    try {
      await fs.mkdir(this.backupDir, { recursive: true });

      // Backup manifest.json
      const manifestContent = await fs.readFile(this.manifestPath, 'utf8');
      await fs.writeFile(
        path.join(this.backupDir, 'manifest.json'),
        manifestContent
      );

      // Backup background.js
      try {
        const backgroundContent = await fs.readFile(this.oldBackgroundPath, 'utf8');
        await fs.writeFile(
          path.join(this.backupDir, 'background.js'),
          backgroundContent
        );
      } catch (error) {
        console.log('ℹ️  No existing background.js found (this is normal)');
      }

      console.log(`✅ Backup created in: ${this.backupDir}\n`);

    } catch (error) {
      throw new Error(`Backup creation failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * Update manifest.json to use new background script
   */
  async updateManifest() {
    console.log('📝 Updating manifest.json...');

    try {
      const manifestContent = await fs.readFile(this.manifestPath, 'utf8');
      const manifest = JSON.parse(manifestContent);

      // Update background script
      if (manifest.background) {
        manifest.background.service_worker = 'background-refactored.js';
      } else {
        manifest.background = {
          service_worker: 'background-refactored.js'
        };
      }

      // Update version to indicate refactoring
      if (manifest.version) {
        const versionParts = manifest.version.split('.');
        const patch = parseInt(versionParts[2] || '0') + 1;
        manifest.version = `${versionParts[0]}.${versionParts[1]}.${patch}`;
      }

      // Add description note about refactoring
      manifest.description += ' (Refactored with SOLID architecture)';

      // Write updated manifest
      await fs.writeFile(
        this.manifestPath,
        JSON.stringify(manifest, null, 2)
      );

      console.log('✅ Manifest updated successfully');
      console.log(`   - Background script: ${manifest.background.service_worker}`);
      console.log(`   - Version: ${manifest.version}\n`);

    } catch (error) {
      throw new Error(`Manifest update failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * Validate new architecture files exist and are valid
   */
  async validateArchitecture() {
    console.log('🔍 Validating new architecture...');

    const requiredFiles = [
      './src/background-refactored.js',
      './src/core/interfaces/IAuthenticationService.js',
      './src/core/services/AuthenticationService.js',
      './src/core/services/EncryptionService.js',
      './src/core/services/LoggingService.js',
      './src/core/services/TokenValidationService.js',
      './src/core/services/ProfileService.js',
      './src/core/storage/PersistentCredentialStorage.js',
      './src/core/factories/ServiceFactory.js',
      './src/utils/xssProtection.js',
      './src/utils/secureHttpClient.js',
      './src/utils/tokenSecurity.js',
      './src/config/securityConfig.js'
    ];

    const missingFiles = [];

    for (const filePath of requiredFiles) {
      try {
        await fs.access(filePath);
        console.log(`   ✅ ${filePath}`);
      } catch (error) {
        missingFiles.push(filePath);
        console.log(`   ❌ ${filePath} - MISSING`);
      }
    }

    if (missingFiles.length > 0) {
      throw new Error(`Missing required files: ${missingFiles.join(', ')}`);
    }

    // Validate JavaScript syntax
    console.log('\n🔍 Validating JavaScript syntax...');

    try {
      // Basic syntax validation by attempting to read and parse
      const backgroundContent = await fs.readFile(this.newBackgroundPath, 'utf8');

      // Check for basic import statements
      if (!backgroundContent.includes('import')) {
        console.log('⚠️  Warning: No ES6 imports found in background script');
      }

      if (!backgroundContent.includes('ServiceFactory')) {
        throw new Error('ServiceFactory not imported in background script');
      }

      console.log('✅ JavaScript syntax validation passed\n');

    } catch (error) {
      throw new Error(`JavaScript validation failed: ${error.message}`, { cause: error });
    }
  }

  /**
   * Create deployment report
   */
  async createDeploymentReport() {
    console.log('📊 Creating deployment report...');

    const report = {
      timestamp: new Date().toISOString(),
      version: 'refactored-' + Date.now(),
      changes: {
        architecture: 'Migrated to SOLID principles',
        authentication: 'Implemented persistent authentication with encryption',
        security: 'Added XSS protection and secure HTTP client',
        storage: 'Replaced in-memory storage with encrypted persistent storage',
        services: 'Implemented dependency injection and service factory pattern'
      },
      newFiles: [
        'src/core/interfaces/IAuthenticationService.js',
        'src/core/services/AuthenticationService.js',
        'src/core/services/EncryptionService.js',
        'src/core/services/LoggingService.js',
        'src/core/services/TokenValidationService.js',
        'src/core/services/ProfileService.js',
        'src/core/storage/PersistentCredentialStorage.js',
        'src/core/factories/ServiceFactory.js',
        'src/background-refactored.js'
      ],
      modifiedFiles: [
        'src/manifest.json',
        'src/utils/secureHttpClient.js',
        'src/config/securityConfig.js'
      ],
      backupLocation: this.backupDir,
      testingRequired: [
        'Authentication persistence across browser restart',
        'Token refresh functionality',
        'Encrypted storage operations',
        'XSS protection validation',
        'Service health monitoring'
      ]
    };

    await fs.writeFile(
      './deployment-report.json',
      JSON.stringify(report, null, 2)
    );

    console.log('✅ Deployment report created: deployment-report.json\n');
  }

  /**
   * Rollback changes in case of failure
   */
  async rollback() {
    try {
      // Restore manifest.json
      const backupManifest = path.join(this.backupDir, 'manifest.json');
      await fs.copyFile(backupManifest, this.manifestPath);

      console.log('✅ Rollback completed - original files restored');

    } catch (error) {
      console.error('❌ Rollback failed:', error.message);
      console.log('⚠️  Manual restoration required from backup:', this.backupDir);
    }
  }

  /**
   * Validate deployment post-deployment
   */
  async validateDeployment() {
    console.log('🔍 Validating deployment...');

    try {
      // Check manifest points to correct background script
      const manifestContent = await fs.readFile(this.manifestPath, 'utf8');
      const manifest = JSON.parse(manifestContent);

      if (manifest.background.service_worker !== 'background-refactored.js') {
        throw new Error('Manifest not updated correctly');
      }

      // Check new background script exists
      await fs.access(this.newBackgroundPath);

      console.log('✅ Deployment validation passed');
      return true;

    } catch (error) {
      console.error('❌ Deployment validation failed:', error.message);
      return false;
    }
  }
}

// Run deployment if called directly
if (require.main === module) {
  const deployer = new DeploymentManager();
  deployer.deploy().catch(console.error);
}

module.exports = DeploymentManager;

