# 🗺️ JS Automations Roadmap

Diese Roadmap dokumentiert den aktuellen stabilen Zustand (**v2.19.x**) und die geplanten Meilensteine mit Einschätzungen zu Komplexität und Aufwand.

---

## ✅ Meilenstein 1: Das Fundament (Abgeschlossen)
*   **Engine:** Node.js Backend mit isolierten Worker-Threads.
*   **HA-Bridge:** Native WebSocket-Verbindung & REST API.
*   **Synchroner Cache:** Zugriff auf `ha.states` & `ha.store.val` ohne `await`.
*   **NPM-Management:** Automatisches Installieren (`@npm`) und `Prune`.
*   **Log-Levels:** Filterung im Worker (`debug`, `info`, `warn`, `error`).

---

## ✅ Meilenstein 2: Das Cockpit (Abgeschlossen)
*   **Layout:** Kompakte Liste, Smart Grouping nach `@label` (Icons/Farben aus HA).
*   **IDE:** Monaco Editor Integration, Live-Logs, Dirty-State Schutz.
*   **Persistenz:** Einklapp-Zustände im `localStorage`.

---

## 🏗️ Meilenstein 3: Die Workspace-Erfahrung (Abgeschlossen)
*Fokus: Produktivität beim Bearbeiten mehrerer Automations-Logiken.*

**Multi-Tab Editing:**  Monaco-Models für jede Datei im RAM halten; Wechsel ohne Statusverlust.
**entities.d.ts Migration:** Pfad-Verschiebung der Typ-Datei in den `.storage` Ordner.

---

## 🚀 Meilenstein 4: Power-User Features (Geplant)
*Fokus: Die Engine für komplexe Software-Strukturen öffnen.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Language Badges** | **1/10** | **S** | Kleine Markierungen (JS / TS / BLK) in der Sidebar-Liste. |
| **Globaler Ordner** | **4/10** | **M** | Automatisches Laden von Shared-Functions aus `/global` in jeden Worker. |
| **TypeScript Support** | **8/10** | **L** | Integration von Transpilern (esbuild/sucrase) & Source-Maps für Debugging. |

---

## 🛡️ Meilenstein 5: HA-Integration & Wartung (Geplant)
*Fokus: Tiefe Verzahnung mit dem HA-Ökosystem und Professionalisierung.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Multilanguage (UI)** | **3/10** | **S** | Dashboard auf Deutsch/Englisch (Fallback Englisch). |
| **Englische Kommentare** | **2/10** | **S** | Refactoring des Quellcodes für internationale Lesbarkeit. |
| **Git-Sync (Addon)** | **3/10** | **S** | Deployment-Pipeline für das Addon nach GitHub (Repository-Struktur). |
| **Resource Monitor** | **5/10** | **M** | Live CPU/RAM Anzeige pro Skript (via `pidusage`). |
| **Mirror-Entitäten** | **7/10** | **M** | Stabile HA-Switches für Skripte (Überarbeitung der WebSocket-Logic). |

---

## ✨ Nice to have
*Fokus: Komfort-Features und alternative Programmiermethoden.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Home-Dashboard** | **4/10** | **M** | Startseite mit Snippets, Quick-Actions und News. |
| **Shared State UI** | **5/10** | **M** | Grafischer Explorer für den Inhalt von `ha.store.val`. |
| **Git-Sync (Scripts)** | **6/10** | **M** | User-Skripte direkt aus dem Dashboard nach Git pushen/pullen. |
| **Blockly Integration** | **9/10** | **XL** | Visueller Editor mit eigener Block-Library für Home Assistant Aktionen. |

---

## 🔧 Bekannte Herausforderungen

*   **IntelliSense UI (Complexity 6):** Fix des Schwarz-auf-Schwarz Problems im Ingress-Iframe.
*   **MDI Autocomplete (Complexity 7):** Performante Suche in ~7000 Icons mit visueller Vorschau im Editor (ähnlich VS Code Extension).

***

### 💡 Legende:
*   **Komplexität:** Schwierigkeitsgrad der technischen Implementierung (1=trivial, 10=architektonisch schwierig).
*   **Aufwand:** Zeitaufwand (S < 1 Tag, M < 3 Tage, L < 1 Woche, XL > 1 Woche).