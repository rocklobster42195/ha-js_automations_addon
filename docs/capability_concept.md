# Concept: Script Capability & Permission Transparency

## Introduction

Scripts in JS Automations run as unsandboxed Node.js Worker Threads. A user who imports a script from a GitHub Gist today has no way of knowing whether it makes outbound HTTP requests, writes to the filesystem, or calls HA services that mutate state. The Capability System closes that gap.

This is a **transparency feature, not a sandbox**. No script is blocked by default. The goal is *informed trust*: when a user looks at the script list, they instantly see what a script is doing. When they import a foreign script, they see a capability preview before anything lands on disk.

For `ha.fs` and `network` access, enforcement is also possible — and recommended as an opt-in mechanism. Both can be fully blocked: `ha.fs` because we control its injection, network traffic because we can hook `Module._load` to intercept Node's built-in HTTP modules before user code loads them.

### What does a user see?

A script that fetches electricity prices and writes a CSV log, with its `@permission` tag properly declared, would show:

```
[⚡ Energy Monitor]
[JS] [🌐] [✏] ▶ ⟳ 🗑
      ↑    ↑
    gray  gray   ← declared, everything expected
```

Without the `@permission` tag, the same script shows the badges in **warning amber** — flagging that the script uses capabilities the author didn't disclose.

---

## 1. The `@permission` Header Tag

### Syntax

The tag follows the existing comma-separated multi-value convention used by `@npm` and `@include`:

```js
/**
 * @name         Energy Monitor
 * @icon         mdi:lightning-bolt
 * @description  Fetches spot prices hourly and logs them to CSV.
 * @label        Energy
 * @permission   network, fs:write
 * @npm          axios
 */
```

Values are comma- and/or-space-separated, case-insensitive, deduplicated automatically.

### Defined Tokens (Current)

| Token | Meaning |
| :--- | :--- |
| `network` | Makes outbound HTTP/HTTPS requests (fetch, axios, http, got, …) |
| `fs:read` | Reads files via `ha.fs` (read, list, stat, exists, watch) |
| `fs:write` | Creates, overwrites, appends, moves, rotates, or deletes files via `ha.fs` |
| `fs` | Shorthand alias — expands to `fs:read` + `fs:write` |
| `exec` | Executes shell commands via `child_process` (exec, spawn, execFile, …) |

### Validation Rules

- Unknown tokens are silently ignored (forward compatibility — scripts declaring future tokens still parse fine today).
- An empty `@permission` tag is valid and equivalent to omitting it.
- Duplicates are deduplicated silently after normalization.
- The parser emits `metadata.permissions: string[]` (default `[]`).

### Full Example

```js
/**
 * @name         Camera Archive
 * @icon         mdi:cctv
 * @description  Saves motion snapshots to /media and prunes files older than 7 days.
 * @permission   network, fs:write, exec
 */

const snapshot = await fetch(CAMERA_URL).then(r => r.buffer());
await ha.fs.write(`media://doorbell/${Date.now()}.jpg`, snapshot);

const files = await ha.fs.list('media://doorbell/');
for (const f of files) {
  const { modified } = await ha.fs.stat(`media://doorbell/${f}`);
  if (Date.now() - modified.getTime() > 7 * 86_400_000)
    await ha.fs.delete(`media://doorbell/${f}`);
}
```

---

## 2. Static Analysis (Auto-Detection)

Scripts are analyzed automatically on every list refresh. No `@permission` tag is required — detection works on any script, including scripts that predate this feature.

### Implementation

A new module `core/capability-analyzer.js` performs regex-based analysis over the script source. Before running patterns, the JSDoc header block is stripped (to avoid matching example code in `@description`). Inline `//` comments are also stripped to avoid false positives from commented-out code.

AST parsing (Acorn, Babel) was considered and rejected: it requires additional dependencies, complicates TypeScript handling, and has the same false-negative rate as regex for the detection targets defined here — which are all well-defined surface patterns in user-written automation scripts.

### Detection Patterns

**`network`** — outbound HTTP/HTTPS:
```
fetch(
require('http') / require('https')
require('axios') / import axios / axios.get( / axios.post(
require('node-fetch') / import('node-fetch')
require('got') / got(
new XMLHttpRequest
```

