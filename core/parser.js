const fs = require('fs');
const path = require('path');

/**
 * Parser module to extract metadata from the script headers.
 * It looks for JSDoc-style comments like @name, @icon, @npm.
 */
class ScriptParser {
    /**
     * Reads a file and returns an object with metadata and the raw code.
     * @param {string} filePath - Absolute path to the .js file
     */
    static parse(filePath) {
        const content = fs.readFileSync(filePath, 'utf8');
        
        // Regex patterns for our custom headers
        const patterns = {
            name: /@name\s+(.*)/,
            icon: /@icon\s+(.*)/,
            description: /@description\s+(.*)/,
            npm: /@npm\s+(.*)/
        };

        const metadata = {
            filename: path.basename(filePath),
            path: filePath,
            name: null,
            icon: 'mdi:script-text', // Default icon
            description: '',
            dependencies: []
        };

        // Extract matches
        for (const [key, regex] of Object.entries(patterns)) {
            const match = content.match(regex);
            if (match && match[1]) {
                if (key === 'npm') {
                    // Split comma-separated npm packages and trim whitespace
                    metadata.dependencies = match[1].split(',').map(d => d.trim());
                } else {
                    metadata[key] = match[1].trim();
                }
            }
        }

        // If no @name is provided, use the filename
        if (!metadata.name) {
            metadata.name = metadata.filename;
        }

        return metadata;
    }
}

module.exports = ScriptParser;