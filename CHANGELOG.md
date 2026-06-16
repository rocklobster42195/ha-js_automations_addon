## We See You

Expert Mode just got a full developer toolbox — built for the moments when `ha.log()` isn't enough.

---

### Event Inspector
A live stream of every HA state change and event hitting your scripts. Hit Play, flip a switch, watch it land. Filter by entity or event type, pause when things get busy.

### REPL
A Monaco editor tab with full `ha.*` API access and snippet support. Test a service call, inspect a state, try something quick — without creating a script file.

### Breakpoints
Pause a running script mid-execution and inspect variables in the UI. Click **Continue** to resume. Auto-resumes after 60 seconds.

```js
ha.breakpoint('before decision', { temp, threshold, isWarm });
```

### Watch & Inspect
Two new non-blocking debug tools that live in the **WATCH** tab:

- **`ha.watch(label, fn)`** — registers a live expression that re-evaluates on every state change. Results appear as tiles at the top of the tab, color-coded by type. Pass a full state object and the entity's icon appears automatically.
- **`ha.inspect(label, vars)`** — sends a one-shot variable snapshot to the Inspect list below. Non-blocking, timestamped, always prepended.

```js
ha.watch('Shelly Plug', () => ha.getState('switch.shelly_plug_s'));
ha.watch('Lights on', () => ha.select('light.*').where(s => s.state === 'on').count);
ha.inspect('snapshot', { temp, motion, ts: new Date().toISOString() });
```

All tools are gated behind **Expert Mode** (Settings → General).