**`fs:read`** — ha.fs read-class operations:
```
ha.fs.read(
ha.fs.list(
ha.fs.stat(
ha.fs.exists(
ha.fs.watch(
```

**`fs:write`** — ha.fs mutate-class operations:
```
ha.fs.write(
ha.fs.append(
ha.fs.delete(
ha.fs.move(
ha.fs.rotate(
```

**`exec`** — shell execution via child_process:
```
require('child_process')
import('child_process')
exec(
execSync(
spawn(
spawnSync(
execFile(
execFileSync(
```

### Public API

```js
// core/capability-analyzer.js
CapabilityAnalyzer.analyze(source)
// → { detected: string[] }

CapabilityAnalyzer.diff(declared, detected)
// → { undeclared: string[], unused: string[] }
//   undeclared: detected but not in @permission (→ warning badge)
//   unused: in @permission but not detected (informational, no warning)
```

### Performance

Scripts are typically 50–500 lines; a full list of 20 scripts totals ~50 KB of source. Regex matching on this volume runs in under 1 ms. No caching layer is needed.

---

## 3. Enforcement Model

This is where `ha.fs` and the `@permission` tag go beyond pure transparency.

### Enforcement Levels by Capability

| Capability | Enforcement possible | Mechanism |
| :--- | :--- | :--- |
| `fs:read` | **Yes — full** | We control `ha.fs` injection into the worker |
| `fs:write` | **Yes — full** | Same |
| `network` | **Yes — full** | `Module._load` hook + `globalThis.fetch` override |
| `exec` | **Yes — full** | `Module._load` hook for `child_process` |
| `ha:service` | **Yes — future** | We wrap `ha.call()` |
| `ha:entity:write` | **Yes — future** | We wrap `ha.register()` / `ha.update()` |
| `ha:notify` | **Yes — future** | We wrap `ha.notify()` |
| `schedule` | **Yes — future** | We wrap `schedule()` |

### `ha.fs` Enforcement

Since `ha.fs` is an API object injected by the addon — not a built-in Node module — enforcement is clean and explicit.

**Default behavior (enforcement disabled):** `ha.fs` works regardless of `@permission` tags. Detection is transparency-only.

**Enforcement mode (opt-in, set in addon settings):** When enabled, calling an `ha.fs` method without the corresponding `@permission` token throws a `PermissionDeniedError`:

```
PermissionDeniedError: ha.fs.write() requires @permission fs:write in your script header.
```

The check lives in the `ha.fs` object factory in `worker-wrapper.js`.

### Network Enforcement (Full)

Network traffic can be fully blocked via two complementary mechanisms applied in `worker-wrapper.js` before user code is loaded:

**1. `Module._load` hook** — intercepts `require()` calls to Node's network modules:

```js
const Module = require('module');
const _orig = Module._load;
const NETWORK_MODULES = ['http', 'https', 'net', 'tls', 'dns'];

Module._load = function (request, parent, isMain) {
    if (NETWORK_MODULES.includes(request) && !permissions.includes('network')) {
        throw new Error(
            `PermissionDeniedError: Network access requires @permission network in your script header.`
        );
    }
    return _orig.apply(this, arguments);
};
```

This blocks `require('http')`, `require('https')`, `require('axios')` (which depends on http/https internally), `require('node-fetch')`, `require('got')`, and any other module that routes through Node's HTTP stack.

**2. `globalThis.fetch` override** — blocks native fetch (available in Node 18+):

```js
if (!permissions.includes('network')) {
    globalThis.fetch = () => {
        throw new Error(
            `PermissionDeniedError: Network access requires @permission network in your script header.`
        );
    };
}
```

**Trade-off:** `Module._load` is a Node.js internal API (`Module._load` on `require('module')`). It is not part of the public contract and could theoretically change between Node versions. In practice it has been stable since Node 0.x and is used by widely-deployed tools (Jest, proxyquire, nock). The risk is acceptable — but the implementation should note the Node version dependency and add a startup check.

### `exec` Enforcement (Full)

`child_process` is a Node built-in, blocked via the same `Module._load` hook:

```js
const EXEC_MODULES = ['child_process'];

// Inside Module._load:
if (EXEC_MODULES.includes(request) && !permissions.includes('exec')) {
    throw new Error(
        `PermissionDeniedError: Shell execution requires @permission exec in your script header.`
    );
}
```

