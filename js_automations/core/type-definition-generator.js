// core/type-definition-generator.js
const path = require('path');
const fs = require('fs');

/**
 * Generates the entities.d.ts TypeScript definition file used by the Monaco
 * editor for IntelliSense on ha.states and ha.store.
 *
 * Triggered by HA state changes, store changes, and script registration.
 * Debounced to avoid redundant disk writes during state storms.
 */
class TypeDefinitionGenerator {
    /**
     * @param {object} haConnection  - provides isReady and states
     * @param {object} workerManager - provides storageDir, storeManager, emit()
     */
    constructor(haConnection, workerManager) {
        this.haConnection = haConnection;
        this.workerManager = workerManager;
        this._timer = null;
    }

    /**
     * Schedules a (debounced) regeneration of entities.d.ts.
     * Safe to call frequently — only the last call within 2 s triggers a write.
     */
    schedule() {
        if (this._timer) clearTimeout(this._timer);
        this._timer = setTimeout(() => this._generate(), 2000);
    }

    async _generate() {
        if (!this.haConnection.isReady) return;

        try {
            const states = this.haConnection.states || {};
            const entityIds = Object.keys(states);
            const storeData = this.workerManager.storeManager
                ? this.workerManager.storeManager.getAll()
                : {};

            const attrMapping = {
                light:         'LightAttributes',
                media_player:  'MediaPlayerAttributes',
                climate:       'ClimateAttributes',
                sensor:        'SensorAttributes',
                binary_sensor: 'HAAttributes',
            };

            let content = `/** Automatically generated entity definitions **/\n\n`;
            content += `export interface HAEntities {\n`;

            for (const id of entityIds) {
                const friendlyName = states[id].attributes?.friendly_name || '';
                const domain = id.split('.')[0];
                const attrType = attrMapping[domain] || 'HAAttributes';
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

            const filePath = path.join(this.workerManager.storageDir, 'entities.d.ts');
            fs.writeFileSync(filePath, content, 'utf8');

            this.workerManager.emit('typings_generated');
            this.workerManager.emit('log', {
                source: 'System',
                message: `Updated entities.d.ts with ${entityIds.length} entities.`,
                level: 'debug'
            });
        } catch (e) {
            this.workerManager.emit('log', {
                source: 'System',
                message: `[TypeDefinitionGenerator] Failed to generate entities.d.ts: ${e.message}`,
                level: 'error'
            });
        }
    }

    _inferType(value, depth = 0) {
        if (depth > 3)             return 'any';
        if (value === null)        return 'null';
        if (typeof value === 'string')  return 'string';
        if (typeof value === 'number')  return 'number';
        if (typeof value === 'boolean') return 'boolean';
        if (Array.isArray(value)) {
            if (value.length === 0) return 'any[]';
            return `${this._inferType(value[0], depth + 1)}[]`;
        }
        if (typeof value === 'object') {
            const keys = Object.keys(value);
            if (keys.length === 0) return 'Record<string, any>';
            let def = '{ ';
            for (const key of keys.slice(0, 10)) {
                def += `"${key}": ${this._inferType(value[key], depth + 1)}; `;
            }
            if (keys.length > 10) def += '... ';
            return def + '}';
        }
        return 'any';
    }
}

module.exports = TypeDefinitionGenerator;
