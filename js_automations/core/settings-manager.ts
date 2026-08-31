import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import schema from './settings-schema';
import config from './config';

const SETTINGS_FILE = path.join(config.STORAGE_DIR, 'settings.json');

type SettingsData = Record<string, Record<string, unknown>>;

class SettingsManager extends EventEmitter {
  settings: SettingsData;
  private saveTimer: ReturnType<typeof setTimeout> | null;

  constructor() {
    super();
    this.settings = {};
    this.saveTimer = null;
    this.init();

    // Graceful Shutdown: Ensure pending changes are saved
    process.on('SIGTERM', () => this.save());
    process.on('SIGINT', () => this.save());
  }

  /**
   * Initializes the manager, loads existing settings or creates defaults.
   */
  init(): void {
    // Ensure the directory exists
    if (!fs.existsSync(config.STORAGE_DIR)) {
      try {
        fs.mkdirSync(config.STORAGE_DIR, { recursive: true });
      } catch (e) {
        console.error('SettingsManager: Could not create storage folder:', e);
      }
    }

    const defaults = this._getDefaultsFromSchema();

    if (fs.existsSync(SETTINGS_FILE)) {
      try {
        const fileContent = fs.readFileSync(SETTINGS_FILE, 'utf8');
        const userSettings = JSON.parse(fileContent);
        this._migrateLegacyKeys(userSettings);

        // Merge: Defaults as basis, user settings overwrite them
        // This ensures that new schema fields also end up in the settings
        this.settings = this._deepMerge(defaults, userSettings);

        // Cleanup: Remove keys that are no longer in the schema
        this._validateAndCleanup();

        // Save back once to ensure the file contains all current keys (including new ones from the schema).
        this.save();
      } catch (error) {
        console.error('SettingsManager: Error reading settings.json. Using defaults.', error);
        this.settings = defaults;
      }
    } else {
      console.log('SettingsManager: No settings.json found. Creating new from schema.');
      this.settings = defaults;
      this.save();
    }
  }

  /**
   * One-time rename of settings.versioning's github_* keys to git_* (the versioning feature was
   * generalized beyond GitHub-only). Without this, _validateAndCleanup() below would silently
   * drop an existing user's already-configured remote URL/token since the old keys no longer
   * exist in the schema — copies forward only, doesn't touch the file until the next save().
   */
  private _migrateLegacyKeys(userSettings: SettingsData): void {
    const versioning = userSettings.versioning as Record<string, unknown> | undefined;
    if (!versioning) return;
    const renames: [string, string][] = [
      ['github_enabled', 'git_enabled'],
      ['github_repo_url', 'git_repo_url'],
      ['github_token', 'git_token'],
    ];
    for (const [oldKey, newKey] of renames) {
      if (versioning[oldKey] !== undefined && versioning[newKey] === undefined) {
        versioning[newKey] = versioning[oldKey];
      }
    }
  }

  /**
   * Returns the current settings.
   */
  getSettings(): SettingsData {
    return this.settings;
  }

  /**
   * Returns the schema for the frontend.
   */
  getSchema() {
    return schema;
  }

  /**
   * [section, key] pairs for every schema field flagged `mode: 'password'` — the set that
   * gets masked on GET /api/settings, preserved when POSTed back blank/masked, and served
   * individually via the reveal endpoint.
   */
  getSecretPaths(): [string, string][] {
    const paths: [string, string][] = [];
    schema.forEach((section) => {
      section.items.forEach((item) => {
        if (item.mode === 'password') paths.push([section.id, item.key]);
      });
    });
    return paths;
  }

  /**
   * Updates the settings (partially) and saves them.
   * @param updates - The object containing the changes.
   */
  updateSettings(updates: SettingsData): SettingsData {
    this.settings = this._deepMerge(this.settings, updates);
    this._validateAndCleanup(); // Ensure no invalid keys are introduced during updates
    this.triggerSave();
    this.emit('settings_updated', this.settings);
    return this.settings;
  }

  /**
   * Starts the save timer (debounce).
   * Prevents frequent write access to the SD card (Raspberry Pi protection).
   */
  triggerSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    // Saves after 2 seconds of inactivity
    this.saveTimer = setTimeout(() => this.save(), 2000);
  }

  /**
   * Saves the current state to the file.
   */
  save(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      // Ensure directory exists before writing to prevent ENOENT
      if (!fs.existsSync(config.STORAGE_DIR)) {
        fs.mkdirSync(config.STORAGE_DIR, { recursive: true });
      }
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this.settings, null, 2));
    } catch (error) {
      console.error('SettingsManager: Save error:', error);
    }
  }

  /**
   * Extracts default values from the schema.
   */
  private _getDefaultsFromSchema(): SettingsData {
    const defaults: SettingsData = {};
    schema.forEach((category) => {
      defaults[category.id] = {};
      category.items.forEach((item) => {
        defaults[category.id][item.key] = item.default !== undefined ? item.default : null;
      });
    });
    return defaults;
  }

  /**
   * Removes all settings that are not defined in the schema.
   * Prevents "orphans" or typos from remaining in the JSON.
   */
  private _validateAndCleanup(): void {
    const validKeys: Record<string, Set<string>> = {};
    // 1. Create a map of all allowed keys per category
    schema.forEach((cat) => {
      validKeys[cat.id] = new Set(cat.items.map((i) => i.key));
    });

    // 2. Check settings
    for (const catId in this.settings) {
      // Delete if category is not in the schema
      if (!validKeys[catId]) {
        delete this.settings[catId];
        continue;
      }
      // Delete if key in category is not in the schema
      for (const key in this.settings[catId]) {
        if (!validKeys[catId].has(key)) {
          delete this.settings[catId][key];
        }
      }
    }
  }

  /**
   * Helper function for deep merging of objects.
   */
  private _deepMerge(target: Record<string, any>, source: Record<string, any>): any {
    const output = Object.assign({}, target);
    if (
      target &&
      typeof target === 'object' &&
      !Array.isArray(target) &&
      source &&
      typeof source === 'object' &&
      !Array.isArray(source)
    ) {
      Object.keys(source).forEach((key) => {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
          if (!(key in target)) Object.assign(output, { [key]: source[key] });
          else output[key] = this._deepMerge(target[key], source[key]);
        } else {
          Object.assign(output, { [key]: source[key] });
        }
      });
    }
    return output;
  }
}

// Singleton Export
export = new SettingsManager();
