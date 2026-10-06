#!/usr/bin/env node

/**
 * Verify Build Script
 * Verifies that all required files are present in the dist folders
 */

const fs = require('fs');
const path = require('path');

function checkFileExists(filePath) {
  return fs.existsSync(filePath);
}

function verifyDistFolder(target) {
  console.log(`🔍 Verifying ${target} build...`);

  const distPath = `dist-${target}`;
  const requiredFiles = [
    'manifest.json',
    'managed_schema.json',
    'background.js',
    'content.js',
    'popup.js',
    'popup.html',
    'popup.css',
    'style.css',
    'icon16.png',
    'icon48.png',
    'icon128.png'
  ];

  const requiredFolders = [
    'images',
    'config'
  ];

  const missingFiles = [];
  const missingFolders = [];

  // Check files
  requiredFiles.forEach(file => {
    const filePath = path.join(distPath, file);
    if (!checkFileExists(filePath)) {
      missingFiles.push(file);
    }
  });

  // Check folders
  requiredFolders.forEach(folder => {
    const folderPath = path.join(distPath, folder);
    if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
      missingFolders.push(folder);
    }
  });

  // Check config files
  const configPath = path.join(distPath, 'config');
  if (fs.existsSync(configPath)) {
    const configFiles = ['messageTypes.js'];
    configFiles.forEach(file => {
      const filePath = path.join(configPath, file);
      if (!checkFileExists(filePath)) {
        missingFiles.push(`config/${file}`);
      }
    });
  }

  // Check image files
  const imagesPath = path.join(distPath, 'images');
  if (fs.existsSync(imagesPath)) {
    const imageFiles = ['analyze.png', 'anonymous-user.svg', 'ps-icon.svg', 'shield-check.svg', 'shield-warning.svg'];
    imageFiles.forEach(file => {
      const filePath = path.join(imagesPath, file);
      if (!checkFileExists(filePath)) {
        missingFiles.push(`images/${file}`);
      }
    });
  }

  console.log(`\n📊 Verification Results for ${target}:`);
  console.log(`- Required files: ${requiredFiles.length}`);
  console.log(`- Required folders: ${requiredFolders.length}`);
  console.log(`- Files found: ${requiredFiles.length - missingFiles.length}`);
  console.log(`- Folders found: ${requiredFolders.length - missingFolders.length}`);

  if (missingFiles.length > 0) {
    console.log('\n❌ Missing files:');
    missingFiles.forEach(file => console.log(`  - ${file}`));
  }

  if (missingFolders.length > 0) {
    console.log('\n❌ Missing folders:');
    missingFolders.forEach(folder => console.log(`  - ${folder}`));
  }

  if (missingFiles.length === 0 && missingFolders.length === 0) {
    console.log(`\n✅ All required files and folders present for ${target}!`);
    return true;
  } else {
    console.log(`\n⚠️  Build verification failed for ${target}`);
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const target = args[0];

  if (target && !['chrome', 'edge'].includes(target)) {
    console.error('❌ Invalid target. Use "chrome" or "edge"');
    process.exit(1);
  }

  console.log('🚀 Starting build verification...\n');

  let allPassed;

  if (target) {
    allPassed = verifyDistFolder(target);
  } else {
    // Verify both targets
    allPassed = verifyDistFolder('chrome') && verifyDistFolder('edge');
  }

  if (allPassed) {
    console.log('\n🎉 All builds verified successfully!');
  } else {
    console.log('\n❌ Build verification failed. Check the logs above.');
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { verifyDistFolder };
