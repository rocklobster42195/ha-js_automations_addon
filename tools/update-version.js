/**
* Dieses Skript synchronisiert die Version aus package.json mit config.yaml und README.md.
* Es wird automatisch von npm version aufgerufen, wenn die Version erhöht wird.
* Wichtig: Dieses Skript sollte vor dem Commit ausgeführt werden, damit die geänderten Dateien im selben Commit landen.
* 
* Ab jetzt musst du nie wieder Dateien manuell anfassen. Gib einfach im Terminal ein:
* npm version patch   # Für Bugfixes (2.30.1 -> 2.30.2)
* ODER
* npm version minor   # Für Features (2.30.1 -> 2.31.0)
*
* package.json wird erhöht.
* tools/update-version.js läuft und aktualisiert config.yaml & README.md.
* Ein Git Commit 2.30.2 wird erstellt (mit allen 3 Dateien).
* Ein Git Tag v2.30.2 wird erstellt.
*/

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const configPath = path.join(rootDir, 'config.yaml');
const readmePath = path.join(rootDir, 'README.md');
const packagePath = path.join(rootDir, 'package.json');
const manifestPath = path.join(rootDir, 'js_automations/integration/custom_components/js_automations/manifest.json');

// 1. Neue Version aus package.json lesen (wurde von npm bereits aktualisiert)
const pkg = require(packagePath);
const newVersion = pkg.version;
const license = pkg.license || 'MIT';
const integrationVersion = require(manifestPath).version;

console.log(`🔄 Synchronisiere Version ${newVersion}...`);

// 2. Alte Version aus config.yaml ermitteln (um sie in der README zu ersetzen)
let oldVersion = null;
let archs = [];
if (fs.existsSync(configPath)) {
    const configContent = fs.readFileSync(configPath, 'utf8');
    
    // Version finden
    const match = configContent.match(/^version: ["']?([\d\.]+)["']?/m);
    if (match) oldVersion = match[1];

    // Architekturen finden (extrahiert alle Einträge unter 'arch:')
    const archSection = configContent.match(/arch:[\s\S]*?(\s+-\s+.*)+/);
    if (archSection) {
        archs = archSection[0].split('\n').filter(line => line.includes('-')).map(line => line.replace('-', '').trim());
    }
}

// 3. config.yaml aktualisieren
if (fs.existsSync(configPath)) {
    let content = fs.readFileSync(configPath, 'utf8');
    // Ersetzt version: "x.x.x" durch die neue Version
    content = content.replace(/^version:.*$/m, `version: "${newVersion}"`);
    fs.writeFileSync(configPath, content);
    console.log(`✅ config.yaml aktualisiert`);
}

// 4. README.md aktualisieren
if (fs.existsSync(readmePath)) {
    let content = fs.readFileSync(readmePath, 'utf8');
    
    // Aktualisiere Add-on Version Badge
    content = content.replace(/(badge\/version-)([\d\.]+)(-darkgreen)/, `$1${newVersion}$3`);
    
    // Aktualisiere Integration Version Badge
    content = content.replace(/(badge\/integration-)([\d\.]+)(-orange)/, `$1${integrationVersion}$3`);

    // Aktualisiere Lizenz Badge
    content = content.replace(/(badge\/license-)([\w\.\-]+)(-blue)/, `$1${license}$3`);

    // Aktualisiere Architekturen Badge
    const archString = archs.join('%20%7C%20'); // URL-encoded pipe "|"
    content = content.replace(/(badge\/arch-)(.*)(-lightgrey)/, `$1${archString}$3`);

    fs.writeFileSync(readmePath, content);
    console.log(`✅ README.md Badges aktualisiert (Add-on: ${newVersion}, Integration: ${integrationVersion})`);
}

// 5. Dateien für den Commit stagen (WICHTIG für npm version)
try {
    // Fügt die geänderten Dateien zum aktuellen Commit hinzu, den npm gleich erstellt
    execSync(`git add "${configPath}" "${readmePath}"`);
    console.log(`➕ Dateien zu git hinzugefügt`);
} catch (e) {
    console.error("⚠️ Konnte git add nicht ausführen", e);
}
