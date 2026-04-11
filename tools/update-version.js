/**
 * Synchronizes the version from package.json into config.yaml, README.md, and CHANGELOG.md.
 * Runs automatically via the npm "version" lifecycle hook (npm version patch/minor/major).
 *
 * Usage:
 *   npm version patch   → bug fix  (2.30.1 → 2.30.2)
 *   npm version minor   → feature  (2.30.1 → 2.31.0)
 *   npm version major   → breaking (2.30.1 → 3.0.0)
 *
 * What happens:
 *   1. package.json is bumped by npm.
 *   2. This script runs and updates config.yaml, README.md, CHANGELOG.md.
 *   3. npm creates a commit (including all staged files) and a git tag.
 *
 * To publish the release afterwards:
 *   npm run release
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir     = path.resolve(__dirname, '..');
const configPath  = path.join(rootDir, 'config.yaml');
const readmePath  = path.join(rootDir, 'README.md');
const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const packagePath = path.join(rootDir, 'package.json');

// --- Helpers ---

function assertContains(filePath, needle, label) {
    const content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(needle)) {
        console.error(`  ❌ ${label}: "${needle}" not found after update — regex may have missed.`);
        process.exit(1);
    }
}

function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// --- Read version ---
const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const newVersion = pkg.version;
const license    = pkg.license || 'MIT';

console.log(`\n🔄 Synchronizing version ${newVersion}...\n`);

// --- 1. config.yaml ---
let archs = [];
if (fs.existsSync(configPath)) {
    let content = fs.readFileSync(configPath, 'utf8');

    // Extract architectures using line-by-line parsing (avoids fragile multi-line regex)
    let inArch = false;
    for (const line of content.split('\n')) {
        if (/^arch:/.test(line)) { inArch = true; continue; }
        if (inArch) {
            const m = line.match(/^\s+-\s+(\S+)/);
            if (m) archs.push(m[1]);
            else if (line.trim() && !/^\s*#/.test(line)) break; // end of arch block
        }
    }

    content = content.replace(/^version:.*$/m, `version: "${newVersion}"`);
    fs.writeFileSync(configPath, content);
    assertContains(configPath, newVersion, 'config.yaml');
    console.log(`  ✅ config.yaml        → ${newVersion}`);
}

// --- 2. README.md ---
if (fs.existsSync(readmePath)) {
    let content = fs.readFileSync(readmePath, 'utf8');

    content = content.replace(/(badge\/version-)([\d.]+)(-darkgreen)/, `$1${newVersion}$3`);
    content = content.replace(/(badge\/license-)([\w.\-]+)(-blue)/, `$1${license}$3`);

    if (archs.length > 0) {
        const archString = archs.join('%20%7C%20');
        content = content.replace(/(badge\/arch-)(.*)(-lightgrey)/, `$1${archString}$3`);
    }

    fs.writeFileSync(readmePath, content);
    assertContains(readmePath, newVersion, 'README.md');
    console.log(`  ✅ README.md          → badge updated`);
}

// --- 3. CHANGELOG.md ---
if (fs.existsSync(changelogPath)) {
    let content = fs.readFileSync(changelogPath, 'utf8');
    const dateStr = today();

    // Stamp the topmost ## [...] entry with the real version + today's date.
    // Matches patterns like: ## [2.50.x], ## [Unreleased], ## [2.50.5]
    content = content.replace(
        /^(##\s*\[)[^\]]*(\])\s*-?\s*[\d-]*/m,
        `$1${newVersion}$2 - ${dateStr}`
    );

    // Prepend a fresh [Unreleased] section for the next development cycle
    if (!content.startsWith('## [Unreleased]')) {
        content = `## [Unreleased]\n\n---\n\n${content}`;
    }

    fs.writeFileSync(changelogPath, content);
    assertContains(changelogPath, newVersion, 'CHANGELOG.md');
    console.log(`  ✅ CHANGELOG.md       → [${newVersion}] - ${dateStr} finalized`);
}

// --- 4. Stage all modified files ---
// npm will create the commit + tag after this script exits.
// All staged files are included in that single commit automatically.
try {
    const filesToStage = [configPath, readmePath, changelogPath, packagePath]
        .filter(fs.existsSync)
        .map(f => `"${f}"`)
        .join(' ');
    execSync(`git add ${filesToStage}`);
    console.log(`  ➕ Staged: config.yaml, README.md, CHANGELOG.md, package.json`);
} catch (e) {
    console.error(`  ⚠️  git add failed: ${e.message}`);
}

console.log(`\n✔  Version ${newVersion} ready. Run "npm run release" to publish.\n`);
