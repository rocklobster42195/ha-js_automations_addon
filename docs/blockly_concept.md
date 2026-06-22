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

`ScriptHeaderParser` gets a `.blocks` branch that reads metadata from the `jsa` key instead of JSDoc comments.

**Why no TypeScript as intermediate?**
Visually generated code gains nothing from TypeScript — type safety comes from block connection rules enforced in the editor. Compiling directly to JS keeps the pipeline simpler and removes an unnecessary step.

---

## Architecture

```
User edits in Blockly editor (browser)
  ↓
PUT /api/scripts/script.blocks   (saves JSON workspace)
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
const { Blockly } = require('blockly/node');
const { javascriptGenerator } = require('blockly/javascript');

require('./blockly-blocks-shared')(javascriptGenerator);

class BlocklyCompiler {
  async compile(blocksPath) {
    const parsed = JSON.parse(await fs.readFile(blocksPath, 'utf8'));
    const workspace = new Blockly.Workspace();
    Blockly.serialization.workspaces.load(parsed.blocks, workspace);
    const code = javascriptGenerator.workspaceToCode(workspace);
    workspace.dispose();
    const distPath = this._getDistPath(blocksPath);
    await fs.writeFile(distPath, this._wrapCode(code));
    return distPath;
  }
}
```

### Shared Generator Registration

Block code generators are defined once and registered on whichever generator instance is passed in — works in both Node.js (compiler) and browser (Show Code panel):

```js
// core/blockly-blocks-shared.js  (platform-agnostic)
module.exports = function registerHaBlocks(generator) {
  generator.forBlock['ha_call_service'] = (block, gen) => { ... };
  generator.forBlock['ha_trigger_on']   = (block, gen) => { ... };
  // ... all blocks
};
```

```js
// Browser
import { javascriptGenerator } from 'blockly/javascript';
import registerHaBlocks from './blockly-blocks-shared.js';
registerHaBlocks(javascriptGenerator);

// Node.js (BlocklyCompiler)
const { javascriptGenerator } = require('blockly/javascript');
require('./blockly-blocks-shared')(javascriptGenerator);
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

## UI Flow

1. **Create**: Wizard → select "Visual (.blocks)" → Blockly workspace opens with starter trigger block
2. **Edit**: Click script in sidebar → Blockly editor mounts; entity/service dropdowns populated from HA
3. **Save** (Ctrl+S or toolbar): Frontend sends JSON workspace to `PUT /api/scripts/script.blocks` → server compiles → worker restarts
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
"blockly": "^11.x"
```

Blockly 11 supports Node.js natively via the `blockly/node` entry point. Package size: ~10–12 MB including dependencies (comparable to `typescript` + `ts-node`).

---

## Milestones

### M1 — Foundation
**Goal**: Full pipeline from `.blocks` file to running script. No custom blocks — uses Blockly's built-in blocks only to prove the round-trip works.

Deliverable: Creating, saving, enabling, and deleting a `.blocks` file works end-to-end.

- [ ] Add `blockly` npm package (v11+)
- [ ] `core/blockly-compiler.js` — deserialize workspace JSON → generate JS via `blockly/node`
- [ ] `core/blockly-blocks-shared.js` — shared generator registration scaffold (empty initially)
- [ ] `core/script-watcher.js` — watch `.blocks` extension, trigger BlocklyCompiler on save
- [ ] `core/script-header-parser.js` — parse `jsa` JSON metadata from `.blocks` files
- [ ] `core/compiler-manager.js` — `pruneDist()` covers `.blocks` sources; DELETE removes both `.blocks` and compiled output
- [ ] `core/kernel.js` — instantiate BlocklyCompiler
- [ ] `routes/scripts-routes.js` — accept `.blocks` in CRUD endpoints; handle JSON body vs. text body
- [ ] `public/js/creation-wizard.js` — add "Visual (.blocks)" as third language option
- [ ] i18n: `wizard_option_blockly`

### M2 — Core Block Library
**Goal**: Enough blocks to build 80% of typical automations visually.

Deliverable: A real automation (state change → service call → notification) can be built entirely in the Blockly editor.

- [ ] `public/js/blockly-editor.js` — workspace init, save/load, toolbar actions
- [ ] `public/js/blockly-blocks.js` — block definitions for all M2 blocks (shapes, inputs, fields)
- [ ] `public/js/blockly-generator.js` — JS code generators for M2 blocks (browser, for Show Code)
- [ ] `core/blockly-blocks-shared.js` — implement generators for all M2 blocks
- [ ] `public/js/blockly-toolbox.json` — toolbox config: Triggers, Actions, State, Script, Standard categories
- [ ] `public/index.html` — load Blockly library (CDN or bundled)
- [ ] `public/js/tab-manager.js` — route `.blocks` files to Blockly editor instead of Monaco
- [ ] Dynamic entity & service dropdowns from HA
- [ ] i18n: category names and block labels

**M2 blocks covered**: `ha.on()` (3 variants), `schedule()`, `ha.call()`, `ha.entity().service()`, `ha.notify()`, `ha.getState()`, `ha.getStateValue()`, `ha.getAttr()`, `ha.entityExists()`, `sleep()`, `ha.log/debug/warn/error()`, `ha.stop()`

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
- [ ] Register/Update blocks (MQTT Discovery)
- [ ] Calendar/Todo blocks
- [ ] History/Statistics/Template blocks
- [ ] Lifecycle blocks: `ha.onStop()`, `ha.onError()`, `ha.action()`, `ha.restart()`
- [ ] `ha.getHeader()` block
- [ ] `ha.localize()` block

### M5 — UX Polish
**Goal**: Production-quality editing experience.

Deliverable: The Blockly editor feels native to the addon.

- [ ] "Show Code" panel — read-only Monaco synced to compiled JS output
- [ ] "Convert to JavaScript" — warning dialog + one-way conversion, `.blocks` file deleted
- [ ] Block-level error visualization — highlight the block that caused a runtime error (requires error position metadata from compiler)
- [ ] Blockly theme aligned to addon's visual style (colors, fonts, shadows)
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
| `js_automations/core/blockly-blocks-shared.js` | Shared generator registration (Node.js + browser) |
| `js_automations/public/js/blockly-editor.js` | Blockly workspace UI & lifecycle |
| `js_automations/public/js/blockly-blocks.js` | Custom block definitions (all milestones) |
| `js_automations/public/js/blockly-generator.js` | JS code generators for browser Show Code panel |
| `js_automations/public/js/blockly-toolbox.json` | Toolbox category/block configuration |

## Files to Modify

| File | Change |
|---|---|
| `js_automations/core/script-watcher.js` | Watch `.blocks` extension, trigger BlocklyCompiler |
| `js_automations/core/script-header-parser.js` | Parse `jsa` JSON metadata from `.blocks` files |
| `js_automations/core/compiler-manager.js` | `pruneDist()` + delete for `.blocks` artifacts |
| `js_automations/core/kernel.js` | Instantiate and wire BlocklyCompiler |
| `js_automations/routes/scripts-routes.js` | Accept `.blocks` extension, JSON body in PUT/POST |
| `js_automations/public/index.html` | Load Blockly library |
| `js_automations/public/js/creation-wizard.js` | Add "Visual (.blocks)" option |
| `js_automations/public/js/tab-manager.js` | Route `.blocks` files to Blockly editor |
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
