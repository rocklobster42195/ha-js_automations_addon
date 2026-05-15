# AI-Unterstützung in JS Automations

Dieses Dokument beschreibt das Konzept zur Integration von KI-Assistenz in das JS Automations Addon — für die Generierung, Erklärung und das Debugging von Automations-Skripten direkt im Web-IDE.

---

## Ziel

Nutzer sollen beim Schreiben von Skripten KI-Unterstützung bekommen, ohne die Oberfläche zu verlassen. Die KI kennt dabei:

- die vollständige `ha`-API (TypeScript-Typen aus `ha-api.d.ts`)
- das Script-Header-Format (`@name`, `@expose`, `@npm`, ...)
- alle aktuell in HA vorhandenen Entities (live aus `haConnection.states`)
- den Addon-Überblick aus der `README.md` (Funktionsprinzipien, `ha.register`, Notifications, Libraries)

---

## Anbieter-Übersicht

| Anbieter | Modell | Kosten | Anmerkung |
|---|---|---|---|
| **Google Gemini** | `gemini-2.0-flash` | Kostenlos (1500 req/Tag via AI Studio) | Empfehlung für Einstieg |
| **Groq** | `llama-3.3-70b` / `qwen-2.5-coder` | Kostenlos (Rate Limit) | Gut für Code |
| **OpenAI** | `gpt-4o-mini` | ~$0.15/Mio Token | Zuverlässig |
| **Anthropic** | `claude-haiku-4-5` | ~$0.25/Mio Token | Sehr gute Code-Qualität |
| **Ollama** | z.B. `qwen2.5-coder` | Kostenlos (lokal) | Erfordert eigene Hardware |
| **LM Studio** | beliebig (lokal) | Kostenlos (lokal) | Einsteigerfreundlicher als Ollama, OpenAI-kompatibler Endpunkt |

Alle Anbieter außer nativen Anthropic-Calls sind **OpenAI-API-kompatibel** — eine einzige Implementierung via `openai` npm-Paket deckt alle ab (mit `baseURL`-Override).

---

## System-Prompt-Strategie

Jede Anfrage an die KI enthält automatisch bis zu fünf Kontext-Blöcke:

### Block 1 — Addon-Überblick (`README.md`)

Relevante Abschnitte aus der `README.md`: Key Features, Script-Header, `@expose`, `ha.register`, `ha.notify`/`ha.ask`, Libraries. Damit kennt die KI den Anwendungskontext, nicht nur nackte API-Typen.

### Block 2 — API-Referenz (`ha-api.d.ts`)

Die vollständige TypeScript-Typdefinition des `ha`-Globals. Bereits im Addon vorhanden unter `core/types/ha-api.d.ts`. Enthält alle Methoden: `ha.on`, `ha.entity`, `ha.call`, `ha.register`, `ha.states`, `ha.store`, `ha.persistent`, `ha.ask`, `ha.notify`, `ha.waitFor`, `ha.waitUntil`, `ha.localize`, `ha.schedule` etc.

### Block 3 — Script-Header-Format

```
Scripts start with a JSDoc header block:
/**
 * @name My Script
 * @description What it does
 * @icon mdi:home
 * @label Beleuchtung
 * @area living_room
 * @npm axios
 * @include utils.js
 * @expose switch
 * @loglevel debug
 */
```

### Block 4 — Live HA Entities

Kompakte Liste aus `haConnection.states` — nur `entity_id: state (friendly_name)`. Wird bei jeder Anfrage frisch befüllt, damit die KI tatsächlich vorhandene Entities verwendet (keine Phantome).

### Block 5 — Fehler-Log (optional, nur bei Debugging-Modus)

Wenn der Nutzer den Modus **Debuggen** wählt, wird der letzte Stack-Trace des Workers automatisch angehängt — als zusätzlicher User-Message-Block:

```
Current error (from worker console):
TypeError: Cannot read property 'state' of undefined
  at ha.on callback (script.js:12)
```

So muss der Nutzer den Fehler nicht manuell kopieren. Der Log wird aus dem laufenden Worker-Output des betroffenen Skripts gezogen.

