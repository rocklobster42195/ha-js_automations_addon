# 🅰️ Konzept: Migration auf Angular

Dieses Dokument beschreibt einen Plan, das bestehende Vanilla-JS Frontend (`/public`) auf ein modernes Angular-Framework umzustellen.

> **Hinweis:** Das Node.js Backend (Worker Threads, HA-Anbindung) bliebe davon unberührt.

## 1. Warum Angular?

Angesichts der wachsenden Komplexität (siehe Roadmap Meilensteine wie "System Settings" oder "Resource Monitor") bietet Angular entscheidende Vorteile:

1.  **Struktur & Skalierbarkeit:** Erzwungene Komponenten-Architektur und Module erleichtern die Wartung.
2.  **Typsicherheit:** Durchgängiges TypeScript (nutzt bereits vorhandene `entities.d.ts`) reduziert Laufzeitfehler.
3.  **Dependency Injection:** Saubere Verwaltung von API- und WebSocket-Services ohne globale Variablen.
4.  **Reaktivität (RxJS):** Perfekt für die Echtzeit-Datenströme (Logs, Status) via WebSocket.
5.  **Tooling:** Mächtige CLI für Builds, Tests und Code-Generierung.

## 2. Migrations-Schritte (To-Do)

1.  **Projekt-Setup:**
    *   Neues Angular-Projekt in einem Unterordner (z.B. `/frontend`) anlegen.
2.  **Build-Prozess:**
    *   Konfiguration des Build-Outputs nach `/public` (damit das Node-Backend die statischen Dateien ausliefern kann).
    *   Anpassung von `npm run dev` für parallele Ausführung (Backend + `ng serve` mit Proxy).
3.  **Core Services:**
    *   `ApiService`: Kapselung aller REST-Aufrufe (`fetch` ablösen).
    *   `WebSocketService`: Zentrales Handling der Socket-Verbindung mit RxJS Observables.
4.  **Komponenten-Neubau:**
    *   Schrittweises Nachbauen der UI-Elemente (siehe unten).
5.  **Internationalisierung:**
    *   Ablösung der aktuellen `i18next` Implementierung durch `ngx-translate` oder Angular i18n.

## 3. Geplante Komponenten-Struktur

Die aktuelle monolithische Struktur (`script-list.js`, `store-explorer.js`) würde in hierarchische Komponenten aufgebrochen:

### Haupt-Layout
*   `AppComponent`: Root-Container.
*   `HeaderComponent`: Logo, Status-Indikatoren, Global Actions.
*   `SidebarComponent`: Suche, Skript-Liste (enthält `ScriptGroupComponent` und `ScriptRowComponent`).
*   `EditorViewComponent`: Monaco-Editor Wrapper und Tab-Leiste.

### Feature-Komponenten
*   `StoreExplorerComponent`: Tabelle, Filterung und CRUD-Aktionen für `ha.store`.
*   `LogPanelComponent`: Anzeige der Live-Logs (abonniert `WebSocketService`).
*   `SettingsComponent`: (Geplant für M8) Zentrale Einstellungen.

### Modale / Dialoge
*   `ScriptModalComponent`: Erstellen/Bearbeiten/Duplizieren (Wizard).
*   `StoreItemModalComponent`: Variablen editieren.
*   `ConfirmationDialogComponent`: Generische "Sind Sie sicher?"-Abfragen.

## 4. Vorarbeiten (Migration-Ready machen)

Diese Schritte können **jetzt** am bestehenden Vanilla-Frontend durchgeführt werden, ohne Angular anzufassen. Sie senken den Migrations-Aufwand erheblich.

---

### 4.1 CSS aufteilen

Die monolithische `style.css` (1000+ Zeilen) wird in komponentenausgerichtete Dateien aufgetrennt. Jede Datei entspricht direkt dem späteren Angular-Component und wird ohne Änderung zu dessen `styleUrls`.

```
public/css/
  base.css                → styles.scss  (reset, CSS-Variablen, Button-Reset)
  sidebar.css             → SidebarComponent
  statusbar.css           → StatusBarComponent
  script-list.css         → ScriptListComponent
  editor.css              → EditorComponent  (Tabs, Monaco-Fix, Snippet-Toolbar, Resizer)
  logs.css                → LogPanelComponent
  modal.css               → ScriptModalComponent  (Grid, NPM-Tags, Entity-Picker)
  store-explorer.css      → StoreExplorerComponent
  settings.css            → SettingsComponent  (Categories, Danger Zone, Reference UI)
  connection-overlay.css  → ConnectionOverlayComponent
```

Ladeansatz im Vanilla-Frontend: mehrere `<link>`-Tags in `index.html` (kein `@import` — seriell und langsamer).

---

### 4.2 `window.*`-Globals inventarisieren → Service-Mapping

Das Frontend nutzt ca. 80 globale Funktionen und Variablen via `window`. In Angular werden diese zu injizierten Services. Das Mapping sollte jetzt dokumentiert werden:

