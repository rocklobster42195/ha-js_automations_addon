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

## 4. Service-Architektur (State Management)

Statt globaler Variablen (`window.allScripts`) nutzen wir Services mit `BehaviorSubjects` (RxJS):

*   `ScriptStateService`: Hält die Liste der Skripte. Aktualisiert sich automatisch bei WebSocket-Events.
*   `StoreStateService`: Verwaltet den Cache für den Store-Explorer.
*   `I18nService`: Wrapper für Übersetzungen.