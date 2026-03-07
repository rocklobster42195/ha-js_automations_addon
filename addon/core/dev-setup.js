/**
 * JS AUTOMATIONS - Developer Setup Wizard
 * Runs on first start if no .env is found.
 */
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const { Writable } = require('stream');

async function run() {
    let muted = false;
    const mutableStdout = new Writable({
        write: function(chunk, encoding, callback) {
            if (!muted) process.stdout.write(chunk, encoding);
            callback();
        }
    });

    const rl = readline.createInterface({
        input: process.stdin,
        output: mutableStdout,
        terminal: true
    });

    const ask = (query, hidden = false) => new Promise((resolve) => {
        rl.question(query, (answer) => {
            if (hidden) {
                muted = false;
                console.log(''); // Manueller Zeilenumbruch nach versteckter Eingabe
            }
            resolve(answer);
        });
        if (hidden) muted = true;
    });

    // Header
    console.log('\n\x1b[36m=========================================\x1b[0m');
    console.log('\x1b[36m   JS AUTOMATIONS - DEVELOPER SETUP\x1b[0m');
    console.log('\x1b[36m=========================================\x1b[0m');
    console.log('It looks like you are running this project locally for the first time.');
    console.log('Let\'s configure your connection to Home Assistant.\n');

    // 1. URL Abfrage
    let url = '';
    while (!url) {
        const input = await ask('\x1b[36mHome Assistant URL (e.g. http://192.168.1.5:8123):\x1b[0m ');
        const trimmed = input.trim();
        // Einfache Validierung: Muss http(s) und Port enthalten (grob)
        if (trimmed.startsWith('http') && trimmed.includes(':')) {
            url = trimmed.replace(/\/$/, ''); // Trailing slash entfernen
        } else {
            console.log('\x1b[90m(Must include protocol and port, e.g., http://192.168.1.5:8123)\x1b[0m');
        }
    }

    // 2. Token Abfrage
    console.log('\n\x1b[90m(Go to your HA Profile > Security > Long-Lived Access Tokens)\x1b[0m');
    let token = '';
    while (!token) {
        token = await ask('\x1b[36mLong-Lived Access Token (starts with ey...):\x1b[0m ', true);
        if (!token.trim()) {
            token = ''; // Reset falls nur Leerzeichen
        } else if (!token.trim().startsWith('ey')) {
            console.log('\x1b[33m⚠️  Warning: Token usually starts with "ey".\x1b[0m');
        }
    }

    // 3. Port Abfrage
    const portInput = await ask('\x1b[36mServer Port (default 3000):\x1b[0m ');
    const port = portInput.trim() || '3000';

    // 4. .env schreiben
    const envContent = `HA_URL=${url}\nHA_TOKEN=${token.trim()}\nPORT=${port}\n`;
    const envPath = path.join(__dirname, '../../.env');
    
    try {
        fs.writeFileSync(envPath, envContent);
        console.log('\n\x1b[32m✅ Configuration saved to .env\x1b[0m');
        console.log('\x1b[32m🚀 Starting server...\x1b[0m\n');
    } catch (e) {
        console.error('\n\x1b[31m❌ Failed to write .env file:\x1b[0m', e.message);
    }
    
    rl.close();
}

// Wenn direkt aufgerufen (via node core/dev-setup.js), starte run()
if (require.main === module) {
    run();
} else {
    module.exports = { run };
}
