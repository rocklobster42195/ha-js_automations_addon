# Blockly Integration Concept

## Overview

JS Automations already supports JavaScript and TypeScript as editing modalities. Blockly adds a **third modality**: a visual block-based editor that allows non-programmers to build real automations and lets power users prototype ideas quickly — without touching any of the existing architecture.

Target users:
- Home Assistant users who want automation without writing code
- Developers prototyping trigger/action logic before committing to a full script

---

## Editing Modalities

| | `.js` | `.ts` | `.blocks` |
|---|---|---|---|
| Language | JavaScript | TypeScript | Blockly visual |
| Source of truth | `.js` file | `.ts` file | `.blocks` JSON file |
| Compiled output | – (runs directly) | `.storage/dist/script.js` | `.storage/dist/script.js` |
| Editor | Monaco | Monaco | Blockly workspace |
| Type safety | None | Full TypeScript | Block connection rules |
| Code visible | Always | Always | Via "Show Code" panel |
| Convert to JS | – | Not planned | M5: one-way, destructive |

---

## File Format: `.blocks`

Blockly 11 uses JSON as its primary serialization format (XML is legacy). JSA metadata is stored as a top-level `jsa` key alongside the Blockly workspace data.

```json
{
  "jsa": {
    "name": "Lights off when away",
    "icon": "mdi:home-export-outline",
    "description": "Turns off all lights when nobody is home",
    "expose": "",
    "loglevel": "info",
    "area": "living_room"
  },
  "blocks": {
    "languageVersion": 0,
    "blocks": [
      {
        "type": "ha_trigger_on",
        "id": "abc123",
        "x": 20,
        "y": 20,
        "fields": {
          "ENTITY_ID": "binary_sensor.presence",
          "TO_STATE": "off"
        },
        "statements": {
          "DO": {
            "block": {
              "type": "ha_call_service",
              "fields": {
                "SERVICE": "light.turn_off",
                "ENTITY_ID": "light.living_room"
              }
            }
          }
        }
      }
    ]
  }
}
```

`ScriptHeaderParser` gets a `.blocks` branch on both sides:
- `parse()` reads metadata from the `jsa` key instead of parsing a JSDoc comment
- `updateMetadata()` writes fields back into the `jsa` key (JSON.stringify) instead of prepending a `/** ... */` header — prepending a comment onto a `.blocks` file would corrupt its JSON

This reuses the existing "Edit Info" metadata modal (name/icon/description/area/label/loglevel/expose) unchanged for all three editing modes — no separate UI needed for `.blocks`.

**Why no TypeScript as intermediate?**
Visually generated code gains nothing from TypeScript — type safety comes from block connection rules enforced in the editor. Compiling directly to JS keeps the pipeline simpler and removes an unnecessary step.

---

## Architecture

```
User edits in Blockly editor (browser)
  ↓
POST /api/scripts/script.blocks/content   { content: JSON.stringify(workspace) }
  (existing endpoint, extension-agnostic — no route change needed for saving)
  ↓
BlocklyCompiler (server-side, Node.js `blockly/node` package)
  → deserializes workspace
  → runs javascriptGenerator.workspaceToCode()
  → wraps output in async IIFE
  ↓
.storage/dist/script.js
  ↓
WorkerManager → Worker Thread   (identical pipeline to TS today)
```

`.blocks` file = JSON source of truth  
`.storage/dist/script.js` = runtime artifact (same as TS → JS today)

### BlocklyCompiler (server-side)

```js
// core/blockly-compiler.js
// Verified against the installed blockly@11.2.2 package: there is no './node' subpath export
// (ERR_PACKAGE_PATH_NOT_EXPORTED) — the root entry point is already the Node/CJS build and
// comes with all built-in blocks pre-registered, no separate 'blockly/blocks' require needed.
const Blockly = require('blockly');
const { javascriptGenerator } = require('blockly/javascript');

require('./blockly-blocks-shared')(javascriptGenerator);

class BlocklyCompiler {
  async compile(blocksPath) {
    const parsed = JSON.parse(await fs.readFile(blocksPath, 'utf8'));
    const workspace = new Blockly.Workspace();
    // Pass the whole parsed file, not parsed.blocks — Blockly.serialization.workspaces.load()
    // reads its own top-level `blocks` key internally; passing parsed.blocks directly throws
    // "a is not iterable" (verified). Unrelated top-level keys like `jsa` are ignored.
    Blockly.serialization.workspaces.load(parsed, workspace);
    const code = javascriptGenerator.workspaceToCode(workspace);
    workspace.dispose();
    const distPath = this._getDistPath(blocksPath);
    await fs.writeFile(distPath, this._wrapCode(code));
    return distPath;
  }
}
```

### Shared Generator Registration

**Superseded during M2 implementation** — the ES-`import` version below doesn't work in this
project (no bundler, plain `<script>` tags; see the M2 checklist's "Architecture correction"
note for the full reasoning). Kept here only so the "why" isn't lost. The actual mechanism:

Both the block shape definitions and the generator registration function live under
`public/js/` (not `core/`), each wrapped in a tiny UMD shim (`module.exports` if present, else
a `window` global) so the *same file* is `require()`-able from Node and loadable via a plain
`<script>` tag in the browser — no bundler, no duplication:

```js
// public/js/blockly-blocks-shared.js
(function (global, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else global.registerHaBlocks = factory();
})(typeof self !== 'undefined' ? self : this, function () {
    return function registerHaBlocks(generator) {
        generator.forBlock['ha_call_service'] = (block) => { ... };
        generator.forBlock['ha_trigger_on']   = (block, gen) => { ... };
        // ... all blocks
    };
});
```

