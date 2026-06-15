# Blockly Integration Concept

## Motivation

JS Automations nutzt bereits TypeScript als compilierte Zwischenschicht für JS-Scripts. Blockly ergänzt das System um eine **dritte Editier-Modalität**: einen visuellen Block-Editor für Nicht-Programmierer und schnelles Prototyping — ohne die bestehende Architektur zu verändern.

---

## Architektur-Überblick

```
Benutzer editiert im Blockly-Editor (Browser)
  ↓
PUT /api/scripts/script.blocks  (speichert JSON-Workspace)
  ↓
BlocklyCompiler (server-seitig, Node.js `blockly` npm-Paket)
  → generiert JavaScript
  ↓
.storage/dist/script.js
  ↓
WorkerManager → Worker Thread  (identische Pipeline wie heute)
```

**`.blocks`-Datei** = JSON-Quelle (Source of Truth)  
**`.storage/dist/script.js`** = Runtime-Artefakt (wie `TS → JS` heute)

---

## Dateiformat: `.blocks`

Blockly 11 verwendet JSON als primäres Serialisierungsformat (XML ist nur noch Legacy). Die JSA-Metadaten werden als Top-Level-Key gespeichert:

```json
{
  "jsa": {
    "name": "Licht aus bei Abwesenheit",
    "icon": "mdi:home-export-outline",
    "description": "Schaltet Lichter aus wenn niemand zuhause ist",
    "expose": "",
    "loglevel": "info",
    "area": "living_room"
  },
  "blocks": {
    "languageVersion": 0,
    "blocks": [
      {
        "type": "ha_trigger_state",
        "id": "abc",
        "x": 20,
        "y": 20,
        "fields": {
          "ENTITY_ID": "binary_sensor.presence",
          "FROM_STATE": "on",
          "TO_STATE": "off"
        },
        "statements": {
          "DO": {
            "block": {
              "type": "ha_call_service",
              "fields": { "SERVICE": "light.turn_off" },
              "values": {
                "ENTITY_ID": { "block": { "type": "text", "fields": { "TEXT": "light.living_room" } } }
              }
            }
          }
        }
      }
    ]
  }
}
```

Der `ScriptHeaderParser` bekommt einen `.blocks`-Branch, der Metadaten aus dem `jsa`-Key liest (statt JSDoc-Kommentare).

**Warum kein TypeScript als Zwischenschicht?**  
Bei visuell generiertem Code bringt TypeScript keinen Mehrwert: Die Typsicherheit kommt durch die Block-Verbindungsregeln selbst. Direkt zu JS = einfachere Pipeline, weniger Compile-Schritte.

---

## Block-Kategorien (Extended MVP)

### Triggers
| Block | Generierter Code |
|-------|-----------------|
| When [entity] changes from [state] to [state] | `ha.on(entity, async (e) => { if (e.old_state !== from \|\| e.state !== to) return; ... })` |
| When [entity] state becomes [state] | `ha.on(entity, toState, async (e) => { ... })` |
| Every [N] minutes | `setInterval(() => tick().catch(err => ha.log(err)), N * 60000)` |
| On schedule [cron] | `schedule('* * * * *', async () => { ... })` |

### Actions
| Block | Generierter Code |
|-------|-----------------|
| Call service [domain.service] for [entity] | `ha.call('domain.service', { entity_id: ... })` |
| Turn on [entity] | `ha.call('light.turn_on', { entity_id: ... })` |
| Turn off [entity] | `ha.call('light.turn_off', { entity_id: ... })` |
| Send notification [message] | `ha.notify('...')` |
| Send notification [message] with title [title] | `ha.notify('...', { title: '...' })` |

### Entities
| Block | Generierter Code |
|-------|-----------------|
| Get state of [entity] | `ha.getState('entity_id')` |
| Get state value of [entity] | `ha.getStateValue('entity_id')` |
| Get attribute [attr] of [entity] | `ha.getAttr('entity_id', 'attribute')` |
| Call service for [entity] | `ha.call('domain.service', { entity_id: ... })` |
| Wait for [entity] to become [state] | `await ha.waitFor('entity_id', 'state')` |

### Store
| Block | Generierter Code |
|-------|-----------------|
| Get store value [key] | `ha.store.get('key')` |
| Set store value [key] to [value] | `ha.store.set('key', value)` |

### Script
| Block | Generierter Code |
|-------|-----------------|
| Log [message] | `ha.log(...)` |
| Wait [N] ms | `await sleep(N)` |
| Stop script | `ha.stop()` |

### Standard (Blockly built-in)
Logic (if/else, and/or, not), Loops (repeat, while), Variables, Math, Text

---

## Dynamische Entity- & Service-Dropdowns

- Beim Mounten des Blockly-Editors: `GET /api/ha/states` → befüllt Entity-Dropdowns
- Beim Mounten: `GET /api/ha/services` → befüllt Service-Dropdowns
- Dropdowns nutzen Blocklys `FieldDropdown` mit dynamischen Optionen
- Fallback: Freitextfeld wenn HA nicht verbunden

---

## Server-seitige Code-Generierung (BlocklyCompiler)

