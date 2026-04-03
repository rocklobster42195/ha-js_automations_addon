// core/config.js
const path = require('path');
const fs = require('fs');
const packageJson = require('../../package.json');

const IS_ADDON = !!process.env.SUPERVISOR_TOKEN;

// The root of the addon source code (where public, locales, etc. live)
const ADDON_DIR = path.join(__dirname, '..');

// Base Directories
const SCRIPTS_DIR = IS_ADDON ? '/config/js-automations' : path.resolve(__dirname, '../../scripts');
const STORAGE_DIR = path.join(SCRIPTS_DIR, '.storage');
const DIST_DIR = path.join(STORAGE_DIR, 'dist');
const LIBRARIES_DIR = path.join(SCRIPTS_DIR, 'libraries');
const LOCALES_DIR = path.join(ADDON_DIR, 'locales');
const PUBLIC_DIR = path.join(ADDON_DIR, 'public');

/**
 * Ensures that the necessary script and storage directories exist.
 * This is crucial for both addon and local development modes.
 */
const ensureDirectories = () => {
    try {
        if (!fs.existsSync(SCRIPTS_DIR)) {
            console.log(`Creating scripts directory at: ${SCRIPTS_DIR}`);
            fs.mkdirSync(SCRIPTS_DIR, { recursive: true });
        }
        if (!fs.existsSync(STORAGE_DIR)) {
            console.log(`Creating storage directory at: ${STORAGE_DIR}`);
            fs.mkdirSync(STORAGE_DIR, { recursive: true });
        }
        if (!fs.existsSync(DIST_DIR)) {
            console.log(`Creating dist directory at: ${DIST_DIR}`);
            fs.mkdirSync(DIST_DIR, { recursive: true });
        }
        if (!fs.existsSync(LIBRARIES_DIR)) {
            console.log(`Creating libraries directory at: ${LIBRARIES_DIR}`);
            fs.mkdirSync(LIBRARIES_DIR, { recursive: true });
        }
    } catch (error) {
        console.error('Failed to create necessary directories.', error);
        // Exit if we can't create essential folders
        process.exit(1);
    }
};

module.exports = {
    IS_ADDON,
    SCRIPTS_DIR,
    STORAGE_DIR,
    DIST_DIR,
    LIBRARIES_DIR,
    ADDON_DIR,
    LOCALES_DIR,
    PUBLIC_DIR,
    PORT: process.env.PORT || 3000,
    VERSION: packageJson.version,
    ensureDirectories,
    // Centralized path for HA configuration
    HA_CONFIG_DIR: IS_ADDON ? (fs.existsSync('/homeassistant') ? '/homeassistant' : '/config') : path.resolve(__dirname, '../../ha_config_mock'),
};
