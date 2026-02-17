# 🗺️ JS Automations Roadmap - Version 2026

Diese Roadmap dokumentiert den aktuellen stabilen Zustand (**v2.17.x**) und die geplanten Meilensteine für die Zukunft.

---

## ✅ Meilenstein 1: Das Fundament (Abgeschlossen)
*   **Engine:** Node.js Backend mit isolierten Worker-Threads pro Skript.
*   **HA-Bridge:** Native WebSocket-Verbindung (Zero-Config im Addon-Modus).
*   **Synchroner Cache:** Blitzschneller Zugriff auf `ha.states` ohne `await`.
*   **Synchroner Store:** Globaler, persistenter Speicher via `ha.store.val`.
*   **NPM-Management:** Automatisches Installieren (`@npm`) und Aufräumen (`Prune`).
*   **Lifecycle:** Automatisches Beenden von One-Shot-Skripten; Keep-alive für `ha.on` und `schedule`.
*   **Log-Levels:** Filterung von Logs im Worker (`debug`, `info`, `warn`, `error`).

---

## ✅ Meilenstein 2: Das Cockpit (Abgeschlossen)
*   **Listen-Layout:** Kompakte Sidebar-Liste statt platzraubender Kacheln.
*   **Smart Grouping:** Gruppierung nach `@label` (Icons & Farben aus HA).
*   **Flat Design:** Klares UI ohne Glow-Effekte für bessere Übersicht.
*   **Erstellungs-Wizard:** Modal zum Anlegen neuer Skripte inkl. Metadaten-Abfrage.
*   **Live-Logs:** Echtzeit-Streaming der Ausgaben ins Dashboard.

---

## 🏗️ Meilenstein 3: Die Workspace-Erfahrung (Nächste Schritte)
*Ziel: Die tägliche Arbeit mit den Skripten so flüssig wie möglich machen.*

*   **[ ] Persistenter Einklapp-Zustand:** Speichern der zu- oder aufgeklappten Labels im `localStorage`.
*   **[ ] "Dirty-State" Schutz:** Visueller Indikator (Sternchen) bei ungespeicherten Änderungen und Warnung beim Schließen.
*   **[ ] Multi-Tab Editing:** Gleichzeitiges Öffnen mehrerer Skripte (Vorsichtige Implementierung ohne Layout-Bruch).
*   **[ ] Home-Dashboard:** Eine Startseite mit Code-Snippets, Schnellzugriff und Store-Übersicht.

---

## 🚀 Meilenstein 4: Power-User Features (Geplant)
*Ziel: Die Skript-Engine noch mächtiger machen.*

*   **[ ] TypeScript Support:** Optionale Nutzung von `.ts` Dateien mit automatischer Transpilierung im Hintergrund.
*   **[ ] Blockly Integration:** Visueller Editor für einfache Logik-Bausteine (generiert JS-Code).
*   **[ ] Language Badges:** Kleine Markierungen in der Liste (JS / TS / BLK).
*   **[ ] Inter-Script Messaging:** Direkte Kommunikation zwischen Skripten über `ha.emit('event')`.
*   **[ ] Globaler Ordner:** Ein Verzeichnis für geteilte Funktionen, die überall verfügbar sind.

---

## 🛡️ Meilenstein 5: HA-Integration & Wartung (Geplant)
*Ziel: Nahtlose Verschmelzung mit Home Assistant.*

*   **[ ] Mirror-Entitäten (Stabil):** Erstellen von HA-Entitäten zum Starten/Stoppen von Skripten (Technik muss noch stabilisiert werden).
*   **[ ] Shared State UI:** Ein Tab im Home-Dashboard, um den Inhalt von `ha.store.val` zu sehen und zu verwalten.
*   **[ ] Resource Monitor:** Anzeige von Speicherverbrauch und Laufzeit pro Skript.
*   **[ ] Git-Sync:** Skripte direkt mit einem Repository synchronisieren.

---

## 🔧 Bekannte Herausforderungen
*   **IntelliSense UI:** Das Monaco-Vorschlagsfenster leidet unter CSS-Konflikten innerhalb des Home Assistant Ingress-Iframes (Schwarz-auf-Schwarz Problem).
*   **MDI Autocomplete:** Die schiere Menge an Icons (~7000) benötigt eine performante Lösung für die Suche im Editor.