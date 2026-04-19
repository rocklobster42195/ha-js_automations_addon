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
const DATA_DIR = path.join(SCRIPTS_DIR, 'data');
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
        if (!fs.existsSync(DATA_DIR)) {
            console.log(`Creating data directory at: ${DATA_DIR}`);
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
    } catch (error) {
        console.error('Failed to create necessary directories.', error);
        // Exit if we can't create essential folders
        process.exit(1);
    }
};

const HA_CONFIG_DIR = IS_ADDON ? (fs.existsSync('/homeassistant') ? '/homeassistant' : '/config') : path.resolve(__dirname, '../../ha_config_mock');

// In dev mode, JSA_DEV_WWW_DIR can point to the HA www directory via a Samba share
// (e.g. \\192.168.7.151\config\www or a mapped drive like Z:\www).
// Card files are then written directly to the real HA instance for live testing —
// Lovelace resource registration works via the existing HA WebSocket connection.
const WWW_CARDS_DIR = (!IS_ADDON && process.env.JSA_DEV_WWW_DIR)
    ? path.join(path.resolve(process.env.JSA_DEV_WWW_DIR), 'jsa-cards')
    : path.join(HA_CONFIG_DIR, 'www', 'jsa-cards');

module.exports = {
    IS_ADDON,
    SCRIPTS_DIR,
    STORAGE_DIR,
    DIST_DIR,
    LIBRARIES_DIR,
    DATA_DIR,
    ADDON_DIR,
    LOCALES_DIR,
    PUBLIC_DIR,
    PORT: process.env.PORT || 3000,
    VERSION: packageJson.version,
    ensureDirectories,
    HA_CONFIG_DIR,
    WWW_CARDS_DIR,
};
