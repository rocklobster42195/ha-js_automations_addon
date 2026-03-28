const fs = require('fs');
const path = require('path');
const config = require('./config');

/**
 * Generiert automatisch TypeScript Definitionen basierend auf dem aktuellen
 * Inhalt des Global Stores.
 */
class StoreTypeGenerator {
    /**
     * Erzeugt die store.d.ts Datei.
     * @param {Object} storeData - Der komplette Inhalt der store.json
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
            // Wir extrahieren den echten Wert (da wir Metadaten wie 'owner' mit speichern)
            const value = (item && typeof item === 'object' && 'value' in item) ? item.value : item;
            const tsType = this._mapJsonToTs(value);
            
            // Key-Value Paar zum Interface hinzufügen
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