### Vollständiger System-Prompt (Template)

```
You are an expert JS Automations assistant for Home Assistant.
Scripts run in isolated Worker Threads. Available globals: ha, schedule, sleep.
No require() or import unless declared with @npm.
Always output clean TypeScript or JavaScript with a JSDoc header.

## Addon Overview
[README.md — Key Features, expose, ha.register, Notifications sections]

## API Reference (TypeScript)
[ha-api.d.ts full contents]

## Script Header Format
[JSDoc header tag reference]

## Available HA Entities (live)
[entity_id: state (friendly_name), one per line]
```

---

## Architektur

### Datenfluss

```
Frontend (Editor)
  └─ POST /api/ai/generate
        ├─ prompt (user input)
        ├─ script_content? (current editor content, optional)
        └─ → ai-service.js
                ├─ System-Prompt bauen
                │    ├─ README.md (statisch, einmalig eingeladen)
                │    ├─ ha-api.d.ts (statisch, einmalig eingeladen)
                │    └─ haConnection.states (live, pro Request)
                └─ → Provider-API (Gemini / Groq / OpenAI / Claude / Ollama)
                        └─ → { code: string } → Frontend
```

API-Keys bleiben **serverseitig** — das Frontend schickt nur den Nutzer-Prompt.

### Neue Datei: `js_automations/services/ai-service.js`

```js
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');

class AiService {
    constructor(settingsManager, haConnector) {
        this.settingsManager = settingsManager;
        this.haConnector = haConnector;
        // Statische Kontextquellen einmalig einladen
        this._apiTypes = fs.readFileSync(
            path.join(__dirname, '../core/types/ha-api.d.ts'), 'utf8'
        );
        this._readme = fs.readFileSync(
            path.join(__dirname, '../../README.md'), 'utf8'
        );
    }

    _buildSystemPrompt() {
        // Entities kompakt: "light.kitchen: on (Kitchen Light)"
        const entities = Object.entries(this.haConnector.states || {})
            .map(([id, s]) => `${id}: ${s?.state ?? 'unknown'} (${s?.attributes?.friendly_name ?? ''})`)
            .join('\n');

        return [
            'You are an expert JS Automations assistant for Home Assistant.',
            'Scripts run in isolated Worker Threads. Available globals: ha, schedule, sleep.',
            'No require() or import unless declared with @npm.',
            'Always output clean TypeScript or JavaScript with a JSDoc header.',
            '',
            '## Addon Overview',
            this._readme,
            '',
            '## API Reference (TypeScript)',
            this._apiTypes,
            '',
            '## Available HA Entities (live)',
            entities,
        ].join('\n');
    }

    async generate(userPrompt, scriptContent = null, errorLog = null) {
        const settings = this.settingsManager.getSettings().ai || {};
        if (!settings.enabled || !settings.api_key) {
            throw new Error('AI is not configured. Please add your API key in Settings → AI.');
        }

        // API-Key darf NIEMALS in Logs landen — nur anonymisiert loggen
        const client = new OpenAI({
            apiKey: settings.api_key,
            baseURL: settings.base_url || undefined,
        });

        const messages = [
            { role: 'system', content: this._buildSystemPrompt() },
        ];

        if (scriptContent) {
            messages.push({ role: 'user', content: `Current script (for context):\n\`\`\`typescript\n${scriptContent}\n\`\`\`` });
        }

        if (errorLog) {
            messages.push({ role: 'user', content: `Current error (from worker console):\n${errorLog}` });
        }

        messages.push({ role: 'user', content: userPrompt });

        // Retry bei Rate Limit (HTTP 429) — max. 2 Versuche, exponential backoff
        let lastError;
        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                const resp = await client.chat.completions.create({
                    model: settings.model || 'gemini-2.0-flash',
                    messages,
                    max_tokens: 2048,
                    stream: true, // SSE-Streaming für bessere UX
                });
                return resp; // Stream-Objekt zurückgeben, Route handled SSE
            } catch (err) {
                lastError = err;
                if (err.status === 429 && attempt === 0) {
                    await new Promise(r => setTimeout(r, 2000));
                } else {
                    break;
                }
            }
        }
        // Fehler ohne API-Key loggen
        const safeErr = new Error(lastError.message);
        throw safeErr;
    }
}

