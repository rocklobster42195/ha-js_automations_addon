const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Automatically generates TypeScript definitions based on the 
 * current content of the Global Store.
 */
class StoreTypeGenerator {
    /**
     * Generates the store.d.ts file.
     * @param {Object} storeData - The complete content of store.json
     */
    static generate(storeData) {
        const lines = [
            '/** ',
            ' * AUTO-GENERATED FILE - DO NOT EDIT',
            ' * This file is generated based on the current Global Store content.',
            ' */',
            '',
            'export interface GlobalStoreSchema {'
        ];

        for (const [key, item] of Object.entries(storeData)) {
            // Extract the actual value (since we store metadata like 'owner' as well)
            const value = (item && typeof item === 'object' && 'value' in item) ? item.value : item;
            const tsType = this._mapJsonToTs(value);
            
            // Add key-value pair to the interface
            lines.push(`    "${key}": ${tsType};`);
        }

        lines.push('}');
        lines.push('');

        const targetPath = path.join(config.STORAGE_DIR, 'store.d.ts');
        fs.writeFileSync(targetPath, lines.join('\n'), 'utf8');
        return targetPath;
    }

    static _mapJsonToTs(val) {
        if (val === null) return 'null';
        if (Array.isArray(val)) return 'any[]';
        if (typeof val === 'object') return 'Record<string, any>';
        if (typeof val === 'undefined') return 'any';
        return typeof val; // 'string', 'number', 'boolean'
    }
}

module.exports = StoreTypeGenerator;