```js
// Node.js (BlocklyCompiler) — reaches across the core/public boundary with a relative path
const { javascriptGenerator } = require('blockly/javascript');
Blockly.common.defineBlocksWithJsonArray(require('../public/js/blockly-blocks'));
require('../public/js/blockly-blocks-shared')(javascriptGenerator);

// Browser (index.html) — plain script tags, no bundler
// <script src="js/blockly-blocks.js"></script>
// <script src="js/blockly-blocks-shared.js"></script>
// then, once Blockly itself is loaded:
Blockly.common.defineBlocksWithJsonArray(HA_BLOCK_DEFINITIONS);
window.registerHaBlocks(Blockly.JavaScript);
```

~~Original (incorrect) plan:~~
```js
// Browser
import { javascriptGenerator } from 'blockly/javascript';
import registerHaBlocks from './blockly-blocks-shared.js';
registerHaBlocks(javascriptGenerator);
```

---

## Block Library

Categorized by milestone. All generated code targets the current `ha.*` API surface from `ha-api.d.ts`.

### Triggers

| Block | Generated code | Milestone |
|---|---|---|
| On state change | `ha.on('entity_id', async e => { ... })` | M2 |
| On state change (filtered) | `ha.on('entity_id', e => e.state === 'on', async e => { ... })` | M2 |
| On state change (debounced) | `ha.on('entity_id', filter, { for: 5000 }, async e => { ... })` | M2 |
| On cron schedule | `schedule('0 * * * *', async () => { ... })` | M2 |
| On HA event | `ha.onEvent('event_type', async e => { ... })` | M3 |
| On MQTT message | `ha.mqtt.subscribe('topic/path', async msg => { ... })` | M3 |
| On webhook (basic) | `ha.onWebhook('id', async (req, res) => { ... })` | M4 |

### Actions

| Block | Generated code | Milestone |
|---|---|---|
| Call service | `await ha.call('light.turn_on', { entity_id: 'light.x' })` | M2 |
| Entity fluent call | `await ha.entity('light.living_room').turn_on({ brightness: 255 })` | M2 |
| Send notification | `await ha.notify('Message text')` | M2 |
| Send notification with options | `await ha.notify('Message', { title: 'Title', target: '...' })` | M2 |
| Ask (actionable notification) | `const reply = await ha.ask('Pick one', { actions: ['Yes','No'] })` | M3 |
| Publish MQTT | `await ha.mqtt.publish('topic', payload, { retain: true })` | M3 |
| HTTP GET | `const res = await ha.http.get('https://...')` | M4 |
| HTTP POST | `const res = await ha.http.post('https://...', { body })` | M4 |
| Fire HA event | `await ha.fireEvent('my_event', { data: 'value' })` | M3 |

### State

| Block | Generated code | Milestone |
|---|---|---|
| Get state | `ha.getState('sensor.temp')` | M2 |
| Get state value (numeric/bool) | `ha.getStateValue('sensor.temp')` | M2 |
| Get attribute | `ha.getAttr('climate.hall', 'temperature')` | M2 |
| Entity exists | `ha.entityExists('sensor.temp')` | M2 |
| Bulk select entities | `ha.select('light.*')` | M3 |
| Render template | `await ha.renderTemplate('{{ states("sensor.x") }}')` | M4 |
| Get history | `await ha.getHistory('sensor.temp', { hours: 24 })` | M4 |
| Get statistics | `await ha.getStatistics('sensor.temp', { period: 'hour' })` | M4 |

### Wait / Async

| Block | Generated code | Milestone |
|---|---|---|
| Wait for state | `await ha.waitFor('lock.door', e => e.state === 'locked')` | M3 |
| Wait for state with timeout | `await ha.waitFor('lock.door', filter, 0, { timeout: 10000 })` | M3 |
| Sleep | `await sleep(2000)` | M2 |

### Store / Persistence

| Block | Generated code | Milestone |
|---|---|---|
| Store get | `ha.store.get('my_key')` | M3 |
| Store set | `ha.store.set('my_key', value)` | M3 |
| Store delete | `ha.store.delete('my_key')` | M3 |
| Store on change | `ha.store.on('my_key', async val => { ... })` | M3 |
| Persistent variable | `const counter = ha.persistent('counter', 0)` | M3 |

### Areas & Labels

| Block | Generated code | Milestone |
|---|---|---|
| Get all areas | `await ha.getAreas()` | M4 |
| Get entities in area | `await ha.getEntitiesInArea('living_room')` | M4 |
| Get all labels | `await ha.getLabels()` | M4 |
| Get entities with label | `await ha.getEntitiesWithLabel('outdoor')` | M4 |
| Get floors | `await ha.getFloors()` | M4 |
| Get areas in floor | `await ha.getAreasInFloor('ground_floor')` | M4 |

### Register / Update (MQTT Discovery)

| Block | Generated code | Milestone |
|---|---|---|
| Register entity | `await ha.register('sensor.my_sensor', { device_class: 'temperature', unit: '°C' })` | M4 |
| Update entity state | `await ha.update('sensor.my_sensor', '21.5', { unit_of_measurement: '°C' })` | M4 |

### Calendar & Todo

| Block | Generated code | Milestone |
|---|---|---|
| Get calendar events | `await ha.getCalendarEvents('calendar.work', { days: 7 })` | M4 |
| Get todo items | `await ha.getTodoItems('todo.shopping')` | M4 |

### Script Utilities

| Block | Generated code | Milestone |
|---|---|---|
| Log (debug) | `ha.debug('message')` | M2 |
| Log (info) | `ha.log('message')` | M2 |
| Log (warn) | `ha.warn('message')` | M2 |
| Log (error) | `ha.error('message')` | M2 |
| Stop script | `ha.stop('reason')` | M2 |
| Restart script | `ha.restart('reason')` | M4 |
| On stop | `ha.onStop(async () => { ... })` | M4 |
| On error | `ha.onError(async err => { ... })` | M4 |
| Named action | `ha.action('my_action', async () => { ... })` | M4 |
| Get script header | `ha.getHeader('area', 'default')` | M4 |
| Localize string | `ha.localize({ en: 'Hello', de: 'Hallo' })` | M4 |

