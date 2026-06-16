# Developer Tools Concept

**Status:** Draft  
**Last updated:** 2026-06-16

## Motivation

JSA scripts run in isolated worker threads with no direct debugger access. Developers currently rely on `ha.log()` to understand what their code is doing at runtime. While the log viewer covers the basics, more complex scripts benefit from:
- Seeing what HA events and state changes actually arrive
- Understanding which scripts consume how much CPU/memory over time
- Knowing which schedules are active and when they last fired
- A quick way to test a snippet without writing a full script file

All of these are "power user" features that would clutter the UI for casual users. They are grouped under the existing **Expert Mode** toggle (`Settings > General > Expert Mode`), which is currently disabled (`active: false` in `core/settings-schema.js`) and will be re-enabled as part of this concept.

---

## Expert Mode Toggle

**File:** `js_automations/core/settings-schema.js`  
**Change:** Set `active: true` for the `expert_mode` key.

When `expert_mode` is `false` (default): all tools described below are hidden.  
When `true`: they appear as described in **UI Integration** below.

The expert mode setting itself shows a small **DEV** pill badge in the header/status bar so the user always knows they are in expert mode.

---

## Proposed Developer Tools

### 1. Event & State Inspector

**What:** A real-time stream of HA events and state changes — filterable by entity, domain, or event type. Think browser DevTools Network tab, but for the HA event bus.

**Value:** Developers can confirm that `ha.on('light.living_room', ...)` actually fires when they flip a switch, without adding temporary log lines.

**Backend:** The worker manager already subscribes to HA state changes to serve `ha.on()`. Expose those raw payloads to the UI via a new socket event (e.g. `ha_event_stream`) that is only emitted when a connected client has the inspector open (opt-in to avoid overhead).

**UI:** New tab inside the bottom console panel (next to the existing **Logs** tab). Shows a scrollable, auto-pausing list:
```
14:23:01  state_changed   light.living_room   on → off
14:23:02  call_service    light.turn_off      { entity_id: ... }
```
Controls: domain filter, entity filter, pause/resume, clear.

---

### 2. Script Performance Dashboard

**What:** Per-script runtime metrics in one view: heap used (MB), RSS (MB), event handler invocation count, last execution duration.

**Value:** Identify memory leaks (heap grows over hours), hot handlers (fires every second), or slow callbacks.

**Backend:**
- RAM is already collected every 5 s in `worker-manager.js` (`getScriptStats()`).
- Add handler invocation counter: each `ha.on()` call increments a counter in the worker on every invocation.
- Add last execution time: wrap handler calls in `performance.now()` in `worker-wrapper.js` and send via the existing stats message.

**UI:** Table in a **Performance** sub-tab under System. Columns: Script | Heap MB | RSS MB | Handler calls | Avg exec ms | Peak exec ms. Sortable. Color-coded thresholds (yellow/red for heap > 50 MB, exec > 500 ms).

---

### 3. Scheduler Inspector

**What:** List all active `schedule()` calls across all running scripts — cron expression, next fire time, last fire time, script origin.

**Value:** Answer "why does this run at 3am?" without grepping through script files.

**Backend:** The `schedule()` wrapper in `worker-wrapper.js` registers cron jobs. Maintain a registry in `worker-manager.js` (`Map<filename, [{cron, nextRun, lastRun, description}]>`). Expose via `GET /api/debug/schedules`.

**UI:** Table in a **Schedules** sub-tab under System. Columns: Script | Cron | Next Run | Last Run. Click a row to jump to the script in the editor.

---

### 4. Live REPL / Snippet Runner

**What:** A small code editor panel where the developer can type a JS snippet and run it in a temporary, sandboxed JSA worker. The `ha` object is fully available. Output goes to the log console tagged `[REPL]`.

**Value:** Test an API call, inspect `ha.states['sensor.temperature']`, or try `ha.callService(...)` without creating a temporary script file.

