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

Alle Anbieter außer Ollama sind **OpenAI-API-kompatibel** — eine einzige Implementierung via `openai` npm-Paket deckt alle ab (mit `baseURL`-Override).

---

## System-Prompt-Strategie

Jede Anfrage an die KI enthält automatisch vier Kontext-Blöcke:

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

    async generate(userPrompt, scriptContent = null) {
        const settings = this.settingsManager.getSettings().ai || {};
        if (!settings.enabled || !settings.api_key) {
            throw new Error('AI is not configured. Please add your API key in Settings → AI.');
        }

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

        messages.push({ role: 'user', content: userPrompt });

        const resp = await client.chat.completions.create({
            model: settings.model || 'gemini-2.0-flash',
            messages,
            max_tokens: 2048,
        });

        return resp.choices[0].message.content;
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
| Anthropic Claude | Eigenes SDK nötig — nicht OpenAI-kompatibel ohne Wrapper |

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
│  ┌───────────────────────────────────────────────┐   │
│  │  Beschreibe was das Skript tun soll...        │   │
│  │                                               │   │
│  └───────────────────────────────────────────────┘   │
│                                                       │
│  ☑ Aktuelle Datei als Kontext mitschicken             │
│                                                       │
│  [✨ Generieren]                                      │
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

**Ablauf:**
1. Nutzer klickt "AI" in der Toolbar → Panel öffnet sich als Side-Drawer rechts
2. Nutzer tippt Prompt: _"Schalte den Badezimmerlüfter ein wenn Luftfeuchtigkeit > 70%, aus bei < 55%"_
3. Optional: Checkbox "Aktuelle Datei als Kontext" aktivieren → Editor-Inhalt wird mitgeschickt (für Erklärung / Erweiterung bestehender Skripte)
4. Backend baut System-Prompt, ruft Provider ab
5. Antwort (Code-Block) erscheint im Panel
6. "In Editor einfügen" → ersetzt den gesamten Monaco-Inhalt (mit Bestätigung wenn Datei dirty)

### Neue Datei: `js_automations/public/js/ai-panel.js`

Kernfunktionen:
- `toggleAiPanel()` — Panel ein-/ausblenden, Panel-State in `localStorage` merken
- `submitAiPrompt()` — POST an `/api/ai/generate`, Loading-Spinner, Fehlerbehandlung
- `insertIntoEditor(code)` — `window.editor.setValue(code)` (Monaco-Global aus `app.js`)
- Code-Block aus Markdown-Antwort extrahieren (zwischen ` ```typescript ` und ` ``` `)

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

| # | Frage | Optionen |
|---|---|---|
| 1 | **Streaming** | Token-für-Token (SSE, bessere UX) vs. Komplett-Antwort (einfacher) |
| 2 | **Chat-History** | Single-Turn (einfach) vs. mehrturnig mit Context (Folgefragen möglich) |
| 3 | **README-Umfang** | Vollständig (sicher, ~400 Zeilen) vs. nur relevante Sections (spart Tokens) |
| 4 | **Panel-Position** | Side-Drawer rechts vs. Modal vs. separater Tab |
| 5 | **Claude-Support** | Über `@anthropic-ai/sdk` nativ vs. OpenAI-kompatibler Proxy |

---

## Verifikation (nach Implementierung)

1. Settings → AI: Sektion sichtbar, API-Key speichern → kein Fehler
2. `POST /api/ai/generate` ohne API-Key → `{ error: 'AI is not configured...' }`
3. Gemini Free (Key aus Google AI Studio): Prompt → Skript wird generiert mit korrektem JSDoc-Header
4. Checkbox "Aktuelle Datei als Kontext": Editor-Inhalt taucht im gesendeten Prompt auf (DevTools Network)
5. "In Editor einfügen": Monaco-Inhalt wird korrekt ersetzt
6. Entity-Namen in generiertem Code entsprechen tatsächlich vorhandenen Entities aus der Live-Liste
