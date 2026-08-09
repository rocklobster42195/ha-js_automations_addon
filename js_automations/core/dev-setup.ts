/**
 * JS AUTOMATIONS - Developer Setup Wizard
 * Runs on first start if no .env is found.
 */
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { Writable } from 'stream';

async function run(): Promise<void> {
  let muted = false;
  const mutableStdout = new Writable({
    write: function (chunk, encoding, callback) {
      if (!muted) process.stdout.write(chunk, encoding);
      callback();
    },
  });

  const rl = readline.createInterface({
    input: process.stdin,
    output: mutableStdout,
    terminal: true,
  });

  const ask = (query: string, hidden = false): Promise<string> =>
    new Promise((resolve) => {
      rl.question(query, (answer) => {
        if (hidden) {
          muted = false;
          console.log(''); // Manual line break after hidden input
        }
        resolve(answer);
      });
      if (hidden) muted = true;
    });

  console.log('\n\x1b[36m=========================================\x1b[0m');
  console.log('\x1b[36m   JS AUTOMATIONS - DEVELOPER SETUP\x1b[0m');
  console.log('\x1b[36m=========================================\x1b[0m');
  console.log('It looks like you are running this project locally for the first time.');
  console.log("Let's configure your connection to Home Assistant.\n");

  let url = '';
  while (!url) {
    const input = await ask('\x1b[36mHome Assistant URL (e.g. http://192.168.1.5:8123):\x1b[0m ');
    const trimmed = input.trim();
    // Intentionally loose validation, not a full URL parse
    if (trimmed.startsWith('http') && trimmed.includes(':')) {
      url = trimmed.replace(/\/$/, '');
    } else {
      console.log('\x1b[90m(Must include protocol and port, e.g., http://192.168.1.5:8123)\x1b[0m');
    }
  }

  console.log('\n\x1b[90m(Go to your HA Profile > Security > Long-Lived Access Tokens)\x1b[0m');
  let token = '';
  while (!token) {
    token = await ask('\x1b[36mLong-Lived Access Token (starts with ey...):\x1b[0m ', true);
    if (!token.trim()) {
      token = '';
    } else if (!token.trim().startsWith('ey')) {
      console.log('\x1b[33m⚠️  Warning: Token usually starts with "ey".\x1b[0m');
    }
  }

  const portInput = await ask('\x1b[36mServer Port (default 3000):\x1b[0m ');
  const port = portInput.trim() || '3000';

  const envContent = `HA_URL=${url}\nHA_TOKEN=${token.trim()}\nPORT=${port}\n`;
  const envPath = path.join(__dirname, '../../.env');

  try {
    fs.writeFileSync(envPath, envContent);
    console.log('\n\x1b[32m✅ Configuration saved to .env\x1b[0m');
    console.log('\x1b[32m🚀 Starting server...\x1b[0m\n');
  } catch (e) {
    console.error('\n\x1b[31m❌ Failed to write .env file:\x1b[0m', (e as Error).message);
  }

  rl.close();
}

// Only auto-runs when executed directly (node core/dev-setup.js); when required
// as a module instead, the caller decides when to invoke run().
if (require.main === module) {
  run();
} else {
  module.exports = { run };
}