This blocks all shell execution methods (`exec`, `spawn`, `execFile`, `fork`, etc.) since they all come from the same module. Unlike network, there is no second pathway to intercept — this single hook gives complete coverage.

---

## 4. UI Design

### 4.1 Script List — Badge Strip

The lower row of each list item changes from showing the filename to a badge strip with explicit alignment. The filename moves into the row tooltip (where it already appears today).

**Current lower row:**
```
[JS] waschmaschine.js                          ▶ ⟳ 🗑
```

**New lower row:**
```
[JS] [🌐] [✏]                                  ▶ ⟳ 🗑
 ↑ left-aligned                      right-aligned ↑
```

Language badge and capability badges are **left-aligned** together as a group. Script controls (play/stop, restart, delete) remain **right-aligned** as today. The filename is removed from the visible row — it is already in the tooltip and adds visual noise without value.

Layout via flexbox: the lower row is `display: flex; justify-content: space-between; align-items: center`. The badge group (`[JS] [🌐] [✏]`) sits in a `span` on the left, the action buttons remain in their existing `.row-actions` div on the right.

### 4.2 Badge Specification

Badges are **gray by default** — this is the "everything expected" state. Color only appears when something needs attention (undeclared capability).

| Capability | MDI Icon | Color (normal) | Color (warning — undeclared) |
| :--- | :--- | :--- | :--- |
| `network` | `mdi-web` | `var(--secondary-text-color)` gray | `#f0a500` amber |
| `fs:read` | `mdi-file-eye-outline` | `var(--secondary-text-color)` gray | `#f0a500` amber |
| `fs:write` | `mdi-file-edit-outline` | `var(--secondary-text-color)` gray | `#f0a500` amber |
| `exec` | `mdi-console` | `var(--secondary-text-color)` gray | `#e53935` red — elevated severity |

`exec` uses red instead of amber in warning state because undeclared shell access is the highest-severity finding.

**Collapsing rule:** When both `fs:read` and `fs:write` are detected, only the `fs:write` badge is shown (write implies read). If only one is declared but the other is also detected, the warning logic applies to the missing declaration individually.

**Declared-but-unused:** When `@permission` declares a capability that static analysis does not detect (e.g., a dynamic import the regex misses), the badge is shown at reduced opacity (`0.35`). This is informational — no color, no warning.

**Not declared and not detected:** Badge is hidden entirely. Only capabilities that are either detected or declared (or both) are rendered.

### 4.3 Color Logic Summary

```
detected + declared   → gray            (normal)
detected + undeclared → amber           (warning) — red for exec
declared + undetected → gray at 35%    (informational, dynamic import possible)
not detected + not declared → hidden   (badge not rendered)
```

### 4.4 Tooltip Content

| State | Tooltip |
| :--- | :--- |
| Declared + detected | "Network access (declared)" |
| Undeclared + detected | "Network access detected — add @permission network to your header" |
| Declared + not detected | "Declared in @permission (not detected — may use dynamic imports)" |

The row-level tooltip (`buildScriptTooltip`) also gains a Capabilities section:

```
File: energy-monitor.js (JavaScript)
State: Running
RAM: ~4.2 MB

Capabilities: network, fs:write
Undeclared: network (add @permission network)

Fetches spot prices and logs to CSV.
```

### 4.5 CSS Classes

```css
.cap-badge {
    font-size: 0.8rem;
    vertical-align: middle;
    margin-left: 4px;
    cursor: default;
    color: var(--secondary-text-color);  /* default: gray */
    opacity: 1;
}
.cap-badge-warn        { color: #f0a500; }   /* undeclared: amber */
.cap-badge-warn-exec   { color: #e53935; }   /* undeclared exec: red */
.cap-badge-unused      { opacity: 0.35; }    /* declared but not detected */
```

---

## 5. Import Preview Flow

### Current Flow

The import wizard has a URL input and a static warning: *"Only import code from trusted sources."* The user clicks Import and the script lands on disk immediately.

### New Flow — Two-Step with Capability Preview

**Step 1:** User enters a URL (unchanged). Clicking "Import" now triggers a dry-run analysis first.

**Step 2:** A preview panel appears inside the wizard before any file is written:

