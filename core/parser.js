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
            loglevel: /@loglevel\s+(.*)/,
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
            loglevel: 'info',
            dependencies: []
        };

        // Zeilenweise parsen ist sicherer gegen Sternchen (*)
        const lines = content.split('\n');
        
        lines.forEach(line => {
            // Entferne Kommentazeichen und Leerzeichen am Anfang
            const cleanLine = line.replace(/^\s*\/?\*+\s?/, '').trim();
            
            for (const [key, regex] of Object.entries(patterns)) {
                // Wir testen gegen die gesäuberte Zeile
                const match = cleanLine.match(regex);
                if (match && match[1]) {
                    const val = match[1].trim();
                    if (key === 'npm') {
                        metadata.dependencies = val.split(',').map(d => d.trim()).filter(d => d.length > 0);
                    } else {
                        metadata[key] = val;
                    }
                }
            }
        });

        if (!metadata.name) metadata.name = metadata.filename;
        return metadata;
    }
}
module.exports = ScriptParser;