**Backend:** New endpoint `POST /api/debug/repl` that spins up a short-lived worker with the snippet, captures its output (max 5 s), and streams logs back. Worker is torn down immediately after.

**UI:** Collapsible panel at the bottom alongside the log console, or a dedicated **REPL** tab under System. Monaco editor instance (~8 lines), **Run** button. Output streams into the log viewer with a `[REPL]` source tag.

---

### 5. Script Audit Log

**What:** A persistent timeline of lifecycle events per script: started, stopped, crashed (with exit reason), restarted by watchdog, config reloaded.

**Value:** Answer "did my script restart last night?" without digging through the general log.

**Backend:** `worker-manager.js` already knows about start/stop/crash events. Write them to a dedicated ring buffer (last 200 events per script) stored in `.storage/audit.json`. Expose via `GET /api/debug/audit?script=filename`.

**UI:** Small badge inline in the script list sidebar (e.g. "3 restarts today"), expanded on demand in a popover or sidebar panel section.

---

### 6. Variable Inspector

**What:** Two complementary mechanisms for inspecting variable contents in running scripts.

**`ha.watch('label', () => expression)`** — registers a live watcher. The getter is evaluated on every stats tick (every 5 s) and the result is streamed to the UI. Multiple watches per script, any expression that returns a serializable value.

```js
let counter = 0;
let lastEntity = null;

ha.watch('counter', () => counter);
ha.watch('lastEntity', () => lastEntity);
ha.watch('queue length', () => queue.length);

ha.on('sensor.*', (id, state) => {
    counter++;
    lastEntity = id;
});
```

**`ha.inspect(label, obj)`** — one-shot snapshot. Like `ha.log()` but renders an expandable, syntax-highlighted JSON tree in the log console instead of a flat string. Useful for inspecting complex objects at a specific point in time.

```js
ha.inspect('response', apiResult);
```

**Backend:**
- `ha.watch()` registrations are held in the worker and evaluated inside the existing `get_stats` message handler (already fires every 5 s). Results are added to the stats payload alongside `heapUsed` etc.
- `ha.inspect()` sends a log message with a special `type: 'inspect'` flag; the log viewer renders it as a collapsible JSON tree (e.g. using a lightweight renderer or `JSON.stringify` with indent at first, collapsible via CSS).
- Both APIs live in `worker-wrapper.js` — no new backend routes needed.

**UI:** New **WATCH** tab in the right panel of the split console. Shows a live table:

```
Script             Label           Value               Updated
mein-script.js     counter         42                  14:03:01
mein-script.js     lastEntity      sensor.temp         14:03:00
mein-script.js     queue length    3                   14:03:01
```

Rows highlight briefly when a value changes. Click a row to expand the full value (useful for objects/arrays). `ha.inspect()` output appears inline in the LOGS tab as an expandable node.

---

### 7. Breakpoints

Scripts laufen in `worker_threads` — echter Pause-and-Step-Debugger braucht das Node.js Inspector Protocol. Zwei Stufen:

#### Stufe 1: Soft Breakpoints via `ha.breakpoint()` *(realistisch, mittlerer Aufwand)*

```js
const result = await fetchData();
await ha.breakpoint('nach fetchData', { result, retries });  // pausiert hier
processResult(result);
```

`ha.breakpoint()` hält den Worker an, schickt die übergebenen Variablen an die UI und wartet auf "Continue". Technisch: `Atomics.wait()` auf einem `SharedArrayBuffer`, den `worker-manager.js` von außen beschreiben kann.

**UI:** Sobald ein Breakpoint getriggert wird, springt das rechte Panel auf einen **BREAKPOINTS**-Tab:

```
⏸  mein-script.js — "nach fetchData"  14:03:05

  result      { status: 200, data: [...] }
  retries     2

  [ ▶ Continue ]   [ ✕ Abort Script ]
```