```js
// core/blockly-compiler.js
const { Blockly } = require('blockly/node');  // node-entry enthält DOM-Shims
const { javascriptGenerator } = require('blockly/javascript');

// Block-Generator-Definitionen einmalig registrieren
require('./blockly-blocks-node');

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

Die Block-Generator-Definitionen werden zwischen Browser (`blockly-generator.js`) und Node.js (`blockly-blocks-node.js`) über ein explizites `init(generator)`-Pattern geteilt:

```js
// blockly-blocks-shared.js  (plattformunabhängig)
export function registerHaBlocks(generator) {
  generator.forBlock['ha_call_service'] = (block) => { ... };
  // weitere Blöcke ...
}
```

```js
// Browser
import { javascriptGenerator } from 'blockly/javascript';
import { registerHaBlocks } from './blockly-blocks-shared.js';
registerHaBlocks(javascriptGenerator);

// Node.js
const { javascriptGenerator } = require('blockly/javascript');
const { registerHaBlocks } = require('./blockly-blocks-shared');
registerHaBlocks(javascriptGenerator);
```

---

## Fehler-Feedback

Wenn der `BlocklyCompiler` fehlschlägt (ungültiger Workspace, Generator-Fehler), wird der Fehler über den bestehenden Worker-Fehlerkanal zurückgemeldet und im Frontend als Fehlermeldung angezeigt — identisch zur TS-Compile-Fehlermeldung heute.

Zusätzlich wird vor dem Kompilieren validiert, ob der Workspace mindestens einen Trigger-Block enthält. Leere oder trigger-freie Workspaces erzeugen eine Warnung statt stillem Leercode.

---

## NPM-Abhängigkeit

```json
"blockly": "^11.x"
```

Blockly 11 unterstützt Node.js nativ (Entry Point `blockly/node`). Paketgröße: ~10–12 MB inkl. Dependencies (vergleichbar mit `typescript` + `ts-node`).

---

## UI-Flow

1. **Erstellen**: Wizard → "Visual (.blocks)" auswählen → Blockly-Workspace mit Starter-Blöcken öffnet sich
2. **Editieren**: Script in Sidebar anklicken → Blockly-Editor mountet (Entity/Service-Dropdowns aus HA befüllt)
3. **Speichern** (Ctrl+S oder Toolbar): Frontend sendet JSON an `PUT /api/scripts/script.blocks` → Server kompiliert → Worker neu gestartet
4. **Code anzeigen**: Toolbar-Button "Show Code" → Read-only Monaco-Panel mit generiertem JS (gleiche Split-View wie Card Preview)
5. **Zu Code wechseln**: "Edit as JavaScript" → Warndialog ("Der visuelle Editor steht danach nicht mehr zur Verfügung") → generierter Code öffnet in Monaco als `.js`, `.blocks`-Datei wird gelöscht

---

## Neue Dateien

| Datei | Zweck |
|-------|-------|
| `js_automations/core/blockly-compiler.js` | Server: JSON parsen → JS generieren |
| `js_automations/public/js/blockly-editor.js` | Frontend: Workspace verwalten, Blöcke laden/speichern |
| `js_automations/public/js/blockly-blocks.js` | Custom-Block-Definitionen (Toolbox + initFunctions) |
| `js_automations/public/js/blockly-generator.js` | JS-Code-Generatoren für HA-Custom-Blöcke (Browser) |
| `js_automations/core/blockly-blocks-shared.js` | Geteilte Generator-Registrierung (Browser + Node.js) |
| `js_automations/public/js/blockly-toolbox.json` | Toolbox-Konfiguration (Block-Kategorien, extern als JSON) |

## Geänderte Dateien

### Backend
- `core/script-watcher.js` — `.blocks`-Dateien beobachten, BlocklyCompiler triggern
- `core/kernel.js` — BlocklyCompiler instanziieren
- `core/script-header-parser.js` — `jsa`-JSON-Metadaten lesen (statt XML-Attribute)
- `routes/scripts-routes.js` — `.blocks`-Extension erlauben
- `core/compiler-manager.js` — `pruneDist()` für `.blocks`-Quellen erweitern; beim Löschen beide Dateien (`.blocks` + `.storage/dist/script.js`) entfernen

### Frontend
- `public/index.html` — Blockly CDN `<script>`-Tags
- `public/js/creation-wizard.js` — "Visual (.blocks)" als dritte Sprachoption
- `public/js/tab-manager.js` — Blockly vs. Monaco je nach Dateiextension

### i18n
- `locales/de/translation.json` + `locales/en/translation.json`:  
  `wizard_option_blockly`, `blockly_show_code`, `blockly_edit_metadata`,  
  `blockly_category_triggers`, `blockly_category_actions`, `blockly_category_entities`,  
  `blockly_category_store`, `blockly_category_script`, `blockly_convert_warning`

---

## Phasen

**Phase 1 (MVP):**
- `.blocks`-Dateityp, BlocklyCompiler, ScriptWatcher-Integration
- Creation-Wizard-Option
- Alle Block-Kategorien oben
- "Show Code"-Panel (read-only)
- "Convert to JavaScript"-Migrationspfad (mit Warndialog)

**Phase 2 (future):**
- `ha.register()`-Block (custom MQTT-Entities)
- `ha.ask()`-Block (actionable Notifications)
- Blockly-Block für Script Pack Cards
