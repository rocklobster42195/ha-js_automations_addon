# 🔥 Konzept: Migration auf LIT

Dieses Dokument beschreibt den Plan, das bestehende Vanilla-JS Frontend (`js_automations/public`) auf [LIT](https://lit.dev) (Web Components) umzustellen. Ersetzt das frühere Angular-Konzept.

Ziel-Version: nächste **Major-Version**.

> **Hinweis:** Der Backend-Umbau auf TypeScript sowie Lint/Test-Infrastruktur laufen als eigene Workstreams parallel (siehe Abschnitt 7/8), sind aber unabhängig von der Frontend-Migration und können jederzeit vor-/nachgezogen werden.

## 0. Ziele

- **"Aus einem Guss"**: konsistentes Look & Feel über alle Bereiche (Editor, Store Explorer, Logs, Settings, Watch, MQTT-Monitor, ...) durch gemeinsame Design-Tokens.
- **Mobil nutzbar**: Skriptstatus prüfen, Skript starten/stoppen/neustarten, Logs lesen — ohne dass dafür der Editor/volle Desktop-Oberfläche nötig ist.
- **Weniger manuelles DOM-Handling**: reaktive Properties statt manueller `innerHTML`/`querySelector`-Updates wie aktuell in `script-list.js`, `store-explorer.js` etc.
- **Kein Big-Bang**: Migration bei laufendem Betrieb, Komponente für Komponente.

## 1. Warum LIT?

1. **Standardbasiert:** Web Components (`CustomElementRegistry`, Shadow DOM) — kein proprietäres Laufzeit-Framework, kein Vendor-Lock-in, funktioniert langfristig ohne Framework-Migrationen.
2. **Inkrementell einsetzbar:** Jede LIT-Komponente ist ein normales `<my-component>`-Element und kann einzeln in das bestehende `index.html` eingehängt werden, während der Rest weiter Vanilla-JS bleibt. Kein App-Shell-Zwang wie bei Angular/React-Router.
3. **Klein:** ~5 kB Kern-Runtime, kein zwingender Build-Step (funktioniert direkt per ESM), wichtig für ein leichtgewichtiges Addon-UI auf Mobilgeräten.
4. **Style-Isolation ohne Verlust an Konsistenz:** Shadow DOM kapselt Komponenten-Styles, aber CSS Custom Properties (Design-Tokens) durchdringen die Kapselung — genau das richtige Werkzeug für "aus einem Guss" bei gleichzeitig sauber getrennten Komponenten.
5. **TypeScript first-class:** Reaktive Properties per Decorator (`@property()`, `@state()`), passt zu den bereits vorhandenen `ha-api.d.ts`-Typen.
6. **Geringe Lernkurve:** Kein RxJS, keine Dependency-Injection-Container, keine Module-Bürokratie — Klassen mit reaktiven Properties, näher an dem, was das Frontend heute schon informell macht.

## 2. Migrations-Schritte (To-Do)

1. **Projekt-Setup:**
   - `lit` als Dependency in `js_automations` aufnehmen (kein separates Frontend-Projekt/Ordner nötig — LIT braucht keinen eigenen Build-Server).
   - Build-Step nur für Bundling/Minifying (z. B. esbuild), Output weiterhin nach `public/`.
2. **Design-Tokens zuerst:**
   - CSS Custom Properties aus `style.css` in eine zentrale `tokens.css` extrahieren (Farben, Spacing, Radien, Schrift). Wird von jeder LIT-Komponente über `:host` referenziert.
3. **Core-Module (kein DI-Container, einfache ES-Module):**
   - `api.js` (bereits vorhanden) bleibt die REST-Fassade.
   - `socket-client.js` (bereits vorhanden) bleibt die Socket.IO-Fassade, LIT-Komponenten abonnieren direkt.
4. **Komponenten-Neubau:** schrittweise, siehe Abschnitt 3 und 6 (Reihenfolge nach Risiko/Nutzen).
5. **Internationalisierung:** bestehende `i18next`-Lösung (`i18n.js`, `locales/de|en/translation.json`) bleibt unverändert — LIT-Komponenten rufen `t()` wie bisher auf.

## 3. Geplante Komponenten-Struktur

Die aktuelle Datei-Struktur (`public/js/*.js`) wird in LIT-Custom-Elements überführt:

### Haupt-Layout
- `<app-shell>`: Root-Container (ersetzt Teile von `app.js`, `layout.js`).
- `<app-header>`: Logo, Status-Indikatoren, globale Aktionen.
- `<app-sidebar>`: Suche, Skript-Liste (enthält `<script-group>` und `<script-row>`, ersetzt `script-list.js`).
- `<status-bar>`: ersetzt `statusbar.js`.
- `<editor-view>`: Monaco-Wrapper und Tab-Leiste (ersetzt Teile von `tab-manager.js`, `editor-config.js`).

### Feature-Komponenten
- `<store-explorer>`: Tabelle, Filterung, CRUD für `ha.store` (ersetzt `store-explorer.js`).
- `<log-viewer>`: Live-Logs, abonniert `socket-client.js` (ersetzt `log-viewer.js`).
- `<mqtt-monitor>`: ersetzt `mqtt-monitor.js`.
- `<event-inspector>`: ersetzt `event-inspector.js`.
- `<watch-panel>`: ersetzt `watch.js`.
- `<webhook-panel>`: ersetzt `webhook-panel.js`.
- `<settings-view>`: ersetzt `settings.js`.
- `<repl-panel>`: ersetzt `repl.js`.
- `<integration-banner>`: ersetzt `integration-banner.js`.
- `<safe-mode-banner>`: ersetzt `safe-mode.js`.

### Modale / Dialoge
Alle Modals **und** native Browser-Dialoge (`alert()`, `confirm()`) werden durch LIT-Komponenten ersetzt — native Dialoge lassen sich weder stylen noch auf Mobilgeräten vernünftig bedienen und passen nicht zu "aus einem Guss".

- `<script-modal>`: Erstellen/Bearbeiten/Duplizieren (ersetzt Teile von `creation-wizard.js`).
- `<store-item-modal>`: Variablen editieren (ersetzt das dynamisch erzeugte Modal in `store-explorer.js`).
- `<entity-picker-modal>`: ersetzt die zwei statischen Instanzen `#entity-picker-modal` / `#settings-entity-picker-modal` in `index.html` durch eine einzige wiederverwendbare Komponente.
- `<confirm-dialog>`: generischer Ersatz für alle `confirm(...)`-Aufrufe (aktuell in `script-list.js`, `log-viewer.js`, `tab-manager.js`, `store-explorer.js`, `webhook-panel.js` — ca. 9 Call-Sites).
- `<alert-toast>`: nicht-blockierender Ersatz für alle `alert(...)`-Aufrufe (aktuell in `creation-wizard.js`, `safe-mode.js`, `store-explorer.js`, `settings.js`, `webhook-panel.js` — ca. 12 Call-Sites). Wichtig für Mobil: `alert()` blockiert den ganzen Tab.
- `<card-preview>`: ersetzt `card-preview.js`.

`<confirm-dialog>` und `<alert-toast>` werden früh gebaut (Phase A, siehe Abschnitt 4 — sind neue, eigenständige Dateien ohne Überschneidung mit `feature/blockly-integration`), aber pro Aufrufstelle erst dann verdrahtet, wenn die jeweilige Host-Datei an der Reihe ist (z. B. `store-explorer.js`/`log-viewer.js`/`settings.js`/`safe-mode.js` schon in Phase A, `script-list.js`/`tab-manager.js`/`webhook-panel.js`/`creation-wizard.js` erst in Phase B).

### Monaco-Editor
- `<monaco-editor>`: kapselt die aktuell über mehrere Dateien verteilte Monaco-Init (`app.js`, `tab-manager.js`, `statusbar.js`, `editor-config.js`, `editor-snippets.js`) hinter `@property value`, `@event content-changed`.

## 4. Reihenfolge des inkrementellen Austauschs

Kein Big-Bang — jede Zeile steht für einen eigenen, in Produktion auslieferbaren Schritt.

> **Abhängigkeit Blockly:** Parallel läuft `feature/blockly-integration` (eigener Worktree `C:\dev\ha-js_automations_addon-blockly`, wird noch länger dauern). Per Drei-Punkt-Diff zum gemeinsamen Vorfahren (`631d75d`) ändert der Branch tatsächlich nur: `tab-manager.js` (109 Zeilen), `creation-wizard.js` (33 Zeilen) — signifikant — sowie `script-list.js` (2 Zeilen) und `app.js` (7 Zeilen) — trivial. `statusbar.js`, `watch.js`, `mqtt-monitor.js`, `webhook-panel.js`, `api.js`, `socket-client.js` sind **nicht** betroffen (frühere Analyse per Zwei-Punkt-Diff war hier durch unabhängigen main-Fortschritt verfälscht). Reihenfolge daher in zwei Phasen:

**Phase A — jetzt sicher:**
1. `<integration-banner>`, `<safe-mode-banner>` (klein/isoliert, guter Machbarkeitsnachweis)
2. `<log-viewer>` (Live-Daten via Socket, testet die Reaktivitäts-Story)
3. `<status-bar>`, `<mqtt-monitor>`, `<watch-panel>`, `<webhook-panel>`
4. `<store-explorer>`, `<event-inspector>`, `<settings-view>`
5. `<app-sidebar>` + `<script-row>`/`<script-group>` (`script-list.js`-Anteil minimal, vertretbares Restrisiko)
6. `<card-preview>`, Dialoge (`<store-item-modal>`, `<confirm-dialog>`, `<alert-toast>`, `<entity-picker-modal>`)

**Phase B — erst nach dem Blockly-Merge (signifikante Überschneidung):**
7. `<script-modal>` (`creation-wizard.js`)
8. `<editor-view>` + `<monaco-editor>` (`tab-manager.js`, komplexeste Komponente, zuletzt)

Vor Beginn von Phase B: prüfen, ob `feature/blockly-integration` gemerged ist. Falls nicht, bei Bedarf mit Phase A / anderen Prioritäten weitermachen statt zu warten.

Solange eine Komponente noch nicht migriert ist, bleibt ihr Vanilla-JS-Pendant unverändert in Betrieb.

## 5. Vorarbeiten (jetzt schon am Vanilla-Frontend möglich)

Framework-unabhängig, senken den Migrationsaufwand unabhängig davon ob/wann eine Komponente drankommt:

- **CSS aufteilen:** `style.css` (2300+ Zeilen) in komponentenausgerichtete Dateien trennen (eigenes Vorhaben, siehe separates Todo — nicht mit dieser Migration vermischen).
- **Design-Tokens extrahieren:** CSS-Variablen zentral in `tokens.css` sammeln, bevor die erste Komponente gebaut wird.
- **`window.*`-Globals inventarisieren:** aktuell ca. 80 globale Funktionen/Variablen. Für jede neue Komponente: welche Globals werden abgelöst, welche bleiben (von noch nicht migrierten Bereichen genutzt)?
- **Socket-Events katalogisieren** (Server→Client / Client→Server, Payload-Form) — wird zu `@property`/Event-Listenern in den jeweiligen Komponenten:
  `integration_status`, `status_update`, `log`, `system_stats`, `ha_state_changed`, `mqtt_status_changed`, `safe_mode`, `get_integration_status`, `get_ha_states`.
- **REST-API katalogisieren** — bereits größtenteils in `api.js` gekapselt, prüfen ob Rückgabeformen für `@property`-Bindings passen (`api/scripts`, `api/scripts/control`, `api/scripts/import`, `api/settings`, `api/settings/schema`, `api/store`, `api/store/dirty`, `api/logs`, `api/ha/metadata`, `api/ha/services`, `api/mqtt/test`, `api/mqtt/discover`, `api/status`, `api/system/safe-mode/resolve`).
- **Monaco-Facade extrahieren:** aktuell über `app.js`/`tab-manager.js`/`statusbar.js`/`editor-config.js` verteilt — vor der `<monaco-editor>`-Migration in einer Fassade bündeln (`init`, `getValue`, `setValue`, `setLanguage`, `onDidChangeContent`, `layout`).
- **Inline-Styles aus JS entfernen:** `element.style.xxx = ...` durch CSS-Klassen ersetzen (außer dynamisch berechnete Werte) — LIT-Templates arbeiten mit `classMap`/`styleMap`, nicht mit direktem Style-Zugriff.

## 6. State-Management

Kein zentraler Store nötig für den Start — bestehende Muster bleiben, nur reaktiv gekapselt:

- Jede Feature-Komponente hält ihren eigenen State (`@state()`), gespeist von `socket-client.js`-Events bzw. `api.js`-Aufrufen.
- Gemeinsam benötigter State (z. B. Skriptliste für Sidebar *und* Editor-Tabs) wird über ein leichtgewichtiges Pub/Sub-Modul (`script-state.js`, kein RxJS) geteilt, auf das mehrere Komponenten lauschen — analog zum heutigen `window.allScripts`, nur ohne globale Variable.
- Bei wachsendem Bedarf später evaluierbar: [`@lit/context`](https://lit.dev/docs/data/context/) für Dependency-Sharing über Komponentengrenzen ohne Prop-Drilling.

## 7. Backend auf TypeScript (separates Workstream)

`typescript` ist bereits Dependency (aktuell primär für `.d.ts`-Typprüfung). Vorgehen:

1. `checkJs` + `allowJs` in `tsconfig.json` aktivieren, bestehendes JS ohne Umbenennung typprüfen lassen, Fehler schrittweise beheben.
2. Modul für Modul auf `.ts` umstellen (kein Stichtag) — Reihenfolge nach Kritikalität/Änderungshäufigkeit, `core/` vor `routes/` vor `services/` oder umgekehrt je nach Bedarf.
3. `ha-api.d.ts` als Referenz für Nutzerskript-Typen bleibt unverändert bestehen; interner Backend-Code bekommt eigene Typen.
4. CommonJS-Modulsystem vorerst beibehalten, kein Umstieg auf ESM als Teil dieses Workstreams.

## 8. Lint & Test

Unabhängig von LIT/TS-Umbau, aber gleiche Major-Version:

1. **Lint:** ESLint + Prettier-Baseline für `js_automations/` (Backend + Frontend), Konfiguration committen, in `npm run dev`/CI einbinden.
2. **Test — Backend zuerst** (höherer Wert, geringeres Risiko): Node-Test-Runner oder Vitest für `core/`, `services/`, `routes/`.
3. **Test — Frontend danach:** `@open-wc/testing` für neue LIT-Komponenten, sobald vorhanden. Kein nachträgliches Testen des auslaufenden Vanilla-Codes.

## 9. i18n

Keine Änderung nötig — `i18next` bleibt, Übersetzungsdateien (`locales/de|en/translation.json`) weiter pflegen wie bisher, auch wenn Komponenten auf LIT umgestellt werden.