module.exports = AiService;
```

### Neue Datei: `js_automations/routes/ai-route.js`

```js
// POST /api/ai/generate
// Body: { prompt: string, script_content?: string }
// Response: { code: string } | { error: string }

router.post('/generate', async (req, res) => {
    const { prompt, script_content } = req.body;
    if (!prompt) return res.status(400).json({ error: 'prompt is required' });
    try {
        const result = await kernel.aiService.generate(prompt, script_content);
        res.json({ code: result });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
```

### Provider-Konfiguration (`baseURL`)

| Provider | `base_url` in Settings |
|---|---|
| Gemini (Free) | `https://generativelanguage.googleapis.com/v1beta/openai/` |
| Groq | `https://api.groq.com/openai/v1` |
| OpenAI | *(leer lassen)* |
| Ollama (lokal) | `http://localhost:11434/v1` |
| LM Studio (lokal) | `http://localhost:1234/v1` |
| Anthropic Claude | OpenAI-kompatibler Proxy empfohlen (z.B. Amazon Bedrock / litellm) — kein extra SDK |

---

## Settings-Erweiterung

Neue Sektion `ai` in `core/settings-schema.js`:

```js
{
    id: 'ai',
    label: 'settings.sections.ai',
    icon: 'mdi:robot',
    items: [
        { key: 'enabled',   type: 'boolean', default: false },
        { key: 'provider',  type: 'select',  options: ['gemini', 'groq', 'openai', 'ollama', 'custom'] },
        { key: 'api_key',   type: 'text',    secret: true },
        { key: 'model',     type: 'text',    default: 'gemini-2.0-flash',
          hint: 'gemini-2.0-flash / llama-3.3-70b-versatile / gpt-4o-mini' },
        { key: 'base_url',  type: 'text',    placeholder: 'Nur für custom/Ollama nötig' },
    ]
}
```

---

## Frontend-Integration

### UI-Konzept: AI-Panel im Editor

```
┌─ Editor Toolbar ─────────────────────────────────────┐
│  [▶ Start]  [⟳ Restart]  [⚙ Settings]  [✨ AI]      │
└──────────────────────────────────────────────────────┘
                                               ↓ Toggle
┌─ AI Assistant ───────────────────────────────────────┐
│                                                       │
│  [✨ Generieren]  [🔍 Erklären]  [🐛 Debuggen]  [🔄 Konvertieren]  │
│  ─────────────────────────────────────────────────── │
│                                                       │
│  ┌───────────────────────────────────────────────┐   │
│  │  Beschreibe was das Skript tun soll...        │   │
│  │                                               │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  [Wenn Entity > Wert → Aktion]  [Täglich um HH:MM]   │
│  [Benachrichtigung senden]                            │
│                                                       │
│  ☑ Aktuelle Datei als Kontext mitschicken             │
│                                                       │
│  [✨ Absenden]                                        │
│                                                       │
│ ─────────────────────────────────────────────────── │
│                                                       │
│  ```typescript                                        │
│  /**                                                  │
│   * @name Bathroom Fan Logic                          │
│   * @expose switch                                    │
│   */                                                  │
│  ha.on('sensor.bathroom_humidity', ...                │
│  ```                                                  │
│                                                       │
│  [↩ In Editor einfügen]   [📋 Kopieren]              │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Vier Modi:**

| Modus | Verhalten | Checkbox "Aktuelle Datei" |
|---|---|---|
| **Generieren** | Neues Skript aus Nutzerbeschreibung | optional |
| **Erklären** | Erklärt den aktuellen Skript-Inhalt | Pflicht (auto-aktiviert) |
| **Debuggen** | Fehler analysieren + Fix vorschlagen | Pflicht + letzter Stack-Trace (Block 5) |
| **Konvertieren** | HA YAML oder ioBroker-Code → JSA-Skript | nein (eigenes Quellcode-Textarea + Format-Dropdown) |

Jeder Modus ergänzt einen Suffix im System-Prompt: z.B. `"Explain this script step by step in German."` oder `"Fix the following error and return the corrected script."`.

### Konvertierungs-Modus

Im Konvertier-Modus ersetzt ein Quellcode-Textarea das normale Prompt-Feld. Ein Format-Dropdown (`HA YAML` / `ioBroker JS`) gibt der KI den nötigen Kontext.

**Unterstützte Quellformate:**
- **Home Assistant YAML** — `automation:` Blöcke mit `trigger`, `condition`, `action`
- **ioBroker JavaScript** — `on()`, `setState()`, `getState()`, `schedule()`, `log()`

**Mapping HA YAML → JSA:**

| HA YAML | JSA-Äquivalent |
|---|---|
| `trigger: platform: state` | `ha.on('entity_id', e => {...})` |
| `trigger: platform: time` / `time_pattern` | `schedule('0 9 * * *', () => {...})` |
| `condition: state` | `if (ha.getStateValue('entity_id') === 'on')` |
| `action: service: light.turn_on` | `ha.call('light.turn_on', {entity_id: ...})` |
| `action: service: notify.*` | `ha.notify(message, {title: ...})` |
| `choose:` / `if:` | JS `if/else` oder `switch` |
| Template `{{ states('...') }}` | `ha.getStateValue('entity_id')` |
| Template `{{ state_attr('...') }}` | `ha.getAttr('entity_id', 'attr')` |

HA YAML verwendet in der Regel bereits echte Entity-IDs — diese werden 1:1 übernommen. Ausnahme: via HA-UI exportierte Automationen enthalten häufig UUIDs statt Entity-IDs (`device_id`, `entity_id` als Registry-Entry-UUID). Diese werden serverseitig vor der KI-Anfrage aufgelöst (siehe **Registry-Lookup** unten).

**HA Registry-Lookup (Vorverarbeitung, nur bei HA YAML):**

Der `ai-service.js` lädt einmalig (oder gecacht) die HA-Registries via WebSocket und substituiert alle UUIDs im YAML bevor er die KI aufruft:

```js
async _resolveYamlIds(yaml) {
    const [entityRegistry, deviceRegistry] = await Promise.all([
        this.haConnector.sendMessage({ type: 'config/entity_registry/list' }),
        this.haConnector.sendMessage({ type: 'config/device_registry/list' }),
    ]);

    // entity registry entry UUID → entity_id (z.B. "aa39e7a4..." → "binary_sensor.kueche_praesenz")
    const entryMap = Object.fromEntries(entityRegistry.map(e => [e.id, e.entity_id]));

    // device_id UUID → erste zugehörige entity_id
    const deviceMap = {};
    for (const e of entityRegistry) {
        if (e.device_id && !deviceMap[e.device_id]) deviceMap[e.device_id] = e.entity_id;
    }

    return yaml
        .replace(/\b([0-9a-f]{32})\b/g, (uuid) => entryMap[uuid] || deviceMap[uuid] || uuid);
}
```

Nicht auflösbare UUIDs bleiben unverändert — die KI setzt dann `ENTITY_TODO` als Fallback.

**Trigger-Typ → State-Wert:** HA-Trigger-Typen wie `not_present`, `turned_on` etc. sind HA-interne Enum-Werte, keine State-Strings. Die KI leitet den korrekten State-Wert aus `domain` und `device_class` der (aufgelösten) Entity ab — diese Information steckt bereits in der Live-Entity-Liste (Block 4):

| HA Trigger-Typ | Domain / device_class | JSA State-Check |
|---|---|---|
| `turned_on` | beliebig | `e.state === 'on'` |
| `turned_off` | beliebig | `e.state === 'off'` |
| `present` | `binary_sensor` / presence, occupancy | `e.state === 'on'` |
| `not_present` | `binary_sensor` / presence, occupancy | `e.state === 'off'` |
| `home` | `person`, `device_tracker` | `e.state === 'home'` |
| `not_home` | `person`, `device_tracker` | `e.state === 'not_home'` |

**Mapping ioBroker → JSA:**

| ioBroker | JSA-Äquivalent |
|---|---|
| `on({id: '...', change: 'any'}, cb)` | `ha.on('entity_id', e => {...})` |
| `getState('...').val` | `ha.getStateValue('entity_id')` |
| `setState('...', value)` | `ha.update('entity_id', value)` |
| `schedule('cron', cb)` | `schedule('cron', cb)` *(identisch)* |
| `log(msg)` | `ha.log(msg)` |
| `clearSchedule(id)` | `ha.onStop(() => {...})` |

**Entity-ID-Mapping (ioBroker):** ioBroker-Object-IDs (z.B. `hm-rpc.0.OEQ1234567.1.STATE`) lassen sich nicht automatisch auf HA-Entity-IDs abbilden. Die KI verwendet den Platzhalter `'ENTITY_TODO /* original: hm-rpc.0.OEQ1234567.1.STATE */'`. Nach dem Einfügen in Monaco werden alle `ENTITY_TODO`-Vorkommen mit gelben Squiggles und einem Hover-Tooltip markiert (siehe `markEntityTodos()` unten).

**System-Prompt-Suffix für Konvertier-Modus:**

```
## Conversion Task
The user provides code in [HA YAML / ioBroker JS] format.
Convert it 1:1 to a valid JSA script. Rules:
- Map all triggers, conditions, and actions using the JSA API shown above
- HA YAML entity_ids are already resolved — use them as-is
- For HA device trigger types (not_present, present, turned_on, etc.): look up the entity
  in the provided entity list, check its domain and device_class attribute, and use the
  correct state value (e.g. binary_sensor with device_class:presence → 'off' for not_present)
- Remaining unresolved UUIDs and ioBroker object IDs cannot be mapped —
  use 'ENTITY_TODO /* original: <id> */' as placeholder
- Generate a proper JSDoc header (@name, @description, @icon)
- Prefer ha.entity().service() over ha.call() for readability
- Replace all Jinja2 templates with JS equivalents
- Output only the converted TypeScript/JS script, no explanation
```

**Quick-Prompts:** Vorgefertigte Template-Buttons füllen das Eingabefeld vor. Klick → Text erscheint im Feld, Nutzer ergänzt nur noch Entity-Namen und Werte.

**Ablauf:**
1. Nutzer klickt "AI" in der Toolbar → Panel öffnet sich als Side-Drawer rechts
2. Modus auswählen (Standard: Generieren)
3. Nutzer tippt Prompt oder wählt einen Quick-Prompt
4. Optional: Checkbox "Aktuelle Datei als Kontext" aktivieren
5. Backend baut System-Prompt (inkl. Fehler-Log bei Debuggen), ruft Provider ab
6. Antwort erscheint im Panel via SSE-Streaming (Token für Token)
7. "In Editor einfügen" → **speichert zuerst die aktuelle Datei**, dann wird Monaco-Inhalt ersetzt

### Neue Datei: `js_automations/public/js/ai-panel.js`

Kernfunktionen:
- `toggleAiPanel()` — Panel ein-/ausblenden, Panel-State in `localStorage` merken
- `setMode(mode)` — schaltet zwischen `generate` / `explain` / `debug` / `convert` um; im Convert-Modus: Prompt-Textarea ausblenden, Quellcode-Textarea + Format-Dropdown einblenden
- `insertQuickPrompt(template)` — füllt Textfeld mit vorgefertigtem Template (z.B. `"Wenn [entity_id] > [Wert], dann..."`)
- `submitAiPrompt()` — POST an `/api/ai/generate`, SSE-Stream lesen, Token-für-Token in Panel rendern
- `submitConversion()` — bei HA YAML: erst `POST /api/ai/resolve-yaml` (UUID-Auflösung via Registry), dann konvertiertes YAML an `submitAiPrompt()`; bei ioBroker JS: direkt an AI
- `insertIntoEditor(code)` — **erst `saveCurrentFile()` aufrufen**, dann `window.editor.setValue(code)`; danach `markEntityTodos(editor)` aufrufen
- Code-Block aus Markdown-Antwort extrahieren (zwischen ` ```typescript ` und ` ``` `)
- `markEntityTodos(editor)` — setzt Monaco-Marker für alle `ENTITY_TODO`-Vorkommen:

```js
function markEntityTodos(editor) {
    const model = editor.getModel();
    const markers = [];
    const regex = /ENTITY_TODO/g;
    let match;
    while ((match = regex.exec(model.getValue())) !== null) {
        const pos = model.getPositionAt(match.index);
        markers.push({
            severity: monaco.MarkerSeverity.Warning,
            startLineNumber: pos.lineNumber,
            startColumn: pos.column,
            endLineNumber: pos.lineNumber,
            endColumn: pos.column + 'ENTITY_TODO'.length,
            message: 'Entity ID not mapped — replace with a valid HA entity ID',
            source: 'JSA AI Converter'
        });
    }
    monaco.editor.setModelMarkers(model, 'jsa-converter', markers);
    // Marker löschen sobald keine TODOs mehr vorhanden: setModelMarkers(model, 'jsa-converter', [])
}
```

**Monaco Rechtsklick-Integration:**

Über `editor.addAction()` werden zwei Kontextmenü-Einträge registriert, die bei markiertem Code erscheinen:

```js
editor.addAction({
    id: 'ai-explain-selection',
    label: 'AI: Markierung erklären',
    contextMenuGroupId: 'ai',
    run: (ed) => {
        const selected = ed.getModel().getValueInRange(ed.getSelection());
        openAiPanel('explain', selected);
    }
});

editor.addAction({
    id: 'ai-improve-selection',
    label: 'AI: Markierung verbessern',
    contextMenuGroupId: 'ai',
    run: (ed) => {
        const selected = ed.getModel().getValueInRange(ed.getSelection());
        openAiPanel('generate', `Improve this code:\n\`\`\`typescript\n${selected}\n\`\`\``);
    }
});
```

---

## Dateien-Übersicht

| Datei | Status | Änderung |
|---|---|---|
| `docs/ai_concept.md` | Dieses Dokument | — |
| `js_automations/services/ai-service.js` | Neu | Provider-Abstraction, System-Prompt-Builder |
| `js_automations/routes/ai-route.js` | Neu | `POST /api/ai/generate` |
| `js_automations/server.js` | Ändern | AI-Route einbinden, AiService an Kernel übergeben |
| `js_automations/core/kernel.js` | Ändern | `this.aiService = new AiService(settingsManager, haConnector)` |
| `js_automations/core/settings-schema.js` | Ändern | AI-Sektion hinzufügen |
| `js_automations/public/js/ai-panel.js` | Neu | Panel-UI, API-Call, Code-Einfügen |
| `js_automations/public/css/style.css` | Ändern | Panel-Styles |

---

## npm-Abhängigkeit

```
openai
```

Wird für alle OpenAI-kompatiblen Anbieter (Gemini, Groq, OpenAI, Ollama) benötigt. Für Anthropic Claude alternativ `@anthropic-ai/sdk`.

**Fallback ohne npm:** Alle Provider unterstützen direktes `fetch` gegen ihre REST-APIs — die `openai`-Bibliothek ist ein Komfort-Wrapper, kein Muss.

---

## Offene Entscheidungen

| # | Frage | Empfehlung |
|---|---|---|
| 1 | **Streaming** | ✅ **SSE mit `stream: true`** — `openai`-Package nativ unterstützt, Monaco kann Token-für-Token updaten via `model.applyEdits()`. Deutlich bessere UX bei langen Skripten. |
| 2 | **Chat-History** | ✅ **Multi-Turn** — Typischer Flow ist iterativ ("Füge Delay ein", "Logge auch den Wert"). Single-Turn zwingt Nutzer zur vollständigen Neu-Beschreibung. Bei kurzen Skripten kaum Token-Mehrkosten. |
| 3 | **README-Umfang** | Vollständig (sicher, ~400 Zeilen) vs. nur relevante Sections (spart Tokens) — noch offen |
| 4 | **Panel-Position** | ✅ **Side-Drawer rechts** — festgelegt im UI-Konzept |
| 5 | **Claude-Support** | ✅ **OpenAI-kompatibler Proxy** (litellm / Amazon Bedrock) — kein zweites SDK, gleiche Codebasis |

---

## Roadmap

### Phase 1 — MVP ✦

Ziel: Funktionierendes AI-Panel das sofort echten Mehrwert liefert.

| Feature | Beschreibung |
|---|---|
| Settings-Sektion `ai` | Provider, API-Key, Modell, base_url |
| `AiService` + `/api/ai/generate` | System-Prompt (Blöcke 1–4), OpenAI-kompatibler Client |
| Modus: **Generieren** | Freitext-Prompt → JSA-Skript mit JSDoc-Header |
| Checkbox "Aktuelle Datei" | Editor-Inhalt als Kontext mitschicken |
| **In Editor einfügen** | Auto-Save vor Überschreiben |
| Gemini Free als Default | Kostenloser Einstieg ohne Kreditkarte |
| Rate-Limit-Handling | Retry bei 429 + klare UI-Meldung |
| API-Key-Schutz | Key nie in Logs |

**Nicht im MVP:** Streaming, Chat-History, weitere Modi. Komplett-Antwort reicht zum Validieren.

---

### Phase 2 — UX & Qualität

| Feature | Beschreibung |
|---|---|
| SSE-Streaming | Token-für-Token Ausgabe via `stream: true` |
| Modus: **Erklären** | Skript-Inhalt erklären lassen |
| Modus: **Debuggen** | Fehler-Log (Block 5) automatisch anhängen |
| Quick-Prompts | Template-Buttons unter dem Eingabefeld |
| Monaco Rechtsklick | "AI: Erklären" / "AI: Verbessern" auf Selektion |
| Multi-Turn Chat | Folgefragen ohne Kontext-Verlust |

---

### Phase 3 — Konvertierung

| Feature | Beschreibung |
|---|---|
| Modus: **Konvertieren** | HA YAML / ioBroker JS → JSA |
| HA Registry-Lookup | UUIDs (device_id, entity-entry-id) vor KI-Aufruf auflösen |
| Trigger-Typ-Mapping | `not_present` etc. via `device_class` korrekt übersetzen |
| Area / Label-Auflösung | `area_id` / `label_id` in Actions → Entity-Liste |
| `ENTITY_TODO` + Monaco-Marker | Fallback für nicht auflösbare IDs |
| `variables:` / `repeat:` | YAML-Blöcke → JS-Äquivalente |

---

### Phase 4 — Erweiterungen (Future)

| Feature | Beschreibung |
|---|---|
| Node-RED JSON (lineare Flows) | Trigger/Action-Nodes → JSA |
| LM Studio / Ollama Quicksetup | Guided Setup für lokale Modelle im Settings-Dialog |
| AI-generierte Script-Metadaten | Name, Icon, Label nach Generierung vorschlagen |

---

## Verifikation (nach Implementierung)

1. Settings → AI: Sektion sichtbar, API-Key speichern → kein Fehler
2. `POST /api/ai/generate` ohne API-Key → `{ error: 'AI is not configured...' }`
3. Gemini Free (Key aus Google AI Studio): Prompt → Skript wird generiert mit korrektem JSDoc-Header
4. Checkbox "Aktuelle Datei als Kontext": Editor-Inhalt taucht im gesendeten Prompt auf (DevTools Network)
5. "In Editor einfügen": Monaco-Inhalt wird korrekt ersetzt
6. Entity-Namen in generiertem Code entsprechen tatsächlich vorhandenen Entities aus der Live-Liste
7. Konvertier-Modus (HA YAML): Automation einfügen → JSA-Skript korrekt generiert, Entity-IDs direkt übernommen
8. Konvertier-Modus (ioBroker): Skript mit `hm-rpc.0.XYZ`-IDs → `ENTITY_TODO`-Platzhalter im Output, Monaco zeigt gelbe Squiggles mit Tooltip
