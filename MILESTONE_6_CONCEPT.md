# 📦 Konzept: Script Management 2.0 (Meilenstein 6)

Dieses Dokument beschreibt die geplante Umsetzung für die Erweiterung der Skript-Verwaltung. Ziel ist es, den Import/Export zu erleichtern und die Dateiverwaltung flexibler zu gestalten, ohne die UI zu überladen.

---

## 1. Unified Creation Wizard (Neues Skript)

Der bestehende `+` Button in der Sidebar öffnet ein erweitertes Modal, das die Erstellungsmethoden in Tabs gliedert.

### Tab A: Neu (Standard)
*   **Funktion:** Wie bisher, manuelle Eingabe von Metadaten.
*   **Erweiterung:** Auswahl von **Templates** (z.B. "Leeres Skript", "Bewegungsmelder", "Zeitplan"), um Boilerplate-Code direkt einzufügen.
*   **Validierung:** Live-Prüfung des Dateinamens auf Duplikate.

### Tab B: Upload
*   **UI:** Drop-Zone oder "Datei auswählen" Button.
*   **Logik:**
    *   Liest den Dateinamen und Inhalt der hochgeladenen `.js` Datei.
    *   Prüft sofort gegen `allScripts`, ob der Name bereits existiert.
    *   Falls Duplikat: Roter Rahmen & Hinweis, User muss Namen ändern oder "Überschreiben" bestätigen.

### Tab C: Import (GitHub / Gist)
*   **UI:** Eingabefeld für Gist-URL oder Raw-URL.
*   **Funktion:** Backend (oder Frontend) fetcht den Code.
*   **Metadaten:** Versucht, `@name`, `@icon` etc. aus dem Header der Remote-Datei zu parsen.

---

## 2. Editor Toolbar 2.0 (Download)

*   **Position:** In der Editor-Toolbar (oben rechts), neben dem "Speichern" Button.
*   **Icon:** `mdi-download`.
*   **Funktion:** Lädt das aktuell im Editor geöffnete Skript als `.js` Datei auf den lokalen Rechner herunter.

---

## 3. Advanced File Operations

### Umbenennen (Renaming)
*   **Ort:** Im "Edit Metadata" Modal (Stift-Icon).
*   **Logik:**
    *   Das Feld "Dateiname" (bisher read-only) wird editierbar oder erhält einen "Rename"-Button.
    *   **Backend:** Führt `fs.rename` durch.
    *   **Side-Effects:** Das Skript muss gestoppt, umbenannt und (falls es lief) neu gestartet werden. Der Editor-Tab muss aktualisiert werden.

### Backup All (ZIP Export)
*   **Ort:** Button im Sidebar-Footer oder Header ("Backup").
*   **Funktion:** Erstellt ein ZIP-Archiv containing:
    *   Alle Skripte (`/config/js-automation/*.js`)
    *   `package.json` (für Abhängigkeiten)
    *   `entities.d.ts` (für Typings)
*   **Nutzen:** Schnelles Backup vor großen Änderungen oder Migration auf eine andere Instanz.

---

## 4. Technische Umsetzung

### Frontend
*   Umbau des `createNewScript` Modals auf Tab-Navigation.
*   Implementierung von `FileReader` API für Uploads.
*   Implementierung von `fetch` für Gist-Importe.