Variablen werden als aufklappbarer JSON-Tree angezeigt (wie `ha.inspect()`). Mehrere Scripts können gleichzeitig an einem Breakpoint hängen — jeder als eigener Eintrag in der Liste. "Abort" wirft einen Error und lässt den Worker normal weiterlaufen (Watchdog greift nicht).

> **Einschränkung:** Async-Operationen, die im Hintergrund weiterlaufen (z.B. aktive `ha.on()`-Handler), werden durch den Breakpoint nicht angehalten — nur der aufrufende Call Stack pausiert.

#### Stufe 2: Node.js Inspector *(mächtig, späteres Milestone)*

Jeden Worker mit einem eigenen `--inspect`-Port starten. Die UI zeigt einen **"Open in DevTools"**-Link, der `chrome://inspect` oder ein eingebettetes DevTools-Frontend öffnet. Echter V8-Debugger: echte Breakpoints, Step Over/Into, volle Variableninspektion ohne `ha.watch()`.

Herausforderung: Port-Management pro Worker, Netzwerk-Freigabe im HA-Addon-Container. Daher als separates Milestone nach Stufe 1.

---

### 8. Dependency Graph *(future milestone)*

**What:** A visual graph showing which scripts listen to which entities, which entities are registered by which scripts, and which store keys are shared between scripts.

**Value:** Understand the "blast radius" of changing one script.

**Backend:** Static analysis of script headers (`@expose`) plus runtime tracking of `ha.on()` registrations and `ha.store` accesses.

**UI:** Force-directed graph in a **Graph** sub-tab under System. Nodes: scripts (blue), entities (orange), store keys (green). Hover shows details.

> This is the most complex tool — treat as a later milestone after the others are stable.

---

## UI Integration

All tools are hidden when `expert_mode` is off. A CSS class `.expert-mode` on `<body>` is the single gate.

The expert mode setting itself shows a small **DEV** pill badge in the header/status bar so the user always knows they are in expert mode.

### Bottom Panel — Split Console

The current `log-section` is a single pane. In expert mode it can be **split horizontally** into two side-by-side panels, each with its own tab bar:

```
┌──────────────────────────┬──────────────────────────┐
│  [ LOGS ]                │  [ EVENTS ] [ SCHEDULES] │
│                          │  [ REPL ]  [ GRAPH ]     │
│  (existing log output)   │  (expert panel content)  │
└──────────────────────────┴──────────────────────────┘
```

- **Left pane** — the existing log console (unchanged, always visible regardless of expert mode)
- **Right pane** — appears only in expert mode; has its own tab bar with:
  - **EVENTS** — Event & State Inspector stream
  - **WATCH** — Variable Inspector live table (`ha.watch()`)
  - **BREAKPOINTS** — Paused scripts with variable snapshot + Continue button
  - **SCHEDULES** — Scheduler Inspector table
  - **REPL** — Live snippet runner (Monaco mini-editor + Run button)
  - **GRAPH** — Dependency Graph *(future)*

A drag handle between the two panes allows resizing. When expert mode is off, the right pane collapses and the left pane fills the full width — no layout shift for regular users.

#### Option: Full-width footer

Currently `log-section` only spans under `main-content` (not under the sidebar). If the panels need more room, the layout can be restructured:

```
.app-wrapper  →  column layout
  .top-row    →  row layout  (sidebar | main without log-section)
  .log-section →  full width (sidebar + main combined)
```

This is a CSS-only restructure of `app-wrapper` and `main-content`. The vertical resizer drag handle moves to between `.top-row` and `.log-section`. Treat as opt-in if the content needs the space.

---

### Script List — Expert Accordion

In expert mode, each script entry in `#script-list` gets an expandable **accordion section** below the normal name/status row. Click-to-expand reveals live metrics and lifecycle info:

