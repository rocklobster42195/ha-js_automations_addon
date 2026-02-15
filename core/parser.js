const fs = require('fs');
const path = require('path');

class ScriptParser {
    static parse(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        const patterns = {
            name: /@name\s+(.*)/,
            icon: /@icon\s+(.*)/,
            description: /@description\s+(.*)/,
            area: /@area\s+(.*)/,
            label: /@label\s+(.*)/,
            npm: /@npm\s+(.*)/
        };
        const metadata = {
            filename: path.basename(filePath),
            path: filePath,
            name: null,
            icon: 'mdi:script-text',
            description: '',
            area: '',
            label: '',
            dependencies: []
        };
        for (const [key, regex] of Object.entries(patterns)) {
            const match = content.match(regex);
            if (match && match[1]) {
                if (key === 'npm') metadata.dependencies = match[1].split(',').map(d => d.trim());
                else metadata[key] = match[1].trim();
            }
        }
        if (!metadata.name) metadata.name = metadata.filename;
        return metadata;
    }
}
module.exports = ScriptParser;