/**
 * JS AUTOMATIONS - Dependency Manager (v1.1.0)
 * Handles automatic installation of NPM packages and their TypeScript definitions.
 */
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const EventEmitter = require('events');
const ScriptHeaderParser = require('./script-header-parser');

// Extracts the bare package name, handling scoped packages (@scope/name) and version suffixes (@x.y.z).
function getPkgBaseName(dep) {
    if (dep.startsWith('@')) return '@' + dep.slice(1).split('@')[0];
    return dep.split('@')[0];
}

class DependencyManager extends EventEmitter {
    constructor(scriptsDir, storageDir) {
        super();
        this.scriptsDir = scriptsDir;
        this.storageDir = storageDir;
        this.nodeModulesPath = path.join(this.storageDir, 'node_modules');
        
        if (!fs.existsSync(this.storageDir)) {
            fs.mkdirSync(this.storageDir, { recursive: true });
        }
    }

    /**
     * Installs a list of dependencies and their corresponding @types if available.
     * @param {string[]} dependencies - List of package names.
     * @param {boolean} force - Force re-installation.
     */
    async install(dependencies, force = false) {
        if (!dependencies || !Array.isArray(dependencies) || dependencies.length === 0) return;

        const packagesToInstall = dependencies.filter(dep => {
            const pkgName = getPkgBaseName(dep);
            return force || !fs.existsSync(path.join(this.nodeModulesPath, pkgName));
        });

        if (packagesToInstall.length === 0) return;

        this.emit('log', { level: 'info', message: `Installing dependencies: ${packagesToInstall.join(', ')}` });

        try {
            // 1. Install main packages
            await this._runNpmInstall(packagesToInstall);

            // 2. Install TypeScript definitions for better IntelliSense
            await this._installTypeDefinitions(packagesToInstall);
            
        } catch (error) {
            this.emit('log', { level: 'error', message: `Dependency installation failed: ${error.message}` });
        }
    }

    /**
     * Attempts to install @types packages for the given list.
     * Missing @types packages are ignored.
     * @private
     */
    async _installTypeDefinitions(packages) {
        const typesToInstall = packages
            .map(pkg => getPkgBaseName(pkg))
            .filter(name => !name.startsWith('@types/'))
            .map(name => this._getTypePackageName(name))
            .filter(typeName => !fs.existsSync(path.join(this.nodeModulesPath, typeName)));

        if (typesToInstall.length === 0) return;

        this.emit('log', { level: 'debug', message: `Checking for type definitions: ${typesToInstall.join(', ')}` });

        for (const typePkg of typesToInstall) {
            try {
                await this._runNpmInstall([typePkg], true);
                this.emit('log', { level: 'debug', message: `Successfully installed types for ${typePkg}` });
            } catch (e) {
                // Silently ignore 404s for packages without type definitions
            }
        }
    }

    /**
     * Maps a package name to its corresponding @types package name.
     * @private
     */
    _getTypePackageName(name) {
        if (name.startsWith('@types/')) return name;
        // Handle scoped packages: @org/pkg -> org__pkg
        const normalizedName = name.startsWith('@') 
            ? name.substring(1).replace('/', '__') 
            : name;
        return `@types/${normalizedName}`;
    }

    /**
     * Helper to execute npm install.
     * @private
     */
    _runNpmInstall(packages, silent = false) {
        return new Promise((resolve, reject) => {
            const pkgList = packages.join(' ');
            const cmd = `npm install ${pkgList} --prefix "${this.storageDir}" --no-audit --no-fund --legacy-peer-deps`;

            exec(cmd, (error, stdout, stderr) => {
                if (error) {
                    if (!silent) this.emit('log', { level: 'warn', message: `NPM error: ${stderr || error.message}` });
                    return reject(error);
                }
                resolve(stdout);
            });
        });
    }

    /**
     * Helper to execute npm uninstall.
     * @private
     */
    _runNpmUninstall(packages) {
        return new Promise((resolve, reject) => {
            const pkgList = packages.join(' ');
            const cmd = `npm uninstall ${pkgList} --prefix "${this.storageDir}"`;

            exec(cmd, (error, stdout, stderr) => {
                if (error) return reject(error);
                resolve(stdout);
            });
        });
    }

    /**
     * Recursively finds all script files in the scripts directory.
     * @private
     */
    _getAllScriptFiles() {
        const files = [];
        const find = (dir) => {
            if (!fs.existsSync(dir)) return;
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    // Skip storage and node_modules to avoid deep recursion into dependencies
                    if (entry.name === '.storage' || entry.name === 'node_modules') continue;
                    find(fullPath);
                } else if (entry.name.endsWith('.js') || entry.name.endsWith('.ts')) {
                    files.push(fullPath);
                }
            }
        };
        find(this.scriptsDir);
        return files;
    }

    /**
     * Removes installed packages that are no longer referenced in any script.
     */
    async prune() {
        const pkgJsonPath = path.join(this.storageDir, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) return;

        try {
            const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
            const installedPackages = Object.keys(pkgJson.dependencies || {});
            if (installedPackages.length === 0) return;

            const scripts = this._getAllScriptFiles();
            const requiredPackages = new Set();

            // Collect all required packages from all scripts
            scripts.forEach(file => {
                const meta = ScriptHeaderParser.parse(file);
                (meta.dependencies || []).forEach(dep => {
                    const name = getPkgBaseName(dep);
                    requiredPackages.add(name);
                    requiredPackages.add(this._getTypePackageName(name));
                });
            });

            const toRemove = installedPackages.filter(pkg => !requiredPackages.has(pkg));

            if (toRemove.length > 0) {
                this.emit('log', { level: 'info', message: `Pruning unused dependencies: ${toRemove.join(', ')}` });
                await this._runNpmUninstall(toRemove);
            }
        } catch (e) {
            this.emit('log', { level: 'error', message: `Failed to prune dependencies: ${e.message}` });
        }
    }
}

module.exports = DependencyManager;