### Standard (Blockly built-in)

Available in all milestones: Logic (if/else, and/or, not, comparisons), Loops (repeat, while, for-each), Variables, Math, Text, Lists, Color.

---

## Dynamic Dropdowns

Entity and service dropdowns are populated from live HA data on workspace mount:

- **Entity IDs**: fetched from `haConnector.getStates()` via a backend endpoint (existing `GET /api/ha/states` or socket call) — cached for the session, not re-fetched per dropdown open
- **Services**: fetched from `GET /api/ha/services` — grouped by domain
- **Areas**: from `ha.getAreas()` — for area filter blocks
- **Fallback**: free-text input field when HA is not connected or data fetch fails

Dropdowns use Blockly's `FieldDropdown` with dynamic option callbacks.

---

## Permissions

`@permission` (network, webhook, exec, fs:read, fs:write) is enforced at runtime — `worker-wrapper.js` blocks `ha.http.*`/`fetch` without `network`, `ha.onWebhook()` without `webhook`, etc. It's not just a UI warning. For `.js`/`.ts` the user declares it by hand-editing the JSDoc `@permission` tag; `.blocks` has no editable raw-source surface for that (Show Code is read-only, generated *from* the blocks, not editable back into them).

Instead of a manual declaration step, `BlocklyCompiler` derives permissions automatically from a static block-type → permission map and writes the result into `jsa.permission` on every compile:

| Block type | Permission |
|---|---|
| `ha_http_get` / `ha_http_post` | `network` |
| `ha_on_webhook` | `webhook` |

This is safe specifically *because* it's Blockly: every capability-using construct is one of our own known block types, so "declared" can always be computed exactly from "used" — unlike free-form JS/TS, there's no way to reach a capability through an untracked code path. As a result `CapabilityAnalyzer`'s declared/undeclared/unused diff is trivially satisfied for `.blocks` scripts and needs no special-casing.

`@card` is not supported for `.blocks` — it requires hand-written companion card JS unrelated to automation logic, same reasoning as the `npm`/`include` exclusions below. Scripts needing a card use "Convert to JavaScript".

---

## UI Flow

1. **Create**: Wizard → select "Visual (.blocks)" → Blockly workspace opens with starter trigger block
2. **Edit**: Click script in sidebar → Blockly editor mounts; entity/service dropdowns populated from HA
3. **Save** (Ctrl+S or toolbar): Frontend sends JSON workspace as `content` to the existing `POST /:filename/content` endpoint → server compiles → worker restarts
4. **Show Code**: Toolbar button → read-only Monaco panel showing the compiled JS output (reuses existing Monaco instance)
5. **Convert to JavaScript**: "Edit as JavaScript" → warning dialog ("The visual editor will no longer be available for this script") → on confirm: compiled JS opens in Monaco as `.js`, `.blocks` file is deleted

---

## Error Handling

- `BlocklyCompiler` failures (invalid workspace, generator errors) are reported through the existing worker error channel and displayed in the frontend as error badges — identical to TypeScript compile errors today
- Pre-compile validation: if the workspace contains no trigger block, a warning is shown instead of producing silent empty code
- Runtime errors from generated scripts surface the same as any other script error

---

## NPM Dependency

```json
"blockly": "^11.2.2"
```

Verified against the installed package: Blockly 11's root entry point (`require('blockly')`) is already the Node/CJS build with all built-in blocks pre-registered — there is no separate `blockly/node` subpath (attempting to require it throws `ERR_PACKAGE_PATH_NOT_EXPORTED`). Package size: ~10–12 MB including dependencies (comparable to `typescript` + `ts-node`).

---

## Milestones

### M1 — Foundation
**Goal**: Full pipeline from `.blocks` file to running script. No custom blocks — uses Blockly's built-in blocks only to prove the round-trip works.

Deliverable: Creating, saving, enabling, and deleting a `.blocks` file works end-to-end.

