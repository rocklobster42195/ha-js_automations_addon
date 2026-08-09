// core/type-definition-generator.ts
import * as path from 'path';
import * as fs from 'fs';

interface HAStateEntry {
  attributes?: { friendly_name?: string };
}

interface HaConnectionLike {
  isReady: boolean;
  states: Record<string, HAStateEntry>;
}

interface StoreEntry {
  value: unknown;
}

interface StoreManagerLike {
  getAll(): Record<string, StoreEntry>;
}

interface WorkerManagerLike {
  storageDir: string;
  storeManager?: StoreManagerLike;
  emit(event: string, payload?: unknown): void;
}

const ATTR_MAPPING: Record<string, string> = {
  light: 'LightAttributes',
  media_player: 'MediaPlayerAttributes',
  climate: 'ClimateAttributes',
  sensor: 'SensorAttributes',
  binary_sensor: 'HAAttributes',
};

/**
 * Generates the entities.d.ts TypeScript definition file used by the Monaco
 * editor for IntelliSense on ha.states and ha.store.
 *
 * Triggered by HA state changes, store changes, and script registration.
 * Debounced to avoid redundant disk writes during state storms.
 */
class TypeDefinitionGenerator {
  haConnection: HaConnectionLike;
  workerManager: WorkerManagerLike;
  private _timer: ReturnType<typeof setTimeout> | null;

  constructor(haConnection: HaConnectionLike, workerManager: WorkerManagerLike) {
    this.haConnection = haConnection;
    this.workerManager = workerManager;
    this._timer = null;
  }

  /**
   * Schedules a (debounced) regeneration of entities.d.ts.
   * Safe to call frequently — only the last call within 2 s triggers a write.
   */
  schedule(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._generate(), 2000);
  }

  private async _generate(): Promise<void> {
    if (!this.haConnection.isReady) return;

    try {
      const states = this.haConnection.states || {};
      const entityIds = Object.keys(states);
      const storeData = this.workerManager.storeManager ? this.workerManager.storeManager.getAll() : {};

      let content = `/** Automatically generated entity definitions **/\n\n`;
      content += `interface HAEntities {\n`;

      for (const id of entityIds) {
        const friendlyName = states[id].attributes?.friendly_name || '';
        const domain = id.split('.')[0];
        const attrType = ATTR_MAPPING[domain] || 'HAAttributes';
        content += `  /** ${friendlyName} */\n`;
        content += `  "${id}": HAState<${attrType}>;\n`;
      }

      content += `}\n\n`;

      content += `interface GlobalStoreSchema {\n`;
      for (const [key, entry] of Object.entries(storeData)) {
        if (!Object.prototype.hasOwnProperty.call(storeData, key)) continue;
        const inferredType = this._inferType(entry.value);
        content += `  /** Stored value for key "${key}" */\n`;
        content += `  "${key}": ${inferredType};\n`;
      }
      content += `}\n\n`;

      // Write atomically (temp file + rename) so a crash or restart mid-write can
      // never leave a truncated, syntactically broken entities.d.ts on disk — that
      // would break Monaco's whole type-checking program via ha-api.d.ts's reference.
      const filePath = path.join(this.workerManager.storageDir, 'entities.d.ts');
      const tmpPath = `${filePath}.tmp`;
      fs.writeFileSync(tmpPath, content, 'utf8');
      fs.renameSync(tmpPath, filePath);

      this.workerManager.emit('typings_generated');
      this.workerManager.emit('log', {
        source: 'System',
        message: `Updated entities.d.ts with ${entityIds.length} entities.`,
        level: 'debug',
      });
    } catch (e) {
      this.workerManager.emit('log', {
        source: 'System',
        message: `[TypeDefinitionGenerator] Failed to generate entities.d.ts: ${(e as Error).message}`,
        level: 'error',
      });
    }
  }

  private _inferType(value: unknown, depth = 0): string {
    if (depth > 3) return 'any';
    if (value === null) return 'null';
    if (typeof value === 'string') return 'string';
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    if (Array.isArray(value)) {
      if (value.length === 0) return 'any[]';
      return `${this._inferType(value[0], depth + 1)}[]`;
    }
    if (typeof value === 'object') {
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj);
      if (keys.length === 0) return 'Record<string, any>';
      let def = '{ ';
      for (const key of keys.slice(0, 10)) {
        def += `"${key}": ${this._inferType(obj[key], depth + 1)}; `;
      }
      if (keys.length > 10) def += '... ';
      return def + '}';
    }
    return 'any';
  }
}

export = TypeDefinitionGenerator;