```
┌─────────────────────────────────────────────────────┐
│ Script Preview                                       │
│                                                      │
│  Name:        Energy Monitor                         │
│  Language:    JavaScript                             │
│  Description: Fetches spot prices and logs to CSV.  │
│                                                      │
│  Capabilities detected:                              │
│  [🌐] Network access (HTTP/fetch)                   │
│  [✏] File write access (ha.fs.write)                │
│                                                      │
│  ┌────────────────────────────────────────────────┐ │
│  │ ⚠ This script uses capabilities not declared  │ │
│  │   in its @permission header.                  │ │
│  │   Undeclared: network                         │ │
│  └────────────────────────────────────────────────┘ │
│                                                      │
│          [Confirm Import]   [Cancel]                 │
└─────────────────────────────────────────────────────┘
```

**Preview states:**

| State | Display |
| :--- | :--- |
| Loading | Spinner: "Analyzing script…" |
| No capabilities | Muted: "No network or filesystem access detected." |
| All declared | Green check: "Capabilities declared in @permission: network, fs:write" |
| Undeclared found | Amber warning box listing undeclared tokens |
| Analysis failed | Muted: "Analysis unavailable. Review source before importing." |

### Upload Tab

For the file upload tab, the preview is non-blocking: after the user selects a file, `FileReader.readAsText` fetches the content client-side and sends it to `POST /api/scripts/preview`. The preview panel appears below the dropzone before the Upload button activates. If the API call fails, the upload proceeds normally.

### API Support

`POST /api/scripts/import` gains a `dryRun: true` flag. When set, the server fetches the remote URL, runs `ScriptHeaderParser` and `CapabilityAnalyzer`, and returns preview data — without writing any file:

```json
{
  "name": "Energy Monitor",
  "description": "...",
  "language": "js",
  "permissions": ["fs:write"],
  "capabilities": {
    "detected": ["network", "fs:write"],
    "declared": ["fs:write"],
    "undeclared": ["network"]
  }
}
```

`POST /api/scripts/preview` accepts a raw `source` string in the body and performs the same analysis for the upload tab (no URL fetching needed).

---

## 6. Future Permissions Roadmap

The following tokens are planned but not yet implemented. They are defined here to reserve the namespace and allow script authors to declare them today without breaking anything (unknown tokens are silently ignored by the parser).

| Token | Meaning | Enforcement |
| :--- | :--- | :--- |
| `ha:service` | Calls `ha.call()` / HA services that mutate state | Yes — wrap `ha.call()` |
| `ha:entity:write` | Registers or updates own HA entities | Yes — wrap `ha.register()`, `ha.update()` |
| `ha:notify` | Sends notifications via `ha.notify()` / `ha.ask()` | Yes — wrap method |
| `schedule` | Uses `schedule()` for cron-based recurring tasks | Yes — wrap `schedule()` |
| `store:write` | Writes to `ha.store` (currently always allowed) | Yes — wrap `ha.store.set()` |
| `env` | Reads environment variables via `process.env` | Partial |
| `npm` | Uses external npm packages via `@npm` | Overlaps with existing `@npm` tag |

> **Note on `ha:service`:** Many legitimate automations call HA services — that's the point. This token is intended not to gate access, but to make it visible when importing foreign scripts that call services in domains the user may not expect.

> **Note on `store:write`:** Currently `ha.store` is always writable by all scripts. This token is reserved for a future mode where cross-script store access is explicitly opt-in — relevant if scripts from different authors share one instance.

---

## 7. Implementation Roadmap

### Phase 1 — Backend

1. Create `core/capability-analyzer.js` with `analyze()` and `diff()` methods.
2. Extend `ScriptHeaderParser._applyMeta` to handle `@permission` → `metadata.permissions: string[]`.
3. In `scripts-routes.js` `GET /api/scripts`, attach `capabilities` object to each metadata entry.
4. Add `dryRun` flag to `POST /api/scripts/import`.
5. Add `POST /api/scripts/preview` endpoint (raw source → capability analysis).

### Phase 2 — Script List UI

6. Add `getCapabilityBadgesHTML(capabilities)` to `script-list.js`.
7. Update `renderScripts` row template: replace filename span with badge strip.
8. Update `buildScriptTooltip()` to include capability section.
9. Add CSS classes to `style.css`.
10. Add i18n strings to `locales/en/` and `locales/de/`.

### Phase 3 — Import Wizard Preview

