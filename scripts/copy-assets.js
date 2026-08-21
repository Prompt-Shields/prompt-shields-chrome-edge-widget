#!/usr/bin/env node

/**
 * Copy Assets Script
 * Copies CSS files and manifest files to their respective dist folders
 */

const fs = require('fs');
const path = require('path');

function copyFile(source, destination) {
  try {
    // Ensure destination directory exists
    const destDir = path.dirname(destination);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    fs.copyFileSync(source, destination);
    console.log(`✅ Copied: ${source} → ${destination}`);
    return true;
  } catch (error) {
    console.error(`❌ Failed to copy ${source}:`, error.message);
    return false;
  }
}

function copyAssets(target) {
  console.log(`📁 Copying assets for ${target}...`);

  const distPath = `dist-${target}`;

  // Note: manifest.json, account.html, and history.html are handled by webpack
  // with environment-specific transformations - do not copy them here
  const filesToCopy = [
    { source: 'src/popup.css', dest: `${distPath}/popup.css` },
    { source: 'src/style.css', dest: `${distPath}/style.css` },
    { source: 'src/pages/history.css', dest: `${distPath}/pages/history.css` },
    { source: 'src/pages/account.css', dest: `${distPath}/pages/account.css` },
    { source: 'src/pages/settings.css', dest: `${distPath}/pages/settings.css` }
  ];

  let successCount = 0;

  filesToCopy.forEach(({ source, dest }) => {
    if (fs.existsSync(source)) {
      if (copyFile(source, dest)) {
        successCount++;
      }
    } else {
      console.warn(`⚠️  Source file not found: ${source}`);
    }
  });

  console.log(`\n📊 Copy Summary for ${target}:`);
  console.log(`- Files found: ${filesToCopy.length}`);
  console.log(`- Files copied: ${successCount}`);
  console.log(`- Files missing: ${filesToCopy.length - successCount}`);

  return successCount === filesToCopy.length;
}

function main() {
  const args = process.argv.slice(2);
  const target = args[0] || 'chrome';

  if (!['chrome', 'edge'].includes(target)) {
    console.error('❌ Invalid target. Use "chrome" or "edge"');
    process.exit(1);
  }

  console.log(`🚀 Starting asset copy for ${target}...\n`);

  const success = copyAssets(target);

  if (success) {
    console.log(`\n✅ All assets copied successfully for ${target}!`);
  } else {
    console.log(`\n⚠️  Some assets failed to copy for ${target}. Check the logs above.`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { copyAssets, copyFile };