| Global (`window.*`) | Zukünftiger Angular-Service / Ort |
|---|---|
| `allScripts`, `loadScripts`, `renderScripts` | `ScriptStateService` |
| `currentSettings`, `loadSettingsData` | `SettingsService` |
| `socket`, `initSocket` | `WebSocketService` |
| `currentIntegrationStatus`, `updateIntegrationStatusUI` | `IntegrationStatusService` |
| `apiFetch` | `ApiService` |
| `statusBar`, `updateStatusBarUI` | `StatusBarService` / `StatusBarComponent` |
| `cachedEntities`, `getHAStates` | `HaStateService` |
| `appendLog`, `initLogs`, `filterLogs` | `LogService` / `LogPanelComponent` |
| `loadStoreData`, `renderStoreTable` | `StoreStateService` |
| `newVersionInfo` | `UpdateService` |
| i18n-Helfer (`t`, `updateUIWithTranslations`) | `I18nService` (ngx-translate) |

**Vorbereitung jetzt:** Keine globalen Funktionen mehr hinzufügen. Neue Features direkt als Module/Klassen strukturieren, die später 1:1 als Angular-Services extrahiert werden können.

---

### 4.3 Socket-Events katalogisieren

Alle Socket.io-Events mit Payload-Typen dokumentieren — wird direkt zu `WebSocketService`-Observables:

| Event | Richtung | Payload | RxJS-Observable |
|---|---|---|---|
| `integration_status` | Server→Client | `{ mqtt, ha, is_running, stats }` | `integrationStatus$` |
| `status_update` | Server→Client | *(kein Payload)* | `statusUpdate$` |
| `log` | Server→Client | `{ level, source, message, timestamp }` | `log$` |
| `system_stats` | Server→Client | `{ cpu, ram, scripts }` | `systemStats$` |
| `ha_state_changed` | Server→Client | `{ entity_id, new_state }` | `haStateChanged$` |
| `mqtt_status_changed` | Server→Client | `{ connected, error? }` | `mqttStatus$` |
| `safe_mode` | Server→Client | `{ active, reason }` | `safeMode$` |
| `get_integration_status` | Client→Server | *(callback)* | `requestStatus()` |
| `get_ha_states` | Client→Server | *(callback)* | `requestHaStates()` |

---

### 4.4 REST-API katalogisieren

Alle `apiFetch`-Aufrufe dokumentieren — wird zu `ApiService`-Methoden:

| Endpoint | Methoden | Zukünftige Service-Methode |
|---|---|---|
| `api/scripts` | GET, POST | `getScripts()`, `createScript()` |
| `api/scripts/control` | POST | `controlScript(action)` |
| `api/scripts/import` | POST | `importScript(url)` |
| `api/settings` | GET, PUT | `getSettings()`, `saveSettings()` |
| `api/settings/schema` | GET | `getSettingsSchema()` |
| `api/store` | GET, PUT, DELETE | `getStore()`, `setStoreItem()`, `deleteStoreItem()` |
| `api/store/dirty` | GET | `getDirtyStore()` |
| `api/logs` | GET, DELETE | `getLogs()`, `clearLogs()` |
| `api/ha/metadata` | GET | `getHaMetadata()` |
| `api/ha/services` | GET | `getHaServices()` |
| `api/mqtt/test` | POST | `testMqtt()` |
| `api/mqtt/discover` | POST | `discoverMqtt()` |
| `api/status` | GET | `getStatus()` |
| `api/system/safe-mode/resolve` | POST | `resolveSafeMode()` |

---

### 4.5 HTML mit Component-Grenzen markieren

`index.html` mit `data-ng-component`-Attributen annotieren, damit beim Neubau klar ist welches HTML zu welchem Angular-Component gehört:

```html
<div id="sidebar" data-ng-component="SidebarComponent">
  <div id="script-list" data-ng-component="ScriptListComponent">...</div>
  <div id="sidebar-footer" data-ng-component="StatusBarComponent">...</div>
</div>
<div id="main" data-ng-component="EditorViewComponent">
  <div id="tab-bar" data-ng-component="TabBarComponent">...</div>
  <div id="log-panel" data-ng-component="LogPanelComponent">...</div>
</div>
```

---

### 4.6 Monaco-Editor kapseln

Die Monaco-Initialisierung ist über mehrere Dateien verteilt (`app.js`, `editor-tabs.js`, `statusbar.js`). Vor der Migration eine saubere Fassade extrahieren:

```js
// public/js/monaco-facade.js  →  Angular: MonacoEditorDirective
window.MonacoFacade = {
    init(container, options) { ... },
    setValue(content) { ... },
    getValue() { ... },
    setLanguage(lang) { ... },
    onDidChangeContent(cb) { ... },
    layout() { ... },
};
```

In Angular wird daraus eine `MonacoEditorDirective` mit `@Input()` und `@Output()`.

---

### 4.7 Inline-Styles aus JS entfernen

Alle `element.style.xxx = ...`-Zuweisungen in JS-Dateien durch CSS-Klassen ersetzen (außer dynamisch berechnete Werte wie Breiten). Angular-Templates arbeiten mit `[class.active]`-Bindings, nicht mit direktem Style-Zugriff.

---

## 5. Service-Architektur (State Management)

Statt globaler Variablen (`window.allScripts`) nutzen wir Services mit `BehaviorSubjects` (RxJS):

*   `ScriptStateService`: Hält die Liste der Skripte. Aktualisiert sich automatisch bei WebSocket-Events.
*   `StoreStateService`: Verwaltet den Cache für den Store-Explorer.
*   `I18nService`: Wrapper für Übersetzungen.