/**
 * JS AUTOMATIONS - Store Manager
 * Manages persistent global variables with usage tracking.
 */
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';

interface StoreEntry {
  value: unknown;
  owner: string | undefined;
  isSecret: boolean;
  updated: string;
  accessed: string;
}

class StoreManager extends EventEmitter {
  storeFile: string;
  data: Record<string, StoreEntry>;

  constructor(rootDir: string) {
    super();
    this.storeFile = path.join(rootDir, 'store.json');
    this.data = {};
    this.load();
  }

  load(): void {
    if (fs.existsSync(this.storeFile)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.storeFile, 'utf8'));
      } catch (e) {
        console.error('❌ Failed to load store.json');
        this.data = {};
      }
    }
  }

  save(): void {
    fs.writeFileSync(this.storeFile, JSON.stringify(this.data, null, 2));
  }

  set(key: string, value: unknown, scriptName?: string, isSecret = false): void {
    this.data[key] = {
      value: value,
      owner: scriptName,
      isSecret: isSecret === true,
      updated: new Date().toISOString(),
      accessed: new Date().toISOString(),
    };
    this.save();
    this.emit('changed', { key, item: this.data[key] });
  }

  get(key: string): unknown {
    if (this.data[key]) {
      this.data[key].accessed = new Date().toISOString();
      // We don't save immediately on read for performance reasons.
      // Data stays in RAM and save() is triggered on the next write operation.
      return this.data[key].value;
    }
    return null;
  }

  getAll(): Record<string, StoreEntry> {
    return this.data;
  }

  delete(key: string): boolean {
    if (this.data[key]) {
      delete this.data[key];
      this.save();
      this.emit('changed', { key, deleted: true });
      return true;
    }
    return false;
  }

  clear(): void {
    this.data = {};
    this.save();
    this.emit('changed', { cleared: true });
  }

  /** Deletes all variables created by a specific script. */
  pruneByOwner(scriptName: string): number {
    let count = 0;
    for (const key in this.data) {
      if (this.data[key].owner === scriptName) {
        delete this.data[key];
        count++;
      }
    }
    if (count > 0) {
      this.save();
    }
    return count;
  }
}

export = StoreManager;
