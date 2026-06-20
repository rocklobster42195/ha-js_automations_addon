## [2.55.0] - 2026-06-20

---

## [2.54.1] - 2026-06-17

---

## [2.54.0] - 2026-06-17

### We See You

Expert Mode just got a full developer toolbox — built for the moments when `ha.log()` isn't enough.

---

#### Event Inspector
A live stream of every HA state change and event hitting your scripts. Hit Play, flip a switch, watch it land. Filter by entity or event type, pause when things get busy.

#### REPL
A Monaco editor tab with full `ha.*` API access and snippet support. Test a service call, inspect a state, try something quick — without creating a script file.

#### Breakpoints
Pause a running script mid-execution and inspect variables in the UI. Click **Continue** to resume. Auto-resumes after 60 seconds.

```js
ha.breakpoint('before decision', { temp, threshold, isWarm });
```

> Breakpoints only activate when the script's log level is set to `debug`.

#### Watch & Inspect
Two non-blocking debug tools in the **WATCH** tab:

- **`ha.watch(label, fn)`** — live expression that re-evaluates on every state change. Entity icons auto-detected from state objects.
- **`ha.inspect(label, vars)`** — one-shot variable snapshot, timestamped, non-blocking.

```js
ha.watch('Shelly Plug', () => ha.getState('switch.shelly_plug_s'));
ha.watch('Lights on', () => ha.select('light.*').where(s => s.state === 'on').count);
ha.inspect('snapshot', { temp, motion, ts: new Date().toISOString() });
```

> `ha.inspect()` only activates when the script's log level is set to `debug`.

All tools are gated behind **Expert Mode** (Settings → General).