11. Add `showImportPreview(data)` to `creation-wizard.js`.
12. Modify import tab: first click → dry-run preview → button becomes "Confirm Import".
13. Upload tab: add auto-preview after file select (non-blocking).
14. Add preview panel CSS.

### Phase 4 — Enforcement (Optional, Settings-Gated)

15. Add `capability_enforcement` setting (default: `false`) in settings manager.
16. In `worker-wrapper.js`, before loading user code: install `Module._load` hook that blocks `http`, `https`, `net`, `tls`, `dns`, `child_process` when the corresponding permission is missing and enforcement is active.
17. Override `globalThis.fetch` in the worker when `network` is missing and enforcement is active.
18. In the `ha.fs` object factory: wrap methods to throw `PermissionDeniedError` when enforcement is active and `fs:read`/`fs:write` is missing.
19. Add enforcement toggle to Settings UI (Danger Zone section, alongside `filesystem_enabled`).

---

## 8. i18n Strings

**`locales/en/translation.json`**
```json
"cap_network":                   "Network access",
"cap_fs_read":                   "File read access",
"cap_fs_write":                  "File write access",
"cap_exec":                      "Shell execution",
"cap_tip_network":               "Network access (declared)",
"cap_tip_fs_read":               "File read access (declared)",
"cap_tip_fs_write":              "File write access (declared)",
"cap_tip_exec":                  "Shell execution (declared)",
"cap_tip_network_warn":          "Network access detected — add @permission network to your header",
"cap_tip_fs_read_warn":          "File read access detected — add @permission fs:read to your header",
"cap_tip_fs_write_warn":         "File write access detected — add @permission fs:write to your header",
"cap_tip_exec_warn":             "Shell execution detected — add @permission exec to your header",
"cap_tip_unused":                "Declared in @permission but not detected in source",
"cap_preview_title":             "Script Preview",
"cap_preview_loading":           "Analyzing script…",
"cap_preview_none":              "No special capabilities detected.",
"cap_preview_declared_ok":       "Capabilities declared in @permission:",
"cap_preview_capabilities":      "Capabilities detected:",
"cap_preview_undeclared_warning":"This script uses capabilities not declared in its @permission header.",
"cap_preview_undeclared_list":   "Undeclared:",
"cap_preview_unavailable":       "Analysis unavailable. Review source before importing.",
"cap_preview_confirm":           "Confirm Import"
```

**`locales/de/translation.json`**
```json
"cap_network":                   "Netzwerkzugriff",
"cap_fs_read":                   "Dateizugriff (lesen)",
"cap_fs_write":                  "Dateizugriff (schreiben)",
"cap_exec":                      "Shell-Ausführung",
"cap_tip_network":               "Netzwerkzugriff (deklariert)",
"cap_tip_fs_read":               "Lesezugriff auf Dateien (deklariert)",
"cap_tip_fs_write":              "Schreibzugriff auf Dateien (deklariert)",
"cap_tip_exec":                  "Shell-Ausführung (deklariert)",
"cap_tip_network_warn":          "Netzwerkzugriff erkannt — @permission network im Header ergänzen",
"cap_tip_fs_read_warn":          "Lesezugriff erkannt — @permission fs:read im Header ergänzen",
"cap_tip_fs_write_warn":         "Schreibzugriff erkannt — @permission fs:write im Header ergänzen",
"cap_tip_exec_warn":             "Shell-Ausführung erkannt — @permission exec im Header ergänzen",
"cap_tip_unused":                "In @permission deklariert, aber im Quellcode nicht erkannt",
"cap_preview_title":             "Skript-Vorschau",
"cap_preview_loading":           "Skript wird analysiert…",
"cap_preview_none":              "Keine besonderen Berechtigungen erkannt.",
"cap_preview_declared_ok":       "Berechtigungen in @permission deklariert:",
"cap_preview_capabilities":      "Erkannte Berechtigungen:",
"cap_preview_undeclared_warning":"Dieses Skript nutzt Berechtigungen, die nicht in @permission deklariert sind.",
"cap_preview_undeclared_list":   "Nicht deklariert:",
"cap_preview_unavailable":       "Analyse nicht verfügbar. Bitte Quellcode vor dem Import prüfen.",
"cap_preview_confirm":           "Import bestätigen"
```
