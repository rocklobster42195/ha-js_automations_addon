# 🗺️ JS Automations Roadmap

Diese Roadmap dokumentiert den Weg von der aktuellen Version (**v2.40.0**) hin zu einer professionellen Entwicklungsumgebung.

---

## 🚀 Meilenstein 9: TypeScript Integration (In Arbeit)
*Fokus: Typsicherheit und erstklassiges IntelliSense direkt im Browser.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **CompilerManager** | **7/10** | **M** | Hintergrund-Transpilierung von `.ts` zu `.js` in `.storage/dist`. |
| **Type Definitions** | **5/10** | **S** | Bereitstellung von `ha-api.d.ts` für das globale `ha` Objekt. |
| **Monaco TS Mode** | **6/10** | **M** | Validierung und Autovervollständigung im Editor aktivieren. |
| **Language Badges** | **1/10** | **S** | Optische Unterscheidung von JS und TS Scripten in der Sidebar. |

---

## 🏗️ Meilenstein 10: Server Refactoring & Modularisierung (In Arbeit)
*Fokus: Wartbarkeit und Stabilität durch Entkopplung der server.js.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Kernel Orchestrator** | **6/10** | **M** | Zentrales Management aller Manager-Instanzen (HA, Worker, Store). |
| **Bridge Service** | **5/10** | **M** | Saubere Trennung von internen Events und Socket.io Kommunikation. |
| **System Service** | **4/10** | **S** | Auslagerung von Stats, Safe-Mode und Bootloop-Detection. |
| **Code Cleanup** | **3/10** | **M** | Umstellung der verbleibenden Kommentare auf Englisch. |

---

## 🧪 Meilenstein 11: Quality, Backup & Reliability (Geplant)
*Fokus: Vertrauen in die Automatisierungen und Datensicherheit stärken.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Dry Run Mode** | **4/10** | **S** | Service-Calls nur loggen statt ausführen (Test-Modus). |
| **Git Integration** | **7/10** | **L** | Lokale Historie (Commits bei Save) und optionaler GitHub Sync. |
| **ZIP Backup All** | **3/10** | **S** | Ein-Klick Backup aller Scripte und Libraries als Archiv. |
| **Unit Testing** | **8/10** | **L** | Integrierter Test-Runner für Scripte mit Mock-Entities. |

---

##  Meilenstein 12: Advanced Debugging (Zukunft)
*Fokus: Tiefere Einblicke in die Laufzeit der Scripte.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Live Inspector** | **8/10** | **L** | Variablen-Werte live im Editor beobachten (Worker-V8-Bridge). |
| **Dependency Map** | **5/10** | **M** | Visualisierung der Beziehungen zwischen Scripten, Libraries und Entities. |

---

## ✨ Nice to have
*Fokus: Komfort-Features und alternative Programmiermethoden.*

| Feature | Komplexität | Aufwand | Beschreibung |
| :--- | :---: | :---: | :--- |
| **Blockly Integration** | **9/10** | **XL** | Visueller Editor mit eigener Block-Library für Home Assistant Aktionen. |
| **Mobile App Support** | **6/10** | **M** | Optimierung der UI für die Home Assistant Mobile App (Ingress). |
