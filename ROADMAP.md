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

## ✅ Meilenstein 3: Die Workspace-Erfahrung (Abgeschlossen)
*Fokus: Produktivität beim Bearbeiten mehrerer Automations-Logiken.*

**Multi-Tab Editing:**  Monaco-Models für jede Datei im RAM halten; Wechsel ohne Statusverlust.
**entities.d.ts Migration:** Pfad-Verschiebung der Typ-Datei in den `.storage` Ordner.
**Multilanguage (UI):** Dashboard auf Deutsch/Englisch (Fallback Englisch). 

---

## 🚀 Meilenstein 4: Power-User Features (Geplant)
*Fokus: Die Engine für komplexe Software-Strukturen öffnen.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Globaler Ordner** | **4/10** | **M** | Automatisches Laden von Shared-Functions aus `/global` in jeden Worker. |
| **TypeScript Support** | **8/10** | **L** | Integration von Transpilern (esbuild/sucrase) & Source-Maps für Debugging. |
| **Language Badges** | **1/10** | **S** | Kleine Markierungen (JS / TS / BLK) in der Sidebar-Liste. |

---

## 🛡️ Meilenstein 5: HA-Integration & Wartung (Geplant)
*Fokus: Tiefe Verzahnung mit dem HA-Ökosystem und Professionalisierung.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Englische Kommentare** | **2/10** | **S** | Refactoring des Quellcodes für internationale Lesbarkeit. |
| **Resource Monitor** | **5/10** | **M** | Live RAM Anzeige pro Skript (via Worker-Polling). **(Frontend Ready)** |

---

## 📦 Meilenstein 6: Script Management 2.0 (Geplant)
*Fokus: Flexiblerer Umgang mit Dateien, Import/Export und Usability.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Unified Creation Wizard** | **5/10** | **M** | Modal mit Tabs: *Neu* (Templates), *Upload* (Drag & Drop) und *Gist-Import*. Auto-Check auf Duplikate. |
| **Editor Toolbar 2.0** | **3/10** | **S** | Download-Button für aktives Skript. |
| **Advanced File Ops** | **6/10** | **M** | Umbenennen von Skripten (Rename & Restart) und "Backup All" (ZIP-Download aller Skripte). |

---

## ✨ Nice to have
*Fokus: Komfort-Features und alternative Programmiermethoden.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Shared State UI** | **5/10** | **M** | Grafischer Explorer für den Inhalt von `ha.store.val`. |
| **Blockly Integration** | **9/10** | **XL** | Visueller Editor mit eigener Block-Library für Home Assistant Aktionen. |

---

## 🔧 Bekannte Herausforderungen

*   **IntelliSense UI (Complexity 6):** Fix des Schwarz-auf-Schwarz Problems im Ingress-Iframe.
