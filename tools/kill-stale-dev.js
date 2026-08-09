/**
 * predev cleanup (Windows only, no-op elsewhere).
 *
 * Stopping `npm run dev` (Ctrl+C, closing the terminal, a task-manager kill,
 * an IDE "stop" button, ...) does not reliably terminate the whole
 * npm -> concurrently -> nodemon -> node.exe process chain on Windows -
 * nodemon's own spawned server.js child can survive as an orphan holding
 * port 3000 indefinitely, so the *next* `npm run dev` hits EADDRINUSE
 * immediately. Confirmed by live testing 2026-08-09: a plain top-level kill
 * left the grandchild `node.exe js_automations/server.js` running minutes
 * later; only an explicit `taskkill /T` (full tree) actually took it down.
 *
 * Rather than relying on every possible stop mechanism to clean up after
 * itself, this runs before every `npm run dev` and kills only a process
 * whose command line unambiguously matches this app's own dev server -
 * never a blanket "kill all node.exe" (this machine also runs unrelated
 * Node processes, e.g. Stream Deck plugins).
 */
if (process.platform !== 'win32') {
  process.exit(0);
}

const { execFileSync } = require('child_process');

function findStalePids() {
  const psCommand = [
    'Get-CimInstance Win32_Process -Filter "Name=\'node.exe\'"',
    '| Where-Object { $_.CommandLine -like "*server.js*" -and $_.CommandLine -like "*js_automations*" }',
    '| Select-Object -ExpandProperty ProcessId',
  ].join(' ');

  const output = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psCommand], {
    encoding: 'utf8',
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d+$/.test(line));
}

try {
  const pids = findStalePids();
  if (pids.length === 0) {
    process.exit(0);
  }
  for (const pid of pids) {
    console.log(`⚠️  Killing stale dev-server process from a previous run (PID ${pid})...`);
    try {
      execFileSync('taskkill', ['/F', '/PID', pid]);
    } catch {
      // Already gone between the scan and the kill - fine.
    }
  }
} catch (e) {
  // Never block `npm run dev` over a cleanup failure - worst case the
  // EADDRINUSE retry in server.ts still catches a lingering port.
  console.warn(`⚠️  Stale dev-server cleanup skipped: ${e instanceof Error ? e.message : e}`);
}
