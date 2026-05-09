# Blockly Integration Concept

## Motivation

JS Automations nutzt bereits TypeScript als compilierte Zwischenschicht für JS-Scripts. Blockly ergänzt das System um eine **dritte Editier-Modalität**: einen visuellen Block-Editor für Nicht-Programmierer und schnelles Prototyping — ohne die bestehende Architektur zu verändern.

---

## Architektur-Überblick

```
Benutzer editiert im Blockly-Editor (Browser)
  ↓
PUT /api/scripts/script.blocks  (speichert XML-Workspace)
  ↓
BlocklyCompiler (server-seitig, Node.js `blockly` npm-Paket)
  → generiert JavaScript
  ↓
.storage/dist/script.js
  ↓
WorkerManager → Worker Thread  (identische Pipeline wie heute)
```

**`.blocks`-Datei** = XML-Quelle (Source of Truth)  
**`.storage/dist/script.js`** = Runtime-Artefakt (wie `TS → JS` heute)

---

## Dateiformat: `.blocks`

Standard-Blockly-Workspace-XML mit einem eigenen `<jsa>`-Metadaten-Element:

```xml
<xml xmlns="https://developers.google.com/blockly/xml">
  <jsa name="Licht aus bei Abwesenheit"
       icon="mdi:home-export-outline"
       description="Schaltet Lichter aus wenn niemand zuhause ist"
       expose=""
       loglevel="info"
       area="living_room" />
  <block type="ha_trigger_state" id="abc" x="20" y="20">
    <field name="ENTITY_ID">binary_sensor.presence</field>
    <field name="FROM_STATE">on</field>
    <field name="TO_STATE">off</field>
    <statement name="DO">
      <block type="ha_call_service">
        <field name="SERVICE">light.turn_off</field>
        <value name="ENTITY_ID">
          <block type="text"><field name="TEXT">light.living_room</field></block>
        </value>
      </block>
    </statement>
  </block>
</xml>
```

Das `<jsa>`-Element wird **innerhalb** des Blockly-XMLs gespeichert — Blockly ignoriert unbekannte Elemente. Der `ScriptHeaderParser` bekommt einen `.blocks`-Branch, der Metadaten aus den XML-Attributen liest (statt JSDoc-Kommentare).

**Warum kein TypeScript als Zwischenschicht?**  
Bei visuell generiertem Code bringt TypeScript keinen Mehrwert: Die Typsicherheit kommt durch die Block-Verbindungsregeln selbst. Direkt zu JS = einfachere Pipeline, weniger Compile-Schritte.

---

## Block-Kategorien (Extended MVP)

### Triggers
| Block | Generierter Code |
|-------|-----------------|
| When [entity] changes from [state] to [state] | `ha.on(entity, {from, to}, async (e) => { ... })` |
| Every [N] minutes | `setInterval(() => { ... }, N * 60000)` |
| On schedule [cron] | `schedule('* * * * *', async () => { ... })` |

### Actions
| Block | Generierter Code |
|-------|-----------------|
| Call service [domain.service] for [entity] | `ha.call('domain.service', { entity_id: ... })` |
| Turn on [entity] | `ha.call('light.turn_on', { entity_id: ... })` |
| Turn off [entity] | `ha.call('light.turn_off', { entity_id: ... })` |
| Send notification [message] | `ha.notify({ message: '...' })` |

### Entities
| Block | Generierter Code |
|-------|-----------------|
| Get state of [entity] | `ha.getState('entity_id')` |
| Get attribute [attr] of [entity] | `ha.getAttr('entity_id', 'attribute')` |
| entity [entity] → [service]() | `ha.entity('entity').turn_on()` |

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
const Blockly = require('blockly/core');
const { javascriptGenerator } = require('blockly/javascript');

class BlocklyCompiler {
  async compile(blocksPath) {
    const xml = await fs.readFile(blocksPath, 'utf8');
    const workspace = new Blockly.Workspace();
    Blockly.Xml.domToWorkspace(Blockly.Xml.textToDom(xml), workspace);
    const code = javascriptGenerator.workspaceToCode(workspace);
    const distPath = this._getDistPath(blocksPath);
    await fs.writeFile(distPath, this._wrapCode(code));
    return distPath;
  }
}
```

Die Block-Generator-Definitionen werden zwischen Browser (`blockly-generator.js`) und Node.js (`blockly-blocks-node.js`) geteilt — gleicher Code, unterschiedlicher Import-Stil.

---

## NPM-Abhängigkeit

```json
"blockly": "^11.x"
```

Blockly 11 unterstützt Node.js nativ. Paketgröße: ~4 MB (vergleichbar mit `typescript`).

---

## UI-Flow

1. **Erstellen**: Wizard → "Visual (.blocks)" auswählen → Blockly-Workspace mit Starter-Blöcken öffnet sich
2. **Editieren**: Script in Sidebar anklicken → Blockly-Editor mountet (Entity/Service-Dropdowns aus HA befüllt)
3. **Speichern** (Ctrl+S oder Toolbar): Frontend sendet XML an `PUT /api/scripts/script.blocks` → Server kompiliert → Worker neu gestartet
4. **Code anzeigen**: Toolbar-Button "Show Code" → Read-only Monaco-Panel mit generiertem JS (gleiche Split-View wie Card Preview)
5. **Zu Code wechseln**: "Edit as JavaScript" → generierter Code öffnet in Monaco als `.js`, `.blocks`-Datei wird gelöscht

---

## Neue Dateien

| Datei | Zweck |
|-------|-------|
| `js_automations/core/blockly-compiler.js` | Server: XML parsen → JS generieren |
| `js_automations/public/js/blockly-editor.js` | Frontend: Workspace verwalten, Blöcke laden/speichern |
| `js_automations/public/js/blockly-blocks.js` | Custom-Block-Definitionen (Toolbox + initFunctions) |
| `js_automations/public/js/blockly-generator.js` | JS-Code-Generatoren für HA-Custom-Blöcke |

## Geänderte Dateien

### Backend
- `core/script-watcher.js` — `.blocks`-Dateien beobachten, BlocklyCompiler triggern
- `core/kernel.js` — BlocklyCompiler instanziieren
- `core/script-header-parser.js` — `<jsa>`-XML-Metadaten lesen
- `routes/scripts-routes.js` — `.blocks`-Extension erlauben
- `core/compiler-manager.js` — `pruneDist()` für `.blocks`-Quellen erweitern

### Frontend
- `public/index.html` — Blockly CDN `<script>`-Tags
- `public/js/creation-wizard.js` — "Visual (.blocks)" als dritte Sprachoption
- `public/js/tab-manager.js` — Blockly vs. Monaco je nach Dateiextension

### i18n
- `locales/de/translation.json` + `locales/en/translation.json`:  
  `wizard_option_blockly`, `blockly_show_code`, `blockly_edit_metadata`,  
  `blockly_category_triggers`, `blockly_category_actions`, `blockly_category_entities`,  
  `blockly_category_store`, `blockly_category_script`

---

## Phasen

**Phase 1 (MVP):**
- `.blocks`-Dateityp, BlocklyCompiler, ScriptWatcher-Integration
- Creation-Wizard-Option
- Alle Block-Kategorien oben
- "Show Code"-Panel (read-only)

**Phase 2 (future):**
- `ha.register()`-Block (custom MQTT-Entities)
- `ha.ask()`-Block (actionable Notifications)
- "Convert to JavaScript"-Migrationspfad
- Blockly-Block für Script Pack Cards