- [x] Add `blockly` npm package (v11+)
- [x] `core/blockly-compiler.js` — deserialize workspace JSON → generate JS via `require('blockly')` (root entry point; no `/node` subpath — see NPM Dependency section)
- [x] `core/blockly-blocks-shared.js` — shared generator registration scaffold (empty initially)
- [x] `core/script-watcher.js` — watch `.blocks` extension, trigger BlocklyCompiler on save/delete
- [x] `core/script-header-parser.js` — `.blocks` branch in both `parse()` and `updateMetadata()` (jsa key, not JSDoc)
- [x] `core/compiler-manager.js` — `pruneDist()` also checks for a `.blocks` source before deleting an orphaned dist file
- [x] `core/kernel.js` — instantiate `BlocklyCompiler`, forward its `log`/`compiler_signal` events, initial compile pass over `.blocks` files at startup (mirrors the existing TS pass)
- [x] `core/entity-manager.js` — thread `blocklyCompiler` through to `ScriptWatcher` (constructor param)
- [x] `core/worker-manager.js` — **not in the original plan, found while implementing.** `getScripts()` only listed `.js`/`.ts`; `startScript()` hardcoded `.ts` → dist-path redirection. Both needed a `.blocks` branch or a `.blocks` script would never be picked up or ever executed (it would try to `require()` the `.blocks` JSON file directly).
- [x] `routes/scripts-routes.js` — create route (`POST /`) writes a minimal valid `{jsa:{}, blocks:{...}}` default when no `code` is given for `.blocks`, instead of the JS default `ha.log(...)`. Save/content/delete routes needed no change — already extension-agnostic; `CapabilityAnalyzer` needed no special-casing either (see Permissions section — declared/detected is trivially in sync for `.blocks` once M4's auto-derivation lands).
- [x] `public/js/creation-wizard.js` — third "Blocks" language card; fixed `initialExt` detection (was `.ts`-only, would've silently renamed a `.blocks` file to `.js` on metadata edit) and the create-payload default code
- [x] `public/js/app.js` / `script-list.js` — **not in the original plan.** `getLanguageByFilename()`/`getLanguageBadge()` and the script-list tooltip hardcoded a `.ts`-or-`.js` choice; `.blocks` fell through to "JavaScript". Added a `.blocks` branch (Monaco falls back to the `json` language mode — no dedicated editor until M2) and a `BLK` badge.
- [x] i18n: `wizard_option_blockly`

### M2 — Core Block Library
**Goal**: Enough blocks to build 80% of typical automations visually.

Deliverable: A real automation (state change → service call → notification) can be built entirely in the Blockly editor.

**Architecture correction made while implementing step 1** (trigger → log → call, the priority order from "Implementation Approach" below): the original plan had `core/blockly-blocks-shared.js` reused in the browser via ES `import`, plus a *separate* `public/js/blockly-generator.js` for the browser side. This project has no frontend bundler (Monaco/socket.io/i18next are all loaded as plain CDN `<script>` tags, no ESM) — `import` doesn't work here, and Node's `core/` directory isn't web-served anyway. Fix: both `blockly-blocks-shared.js` (generators) and `blockly-blocks.js` (block shape definitions) physically live under `public/js/`, wrapped in a small UMD shim (`module.exports` if present, else a `window` global). Node's `blockly-compiler.js` reaches across the directory boundary with a relative `require('../public/js/...')`, the browser loads the identical file via `<script src="js/...">`. One file, two runtimes, no duplication, no `blockly-generator.js`.

- [x] `public/js/blockly-editor.js` — lazy `Blockly.inject()`, load/save workspace state, dirty-change hook (`onBlocklyWorkspaceChanged`), `ResizeObserver` for `Blockly.svgResize()`
- [x] `public/js/blockly-blocks.js` — UMD, JSON shape definitions for `ha_trigger_on` / `ha_call_service` / `ha_log` only so far (the M2 blocks table's full list is still open — see below)
- [x] `public/js/blockly-blocks-shared.js` — UMD, generators for the same 3 blocks
- [x] `public/js/blockly-toolbox.json` — static JSON toolbox: Triggers/Actions/Script (the 3 custom blocks) + Logic/Text/Math (Blockly built-ins, useful immediately). Category names are plain English for now — i18n and the ioBroker color scheme are still open (see below)
- [x] `public/index.html` — Blockly loaded via CDN (`cdn.jsdelivr.net/npm/blockly@11.2.2/blockly.min.js`, matches the pinned npm version), consistent with how Monaco/socket.io/i18next are already loaded in this project
- [x] `public/js/tab-manager.js` — `.blocks` files open a `type: 'blockly'` tab. Unlike Monaco (one editor, one persistent model per tab), there's a single shared Blockly workspace; each tab holds its own serialized JSON state, swapped into the workspace on switch. Trade-off: undo history doesn't survive switching away from a tab and back — accepted for now
- [x] `public/js/creation-wizard.js` — the existing "refresh open tab after metadata edit" fix (Monaco: re-fetch + `model.setValue()`) needed a Blockly-tab equivalent: re-fetch and update `tab.jsa` only, without touching `tab.blocksState` (which may hold unsaved visual edits the metadata save didn't touch)
- [ ] Dynamic entity & service dropdowns from HA (still plain text fields on `ha_trigger_on`/`ha_call_service` for now) — design direction decided, see "Autocomplete / entity picker value block" under Open Questions below
- [ ] i18n: category names and block labels (toolbox and block tooltips are still hardcoded English strings)
- [x] `ha_trigger_on_state` (filtered trigger), `ha_get_state` (value block — plugs into other blocks' sockets, e.g. Logic/Text), `ha_wait` (`sleep()`, exposed as **seconds** not milliseconds — beginner-friendlier unit, generator multiplies by 1000), `ha_notify`. Target audience is non-programmers (see Overview) — went with two separate, self-explanatory trigger blocks ("when X changes" / "when X changes to Y") instead of one block with an optional "leave blank for any state" field, since an implicit blank-means-something convention is a worse fit for that audience than two clearly-labeled blocks
- [x] `ha_log`/`ha_notify` MESSAGE changed from `field_input` (plain text only) to `input_value` with a text shadow block as the toolbox default — found immediately when trying to plug `ha_get_state` into `ha_log` and discovering there was no socket to plug it into. Generator uses `gen.valueToCode(block, 'MESSAGE', gen.ORDER_NONE) || '""'` instead of reading the field directly, so any value block (text, `ha_get_state`, `text_join`, ...) works, not just literal text
- [x] `ha_get_state` generator switched from `ha.getState(id)` to `ha.getStateValue(id)` — found by actually plugging it into the fix above and logging a real entity: `ha.getState()` returns the full state object (`{entity_id, state, attributes, context, ...}`), which is correct API behavior but a JSON dump is a bad default for "state of X" aimed at non-programmers. `ha.getStateValue()` returns just the converted value (`"off"`, `21.5`, `true`), matching what the block's tooltip already promised
- [x] `ha_stop` (optional reason field, blank = no-arg `ha.stop()`). `ha_log`'s `ha.debug/warn/error()` variants built as one block with a `LEVEL` dropdown (info/debug/warn/error) instead of 3 more near-duplicate blocks — old saved workspaces without a `LEVEL` field default to "info" (Blockly dropdowns default to the JSON definition's first listed option), so this is backward compatible
- [x] `ha_register`/`ha_update` (M4-scoped in the original table, pulled forward). `ha.register()`'s config object has many optional fields (unit, device_class, area, labels, ...) — the block only exposes `name`/`icon` for now, same "start minimal, extend via mutator later" approach as `ha_get_state`. Both `ha.register()`/`ha.update()` are synchronous (`void`, verified in `ha-api.d.ts`) — the original Block Library table's `await ha.register(...)`/no-`await` inconsistency was wrong, generators emit neither with `await`
- [ ] Skipped by request: `ha.entity().service()` (redundant with `ha_call_service` — same underlying call, just a different JS syntax; not worth a second block), `ha.getAttr()`/`ha.entityExists()` (deprioritized for now), debounced trigger
- [x] `schedule()` — 3 trigger blocks instead of hand-built cron math: `ha_schedule_interval` ("every N minutes/hours"), `ha_schedule_daily` ("every day at HH:MM"), `ha_schedule_cron` (raw text — cron *or* `schedule()`'s human-readable shorthand, both pass through unchanged; power users can paste output from an online cron generator). Discovered `schedule()` already accepts shorthand strings natively (`_parseCronExpression()` in `worker-wrapper.js`) — generators produce shorthand text (`"every 15 minutes"`, `"every day at 7:05"`) rather than raw cron math, verified against the actual regexes there (e.g. daily requires a zero-padded 2-digit minute, hour can be 1–2 digits unpadded)
- [x] `ha_notify` gained `title`/`target` (both optional `input_value` sockets, no shadow — an empty socket visually signals "optional", unlike a blank text field) and the `PERSISTENT` checkbox (`{ persistent: true }` → routes through HA's own notification bell instead of a companion-app push, since the dev environment here has no companion app configured to test against). `ha.register()`/`ha.update()` confirmed synchronous (`void` in `ha-api.d.ts`) — no `await` in the generator, unlike the original Block Library table's `await ha.register(...)` example
- [ ] Pre-compile "no trigger block" warning (listed under Error Handling / M2 verification)
- [x] `ha_entity` value block (2026-07-05) — reusable, pluggable carrier for an entity ID, superseding the earlier "mutator on `ha_get_state`" idea from the user's fluent-API observation (`ha.entity(id).getAttribute()`/`.turn_on()` already exist). Deliberately generates a bare `JSON.stringify(entityId)` string, **not** `ha.entity(id)` — the fluent handle's `.state` getter returns the raw unconverted string, which would reopen the on/off-is-truthy footgun `ha.getStateValue()` was chosen to avoid. Also deliberately *not* building fluent action blocks (`ha.entity(id).turn_on()`) — same "redundant with `ha_call_service`" reasoning as before, this is only for the getter side. New `ha_get_attribute` block (`ha.getAttr(entity, name)`) plugs into the same kind of socket as `ha_get_state`.
- [x] Rolled the same `field_input` → `input_value` (`ha_entity` shadow) conversion out to `ha_trigger_on`/`ha_trigger_on_state`/`ha_call_service`'s `ENTITY_ID` — so the whole library is uniformly ready for a future live-dropdown entity picker, not just the getter blocks. Deliberately **not** rolled out to `ha_register` (its `ENTITY_ID` names a *new* entity that doesn't exist yet — a "pick from existing entities" dropdown would make no sense there) or `ha_update` (kept out of scope for now, real difference is marginal). **Breaking for already-saved `.blocks` files** using any of these four blocks — verified (Node) the failure mode is the same benign one each time: Blockly logs "Ignoring non-existant field ENTITY_ID", the entity socket comes up empty rather than crashing, but a real saved script needs the entity re-plugged in by hand once. Also re-verified the `ha_call_service` mutator (extra data fields) still works correctly now that `ENTITY` is a socket instead of the field it used to append after.
- [x] `ha_call_service` layout: `inputsInline: true` so "call service X for [entity]" reads as one row instead of looking optional — but that setting applies block-wide, so it also started pulling the mutator's dynamically-added `brightness`/`color_temp` fields onto that same row. Fix: each mutator field is preceded by `this.appendEndRowInput(...)` in `updateShape_`, which forces a fresh row for *that* input specifically regardless of the block's `inputsInline` setting. Verified in the compiled Blockly bundle's renderer (`shouldStartNewRow_()`) that `EndRowInput` always breaks while a plain value input only breaks when `inputsInline` is false, rather than assuming from memory — this is a real, if under-documented, Blockly 11 API (`Block.prototype.appendEndRowInput`).
- [x] Verified live in the running app: trigger → call service → log built by hand in the browser, saved, and actually fired on a real state change (`switch.shelly_plug_s`), logging twice as expected. Found and fixed along the way: Monaco's AMD loader hijacking Blockly's UMD registration (`window.Blockly` never set), no dark theme (default Blockly theme unusable next to the rest of the dark-only UI), Ctrl+S only bound to Monaco's focus context (Blockly tabs have no Monaco focus target), `Blockly.Events.isUiEvent` called as a function instead of read as the per-event boolean it actually is (silently broke all dirty-tracking), and a double-nested `blocks` key when serializing the workspace for save (`workspaces.save()` returns `{blocks: {languageVersion, blocks: [...]}}`, not the inner object directly — mirrors the M1-era `workspaces.load()` nesting bug, same mistake on the write side this time)

**M2 blocks covered**: `ha.on()` (3 variants), `schedule()`, `ha.call()`, `ha.entity().service()`, `ha.notify()`, `ha.getState()`, `ha.getStateValue()`, `ha.getAttr()`, `ha.entityExists()`, `sleep()`, `ha.log/debug/warn/error()`, `ha.stop()`

#### MVP validation exercise (2026-07-05)

Rather than keep guessing at "what blocks might be useful," built a concrete target automation ("motion sensor turns a light on when dark, off when no motion or bright") and about ten other typical beginner automations (sunset/sunrise lighting, door-left-open reminder, all-lights-off on leaving, temperature alerts, auto-off timer, door-opens-while-away alarm, low-battery alerts) entirely against the existing block set, no new blocks assumed.

Result: everything on that list compiles correctly today except two gaps —

1. **`ha_call_service` can only pass `entity_id`** — no way to add extra service data (`brightness`, `temperature`, `volume_level`, ...). Fixed — see below.
2. **No time-of-day trigger** — fixed by the three `ha_schedule_*` blocks above.

Everything else (multi-condition logic, delayed re-checks, cross-entity conditions) was already covered by `controls_if` + `logic_compare`/`logic_operation` + `ha_get_state` + existing action blocks — confirmed by actually compiling the motion-light example end to end, not just reasoning about it. One non-obvious thing surfaced while building it: `ha_get_state` returns `getStateValue()`'s converted type, so comparing a binary sensor's state needs the **boolean** block (`true`/`false`), not a text block with `"on"`/`"off"` — worth a tooltip or example somewhere once there's user-facing documentation for the block library.

#### `ha_call_service` data mutator (2026-07-05)

Chose the real Blockly mutator (gear icon → popup) over a simpler fixed-3-slots alternative, despite the added risk: the interactive `decompose`/`compose`/`saveConnections` methods only ever run in a real browser, and this environment has no way to click a gear icon or drag blocks in a popup workspace, so that half of the feature needed the user testing it live.

New file `public/js/blockly-mutators.js` (UMD, same cross-environment reasoning as `blockly-blocks-shared.js`/`blockly-blocks.js`). Implementation mirrors Blockly's own built-in `text_join`/`lists_create_with` mutator pattern as closely as possible — verified the actual method names (`saveConnections`, `reconnect`, `updateShape_`, `itemCount_`, `Extensions.registerMutator`) exist by grepping the compiled `blockly.min.js` bundle rather than trusting older tutorials, since Blockly's mutator API has changed across major versions.

- Renaming a data field happens directly on the main block (each `ADD<i>` input has a real editable `FieldTextInput` for its name) — the popup is only for adding/removing/reordering how many slots exist, not renaming them. `saveConnections()` snapshots each current name onto the popup's item block as a plain `.name_` property (not a serialized field) so it survives reordering without needing an editable field inside the popup too.
- **Verified (Node, this environment)**: `saveExtraState`/`loadExtraState`/`updateShape_` correctly reconstruct a saved block's dynamic `ADD0`/`ADD1`/... inputs from `{itemCount, names}`, deserialization correctly plugs in whatever's connected to each (tested a literal number and a nested `ha_get_state` block), the generator emits correct `ha.call(service, {entity_id, "brightness": 128, "color_temp": ha.getStateValue(...)})`, and old saved workspaces with no `extraState` at all still compile unchanged (backward compatible).
- **Verified live in the browser**: gear icon opens the popup; dragging "field" blocks in from the popup's flyout adds `ADD<i>` inputs on the main block; deleting one only disconnects its own slot; inserting a new item *between* two existing ones (not just at the end) keeps `brightness`/`color_temp` and their connected values (`128`, `state of ...`) correctly attached after reordering.
- Two real bugs found and fixed during that testing, both in `compose()`'s rename loop:
  1. First cut skipped `setValue()` when a new item had no name yet (to avoid stomping the "field_name" placeholder with `''`) — but skipping-when-empty meant a stale name from *before* the edit could survive into a slot it no longer belonged to whenever an item was inserted/reordered anywhere but the tail, since `updateShape_()` only appends/removes inputs at the end and never resets one in the middle. Fix: always call `setValue()` for every index on every `compose()`, falling back to `'field_name'` for an empty name rather than skipping — makes each index unconditionally reflect the *current* popup order instead of trusting leftovers.

#### Categories & colors — decided 2026-07-05

- **Category list**: reuse the Block Library table sections above as toolbox categories directly — Triggers, Actions, State, Wait/Async, Store, Areas & Labels, Register/Update, Calendar & Todo, Script Utilities — plus Blockly's standard categories (Logic, Loops, Variables, Math, Text, Lists, Color). Deliberately *not* a 1:1 copy of ioBroker's category list (System, Sendto, Datum und Zeit, Konvertierung, Timeouts, Objekt, ...) — those are organized around generic JS/adapter concepts because ioBroker has no equivalent to our structured `ha.*` API; our table sections are already the natural cut for this API.
- **Naming**: English category names, matching the existing English block text (`when ... changes`, `call service`, `log`) — translated via i18n like the rest of the UI, not hardcoded German.
- **Colors**: hue-based palette (Blockly hue 0–360), grouping conceptually related categories into adjacent hues rather than copying ioBroker's exact values:

  | Category | Hue | Rationale |
  |---|---|---|
  | Triggers | 210 (blue) | "when something happens" |
  | Actions | 20 (red-orange) | "do something" — deliberate contrast to Triggers |
  | State | 45 (yellow/amber) | "read something" |
  | Register/Update | 65 (yellow-green) | adjacent to State, also data-flavored |
  | Areas & Labels | 180 (teal) | "organize/group" |
  | Calendar & Todo | 165 (teal-green) | adjacent to Areas, both structured HA data |
  | Store | 260 (indigo) | "remember something" |
  | Wait/Async | 300 (purple) | adjacent to Store, both control-flow |
  | Script Utilities | 0 (red) | logs/lifecycle, deliberately standalone |

  `blockly-toolbox.json` updated: Triggers/Actions unchanged (210/20 already matched), Script → 0 (was a placeholder 120/green).

Still open (implementation questions, not blocked on the above):

- **Category assignment**: for every block in the M2/M3/M4 tables above, which toolbox category does it land in? Mechanical once the category list is fixed (it now is) — just needs doing as each block is built.
- **Block appearance & editability**: which fields stay plain text input (current state: `ENTITY_ID`/`SERVICE`/`MESSAGE` are all `field_input`) vs. become dropdowns, checkboxes, or mutator-driven (e.g. the filtered/debounced trigger variants from the M2 table need extra fields — mutator icon to add them, or three separate block types?).
- **Autocomplete / "entity picker" value block (design decided 2026-07-05, not yet built)**: rather than giving every block its own dynamic dropdown field (the cross-environment problem below, solved once per field), build **one** reusable value block — e.g. `ha_entity` — with a dropdown populated live from `haData.services`/entity data (the same source Monaco's existing IntelliSense already uses, see `public/js/api.js`'s `loadHAServices()`). Plug it into any socket that wants an entity/target: `ha_notify`'s new `TARGET` socket, `ha_log`/`ha_notify`'s `MESSAGE`, a future `ha_get_state` input, etc. Users who don't want the dropdown can still plug in a plain text block instead — the socket doesn't care which. This came out of trying to make `ha_notify`'s `TARGET` pluggable and wanting a proper entity picker rather than free text.
  - **Cross-environment field problem**: a dynamic dropdown field needs live browser data (`haData`) to render its options, which doesn't exist in Node — `BlocklyCompiler` only needs to *read* whatever value got serialized, never render the picker UI. A field registered the same way in both places (`Blockly.fieldRegistry.register(...)`) needs a menu-generator function that's meaningless in Node; if `FieldDropdown`'s value validation checks the (empty/placeholder) menu list against the stored value during `workspaces.load()`, deserialization could reject a value that's perfectly valid in the browser. Needs verifying against the actual Blockly 11 field validation behavior before building it, not assuming.
- **Domain awareness**: once the entity picker exists, its dropdown could filter to the domain implied by context (e.g. only `light.*` entities when plugged into `ha_call_service` and `SERVICE` is `light.turn_on`) — a refinement on top of the picker, not a separate mechanism.

### M3 — Advanced Blocks
**Goal**: Async flows, persistent state, MQTT, and event bus.

Deliverable: Scripts with `waitFor`, persistent counters, and MQTT triggers are buildable.

- [ ] Wait blocks: `ha.waitFor()` with and without timeout
- [ ] Ask block: `ha.ask()` with action buttons
- [ ] Store blocks: `ha.store.get/set/delete/on`, `ha.persistent()`
- [ ] MQTT blocks: `ha.mqtt.subscribe`, `ha.mqtt.publish`
- [ ] Bulk ops block: `ha.select(pattern)`
- [ ] Event bus blocks: `ha.onEvent()`, `ha.fireEvent()`

### M4 — Extended API Blocks
**Goal**: Full API surface coverage for power users.

Deliverable: Every `ha.*` API method has a corresponding block.

- [ ] Area/Label/Floor blocks
- [ ] HTTP blocks: `ha.http.get/post`
- [ ] Webhook block: `ha.onWebhook()` (basic, default auth — see Out of Scope)
- [x] ~~Register/Update blocks (MQTT Discovery)~~ — done, pulled forward into M2 (`ha_register`/`ha_update`)
- [ ] Calendar/Todo blocks
- [ ] History/Statistics/Template blocks
- [ ] Lifecycle blocks: `ha.onStop()`, `ha.onError()`, `ha.action()`, `ha.restart()`
- [ ] `ha.getHeader()` block
- [ ] `ha.localize()` block
- [ ] `BlocklyCompiler`: block-type → permission map (`network`, `webhook`) — write derived permissions into `jsa.permission` on compile (see Permissions section)

### M5 — UX Polish
**Goal**: Production-quality editing experience.

Deliverable: The Blockly editor feels native to the addon.

- [ ] "Show Code" panel — read-only Monaco synced to compiled JS output
- [ ] Editor toolbar needs a Blockly-aware branch: `#toolbar-snippets` currently always renders JS/TS code snippets via `buildSnippetToolbar(container, mode)` (`tab-manager.js`'s `switchToTab()` passes `mode: newTab.type === 'card' ? 'card' : 'script'` — `.blocks` tabs fall into `'script'` today, showing JS snippets that make no sense on a block canvas). Needs a `'blockly'` case that renders the Show Code toggle button in that slot instead. Also reconsider other Monaco-only toolbar buttons (word wrap) for Blockly tabs while touching this.
- [ ] "Convert to JavaScript" — warning dialog + one-way conversion, `.blocks` file deleted
- [ ] Block-level error visualization — highlight the block that caused a runtime error (requires error position metadata from compiler)
- [x] Blockly dark theme (`Blockly.Theme.defineTheme('ha_dark', ...)` in `blockly-editor.js`) — pulled forward into M2 because the default light theme was unusable next to the rest of the (dark-only, no light mode anywhere) UI. Still open for M5: fonts/shadows polish, and the toolbox category colors (currently placeholder hues, not yet the ioBroker scheme)
- [ ] i18n: all remaining keys (`blockly_show_code`, `blockly_convert_warning`, `blockly_category_*`, error messages)

---

## Implementation Approach

### 1. Compiler pipeline first
Build M1 before any block UI. Proving that `.blocks` → compiled JS → running worker round-trips correctly is the highest-risk part. Discovering issues here late (after 30+ blocks are built) is expensive.

### 2. Server-side generation is the source of truth
Use `blockly/node` in `BlocklyCompiler` on the server to generate JS. The browser-side generator (for "Show Code") is a secondary concern. This eliminates divergence between what the editor renders and what actually runs.

### 3. One block = one API call
Keep blocks atomic. Don't build compound "turn off all lights in area X" mega-blocks — let users chain atomic blocks together using Blockly's built-in sequence flow. This keeps generators simple and blocks composable.

### 4. Entity dropdowns: lazy load, session cache
Fetch entity IDs once on workspace mount; cache them in memory for the session. Do not re-fetch on every dropdown open. Show a loading state if HA is still connecting.

### 5. `.blocks` as single source of truth, lock the compiled output
Never expose `.storage/dist/script.js` for direct editing when a `.blocks` source exists. The scripts list should not show the compiled output file. M5's "Convert to JavaScript" explicitly and irreversibly breaks this link — make the warning dialog clear.

### 6. Reuse Monaco for "Show Code"
Monaco is already loaded for JS/TS editing. Open it in `readOnly: true` mode pointing at the compiled output path. No new viewer component needed.

### 7. Block library priority order within M2
Build in this order: trigger (`ha.on`) → log → service call (`ha.call`) → get state. This validates the generator architecture end-to-end with the simplest possible blocks before investing in the rest.

---

## Files to Add

| File | Purpose |
|---|---|
| `js_automations/core/blockly-compiler.js` | Server-side `.blocks` → JS compilation |
| `js_automations/public/js/blockly-blocks-shared.js` | Generator registration — UMD, required by both Node (`blockly-compiler.js`) and the browser (`<script>` tag). Physically under `public/js/`, not `core/` — see the M2 "Architecture correction" note |
| `js_automations/public/js/blockly-blocks.js` | Custom block shape definitions — same UMD/cross-boundary setup as above |
| `js_automations/public/js/blockly-mutators.js` | `ha_call_service`'s extra-data-fields mutator — same UMD/cross-boundary setup; only `saveExtraState`/`loadExtraState`/`updateShape_` matter in Node, `decompose`/`compose` are browser-only |
| `js_automations/public/js/blockly-editor.js` | Blockly workspace UI & lifecycle (browser-only, no Node counterpart) |
| `js_automations/public/js/blockly-toolbox.json` | Toolbox category/block configuration |

## Files to Modify

| File | Change |
|---|---|
| `js_automations/core/script-watcher.js` | Watch `.blocks` extension, trigger BlocklyCompiler on save/delete |
| `js_automations/core/script-header-parser.js` | `.blocks` branch in `parse()`/`updateMetadata()` (jsa key, not JSDoc) |
| `js_automations/core/compiler-manager.js` | `pruneDist()` also recognizes a `.blocks` source |
| `js_automations/core/kernel.js` | Instantiate `BlocklyCompiler`, forward events, initial compile pass |
| `js_automations/core/entity-manager.js` | Thread `blocklyCompiler` through to `ScriptWatcher` |
| `js_automations/core/worker-manager.js` | `getScripts()` + `startScript()` `.blocks` branch (found during M1 implementation — see M1 checklist) |
| `js_automations/routes/scripts-routes.js` | `.blocks`-aware default content on create; everything else already extension-agnostic |
| `js_automations/public/index.html` | Load Blockly via CDN (`blockly@11.2.2/blockly.min.js`); `#blockly-container`; new `<script>` tags |
| `js_automations/public/js/creation-wizard.js` | Add "Visual (.blocks)" option; fix `initialExt`/create-payload extension handling; refresh open Blockly tabs' `jsa` after a metadata edit |
| `js_automations/public/js/app.js` | `.blocks` branch in `getLanguageByFilename()`/`getLanguageBadge()` (found during M1 implementation) |
| `js_automations/public/js/script-list.js` | `.blocks` branch in the script tooltip's language label |
| `js_automations/public/css/style.css` | `.lang-badge-blocks` color, `#blockly-container` sizing |
| `js_automations/public/js/tab-manager.js` | `type: 'blockly'` tab branch throughout open/switch/save/close (M2) |
| `js_automations/locales/en/translation.json` | New i18n keys |
| `js_automations/locales/de/translation.json` | New i18n keys |

---

## i18n Keys

```
wizard_option_blockly
blockly_show_code
blockly_edit_as_js
blockly_convert_warning
blockly_category_triggers
blockly_category_actions
blockly_category_state
blockly_category_wait
blockly_category_store
blockly_category_areas
blockly_category_register
blockly_category_calendar
blockly_category_script
blockly_no_trigger_warning
```

---

## Verification (per milestone)

**M1**
- Create a `.blocks` script via wizard → appears in scripts list
- Save workspace (even with only built-in Blockly blocks) → `.storage/dist/script.js` is written
- Enable script → worker starts without error
- Delete script → both `.blocks` and `.storage/dist/script.js` are removed

**M2**
- Build a trigger + service call + log in Blockly → script runs, service is called on trigger
- Entity dropdown lists actual entities from HA
- Saving with no trigger block shows a warning

**M3–M4**
- `ha.waitFor()` block produces `await ha.waitFor(...)` in generated output
- `ha.store.set/get` block produces correct code
- MQTT subscribe block works end-to-end

**M5**
- "Show Code" panel opens and shows correct generated JS
- "Convert to JavaScript" shows warning, converts file, removes `.blocks`, opens Monaco with JS

---

## Out of Scope (for now)

- TypeScript as an intermediate layer for Blockly output
- Block-level breakpoints / watch tab integration
- Sharing or importing custom block libraries
- NPM package blocks (complex dependency model, would require capability analyzer integration)
- Filesystem (`ha.fs.*`) blocks — rarely needed in visual automations
- Advanced `ha.onWebhook()` options (`noAuth`, `allowlist`, method override, HMAC signature verification) — the M4 block covers the default-auth POST case only; scripts needing the rest use "Edit as JavaScript"
- `@card` companion Lovelace cards for `.blocks` scripts — requires hand-written JS unrelated to block logic; use "Convert to JavaScript" instead