```
▶ mein-script.js  ●  [running]
  ┌────────────────────────────────────────┐
  │  Heap: 12 MB   Avg: 8 ms   Calls: 42  │
  │  Last started: 14:03   Restarts: 0    │
  │  Schedules: */5 * * * *  (next 14:10) │
  └────────────────────────────────────────┘
```

Content: live metrics (heap, avg exec time, handler call count), lifecycle summary (last started, restart count today), and active schedules. This replaces the originally planned dedicated "Performance Dashboard" — the data lives inline in the script list where the developer is already looking. Uses the existing WebSocket stats pipeline, no new API routes needed for the inline display.

---

### Tool → Location mapping

| Tool | Location |
|------|----------|
| Event & State Inspector | Bottom panel right pane: **EVENTS** tab |
| Variable Inspector (`ha.watch()`) | Bottom panel right pane: **WATCH** tab |
| `ha.inspect()` rich output | Inline in **LOGS** tab as collapsible JSON node |
| Breakpoints (`ha.breakpoint()`) | Bottom panel right pane: **BREAKPOINTS** tab (auto-focus on hit) |
| Scheduler Inspector | Bottom panel right pane: **SCHEDULES** tab |
| Live REPL | Bottom panel right pane: **REPL** tab |
| Script Audit Log | Script list accordion (lifecycle summary row) |
| Performance metrics | Script list accordion (heap / exec time / calls) |
| Dependency Graph | Bottom panel right pane: **GRAPH** tab *(future)* |

---

## Implementation Order

1. Re-enable `expert_mode` toggle in `core/settings-schema.js`
2. Wire `.expert-mode` CSS class to `<body>` in `public/js/settings.js` on toggle
3. Split `log-section` into two panes with horizontal resizer; right pane hidden without expert mode
4. ⭐ **Event & State Inspector** — priority 1; highest day-to-day value, mostly frontend
5. ⭐ **Live REPL** — priority 2; self-contained, no shared state concerns
6. ⭐ **Breakpoints (Stufe 1)** — priority 3; `SharedArrayBuffer` + `Atomics.wait()` in worker-wrapper, Continue via WebSocket
7. **Variable Inspector** — extends existing stats pipeline, low backend cost
8. **Script list accordion** — extend existing stats WebSocket data into the sidebar
9. **Scheduler Inspector** — small backend addition, easy win
10. **Node.js Inspector (Stufe 2)** — future milestone
8. **Dependency Graph** — future milestone

---

## Files to Touch

| File | Change |
|------|--------|
| `core/settings-schema.js` | Set `active: true` for `expert_mode` |
| `core/worker-manager.js` | Scheduler registry, audit log buffer, handler invocation counters |
| `core/worker-wrapper.js` | Wrap handler calls for exec-time measurement; expose schedule metadata |
| `routes/system-route.js` | New debug routes: `/api/debug/schedules`, `/api/debug/audit`, `/api/debug/repl` |
| `public/js/settings.js` | Apply `.expert-mode` class to `<body>` on toggle |
| `public/index.html` | Split `log-section` into left/right panes with tab bar in right pane |
| `public/css/style.css` | Split pane layout, horizontal resizer, expert-mode show/hide rules |
| `public/js/` | New modules: `event-inspector.js`, `scheduler-inspector.js`, `repl.js`; extend `script-list.js` for accordion |
| `locales/de/translation.json` + `locales/en/translation.json` | i18n keys for all new UI labels |

---

## Verification

- Enable Expert Mode in Settings → General → Expert Mode
- Confirm new tabs/panels appear in the UI; disable → all disappear
- Trigger a state change in HA → Event Inspector shows it within 1 s
- Run a script with a `schedule()` call → Scheduler Inspector lists it with next run time
- Start/stop a script → Audit log shows the lifecycle events with timestamps
- Type `ha.log('hello from repl')` in the REPL → `[REPL]` entry appears in the log console
- RAM-heavy script → Performance Dashboard shows elevated heap with color warning
