# ⚙️ Konzept: System Settings & Personalization (Meilenstein 8)

## 1. Das Ziel: Zentralisierung
Bisher sind Einstellungen verstreut (z.B. Sprache via URL-Parameter) oder gar nicht vorhanden (Hardcoded UI-Elemente). Mit Meilenstein 8 führen wir einen zentralen **"System: Settings"** Tab ein, der ähnlich wie der Store Explorer funktioniert, aber eine strukturierte Konfiguration ermöglicht.

## 2. UI-Layout: Split-View
Anstatt eines tief verschachtelten Baums nutzen wir eine **Split-View** (ähnlich VS Code oder Home Assistant):
*   **Links:** Kategorien (General, Editor, Status Bar, System).
*   **Rechts:** Die zugehörigen Einstellungen als Formular-Elemente.

Die Speicherung erfolgt in einer `settings.json` im `.storage` Ordner, damit Einstellungen geräteübergreifend (Laptop/Tablet) synchron sind.

---

## 3. Die Sektionen

### A. 🌍 Allgemein (General)
Hier finden sich globale UI-Steuerungen.
*   **Sprache:** Auswahl [Deutsch | English].
*   **Expertenmodus:** Toggle [An/Aus].
    *   *Aus:* Versteckt technische Pfade, Raw-Ansichten und komplexe Logs.
    *   *An:* Zeigt volle Details (für Power-User).
*   **Sicherheitsabfragen:** Toggle "Löschen bestätigen".

### B. 📝 Editor
Anpassung der Entwicklungsumgebung (Monaco).
*   **Toolbar:** Checkboxen, welche Hilfs-Buttons angezeigt werden sollen (z.B. "Formatieren", "Suchen" ausblenden, um Platz zu sparen).
*   **Darstellung:** Schriftgröße, Word-Wrap, Minimap (An/Aus).

### C. 📟 Statusleiste (Status Bar)
Der Footer der Anwendung wird konfigurierbar. Wir definieren **3 flexible Slots** (Links, Mitte, Rechts). Der **Verbindungsstatus** (Socket) bleibt fix ganz rechts außen als System-Indikator.

**Konfiguration pro Slot:**
Dropdown-Auswahl mit folgenden Optionen:
1.  *Leer / Ausgeblendet*
2.  *Add-on CPU Usage* (Live)
3.  *Add-on RAM Usage* (Live)
4.  *Custom Entity*

**Feature "Custom Entity":**
Wählt man diese Option, erscheint ein Entity-Picker. Der User kann eine beliebige HA-Entität wählen (z.B. `sensor.server_power` oder `sensor.processor_use`). Der Status dieser Entität wird dann live in der Leiste angezeigt.

### D. 🛡️ System & Danger Zone
Tiefgreifende Eingriffe in die Laufzeitumgebung.

*   **Log Level:** Globales Level [Info | Warn | Error | Debug].
*   **Node.js Memory:** Eingabefeld für `max-old-space-size`.
    *   Standard: 512 MB.
    *   Kann hier erhöht werden, falls Skripte OOM (Out of Memory) gehen.
    *   *Hinweis:* Erfordert Neustart des Add-ons.
*   **Backup:** Button "Full System Export" (Alle Skripte + Settings + Store als ZIP).

---

## 4. Technische Umsetzung

### Backend (`SettingsManager`)
*   Neue Klasse, die `settings.json` liest und schreibt.
*   API-Endpunkte: `GET /api/settings` und `POST /api/settings`.
*   Beim Start des Add-ons müssen bestimmte Settings (wie Node Memory) in Umgebungsvariablen umgewandelt werden.

### Frontend
*   **Live-Update:** Änderungen an der Statusleiste sollten sofort sichtbar sein, ohne Reload.
*   **CSS-Variablen:** Schriftgrößen und Layout-Optionen steuern wir über CSS-Vars, die zur Laufzeit via JS gesetzt werden.

---

## 5. Roadmap für Meilenstein 8

1.  **Backend:** `SettingsManager` implementieren & API bereitstellen.
2.  **Frontend Core:** Settings-Tab UI (Split-View) bauen.
3.  **Feature - Status Bar:** Logik für dynamische Slots und Entity-Subscription im Footer implementieren.
4.  **Feature - Editor:** Monaco-Config dynamisch machen.
5.  **Feature - System:** Node-Flags in Config schreiben.

## 6. Mehrwert
*   ✅ **Personalisierung:** Jeder User sieht nur das, was er braucht.
*   ✅ **Monitoring:** Wichtige Server-Metriken immer im Blick (im Footer).
*   ✅ **Skalierbarkeit:** RAM-Limit kann ohne YAML-Hacks angepasst werden.

---

## 7. Visualisierung & Platzbedarf (Mockups)

Die Frage nach dem Platzbedarf für 3 Widgets + 2 System-Icons ist berechtigt. Auf Desktop-Screens ist dies problemlos möglich.

### Desktop Layout (> 800px)
Die fixen System-Indikatoren befinden sich **links**. Rechts daneben folgen die konfigurierbaren Slots.

```text
[ ⇄ ] [ ❤️ ]           [ Slot 1: CPU 12% ]  [ Slot 2: RAM 240MB ]  [ Slot 3: Power 45W ]
```
*   **[ ⇄ ] Integration:** `mdi:transit-connection-horizontal` (Zeigt Status der Python-Bridge).
*   **[ ❤️ ] API:** `mdi:heart-pulse` (Zeigt WebSocket Verbindung).

### Mobile Layout (< 600px)
Um Überlappungen zu vermeiden, werden Slot 2 und 3 via CSS (`display: none`) ausgeblendet.

```text
[ Slot 1: CPU 12% ]                                             [ ⇄ ] [ ❤️ ]
```

*Fazit:* Der Platz reicht aus, wenn wir auf Mobilgeräten priorisieren (nur Slot 1).