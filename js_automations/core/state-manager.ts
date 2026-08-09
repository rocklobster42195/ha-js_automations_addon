/**
 * HA-JS-STUDIO: Phase 5.1 - State Manager
 *
 * Saves and loads the "running" state of scripts to ensure
 * persistence across server restarts.
 */

import * as fs from 'fs';
import * as path from 'path';

interface PersistedState {
  enabledScripts: string[];
}

class StateManager {
  stateFile: string;
  state: PersistedState;
  liveStates: Map<string, string>;
  entityScriptMap: Map<string, string>;

  constructor(rootDir: string) {
    this.stateFile = path.join(rootDir, 'state.json');
    this.state = { enabledScripts: [] };
    this.liveStates = new Map();
    this.entityScriptMap = new Map();
    this.load();
  }

  /** Load state from file */
  load(): void {
    if (fs.existsSync(this.stateFile)) {
      try {
        const data = fs.readFileSync(this.stateFile, 'utf8');
        this.state = JSON.parse(data);
      } catch (e) {
        console.error('❌ Failed to parse state.json, starting fresh.');
      }
    }
  }

  /** Save state to file */
  save(): void {
    try {
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2));
    } catch (e) {
      console.error('❌ Failed to save state.json:', (e as Error).message);
    }
  }

  set(entityId: string, state: string): void {
    this.liveStates.set(entityId, state);
  }

  get(entityId: string): string | undefined {
    return this.liveStates.get(entityId);
  }

  registerEntity(entityId: string, scriptName: string): void {
    this.entityScriptMap.set(entityId, scriptName);
  }

  /**
   * Removes a single entity's live state and script mapping.
   * @param entityId - The entity ID to remove.
   */
  unregisterEntity(entityId: string): void {
    this.liveStates.delete(entityId);
    this.entityScriptMap.delete(entityId);
  }

  /**
   * Removes all entity mappings associated with a specific script path.
   * @param scriptPath - The full path of the script to unregister.
   */
  unregisterScript(scriptPath: string): void {
    for (const [entityId, mappedPath] of this.entityScriptMap.entries()) {
      if (mappedPath === scriptPath) {
        this.entityScriptMap.delete(entityId);
      }
    }
  }

  getScriptNameForEntity(entityId: string): string | undefined {
    return this.entityScriptMap.get(entityId);
  }

  /** Mark a script as enabled */
  saveScriptStarted(filename: string): void {
    if (!this.state.enabledScripts.includes(filename)) {
      this.state.enabledScripts.push(filename);
      this.save();
    }
  }

  /** Mark a script as disabled */
  saveScriptStopped(filename: string): void {
    this.state.enabledScripts = this.state.enabledScripts.filter((f) => f !== filename);
    this.save();
  }

  /** Get list of all scripts that should be running */
  getEnabledScripts(): string[] {
    return this.state.enabledScripts;
  }
}

export = StateManager;
