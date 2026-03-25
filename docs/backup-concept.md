# 📦 Konzept: Backup & Recovery System (Meilenstein 11)

Dieses Dokument beschreibt die Architektur für das Backup- und Wiederherstellungssystem. Ziel ist eine **Full-Snapshot**-Lösung, die es ermöglicht, das System nach einem Datenverlust oder auf einer neuen Installation mit minimalem Aufwand wiederherzustellen.

---

## 1. Backup-Inhalt & Struktur

Das Backup wird als ZIP-Datei gespeichert. Der Dateiname folgt dem Muster: `backup_YYYY-MM-DD_HH-mm_vVERSION.zip`.

### Dateistruktur im ZIP
```text
backup.zip
│
├── meta.json                # Metadaten (Version, Zeitstempel, Checksums)
├── package.json             # Abhängigkeiten
├── tsconfig.json            # TypeScript Konfiguration (falls vorhanden)
├── scripts/                 # Alle User-Skripte (*.js, *.ts)
├── libraries/               # Globale Bibliotheken
└── .storage/
    ├── settings.json        # System-Einstellungen (Theme, Limits, etc.)
    └── store.json           # Globaler Store (Optional, siehe Konfiguration)
```

### Ausgeschlossene Dateien
*   `node_modules/`: Werden beim Restore via `npm install` neu generiert (plattformabhängig).
*   `dist/`: Kompilierte Dateien werden zur Laufzeit neu erzeugt.
*   `backups/`: Rekursions-Vermeidung.
*   Logs und temporäre Dateien.

---

## 2. Konfiguration (Settings UI)

Die Einstellungen erfolgen unter `Einstellungen > System`.

### Optionen
1.  **Auto-Backup Strategie:**
    *   *Deaktiviert*
    *   *Täglich:* (Cron-Job, z.B. 03:00 Uhr).
    *   *Bei Änderung:* Trigger beim Speichern eines Skripts (mit Debounce, z.B. max. 1x pro Stunde).
2.  **Retention (Aufbewahrung):**
    *   Anzahl der zu behaltenden Backups (Rolling Rotation). Älteste werden gelöscht.
3.  **Inhalt:**
    *   Checkbo: `Globalen Store sichern`
    *   *Warnung:* "⚠️ Secrets im Store werden unverschlüsselt in der ZIP-Datei gespeichert."

---

## 3. Architektur & Workflow

Es wird ein neuer `BackupManager` eingeführt, der die Logik kapselt.

### 3.1 Backup-Prozess (Erstellung)
1.  **Locking:** Kurzzeitiger Write-Lock für das Dateisystem (verhindert inkonsistente Reads).
2.  **Gathering:** Sammeln der Dateipfade basierend auf der Konfiguration.
3.  **Streaming & Zipping:** Nutzung der Library `archiver` (bereits in `package.json`), um Files direkt in einen WriteStream zu pipen.
4.  **Speicherort:** `/config/js_automations/.storage/backups/`.
5.  **Rotation:** Prüfen der Retention-Policy und Löschen alter Backups.

### 3.2 Recovery-Prozess (Wiederherstellung)
Der Restore ist ein kritischer Vorgang, der das laufende System ersetzt.

1.  **Validierung:**
    *   Prüfung der ZIP-Struktur und `meta.json`.
    *   Versions-Check: Warnung bei Downgrade (Backup Version > Aktuelle Version).
2.  **Sicherheits-Backup (Pre-Restore):**
    *   Automatisches Erstellen eines Snapshots des *aktuellen* Zustands vor dem Überschreiben.
3.  **Shutdown:**
    *   Stoppen aller Worker-Threads via `WorkerManager.stopAll()`.
4.  **Wipe & Extract:**
    *   Löschen der Verzeichnisse `scripts/` und `libraries/` (um verwaiste Dateien zu entfernen).
    *   Entpacken des Backups.
5.  **Dependency Check:**
    *   Vergleich der neuen `package.json` mit der alten. Bei Änderungen `npm install` triggern.
6.  **Neustart:**
    *   Neuladen der Konfiguration und Starten der Worker.

---

## 4. Erweiterte Features & Sicherheit

### A. Integritätsprüfung
Die `meta.json` enthält SHA256-Hashwerte der kritischen Dateien. Beim Restore wird geprüft, ob das Archiv manipuliert oder korrupt ist.

### B. Safe-Mode Integration
Sollte das System nach einem Restore in einen Bootloop geraten (z.B. durch fehlerhaften Code im Backup), greift der existierende `Safe Mode`.
*   Das System erkennt: "Letzter Start war ein Restore".
*   Aktion: Option im UI anzeigen: "Wiederherstellung rückgängig machen (Rollback)".

### C. Dev-Snapshots (Feature-Idee)
Neben dem vollständigen System-Backup ein "Snapshot"-Button im Editor.
*   Erstellt schnelle, lokale Kopie einzelner Skripte vor Refactorings.
*   Funktioniert wie eine leichte Versionskontrolle ("Git light").

### D. Selektiver Restore
Möglichkeit, beim Upload eines Backups auszuwählen, was wiederhergestellt werden soll:
*   [x] Skripte & Libraries
*   [ ] System-Einstellungen (behalten der aktuellen)
*   [ ] Globaler Store (Merge oder Überschreiben)

### E. Store-Merge Strategie
Beim Wiederherstellen von `store.json`:
*   **Überschreiben (Default):** Löscht aktuellen Store, setzt Backup-Stand.
*   **Merge:** Fügt nur fehlende Keys hinzu oder aktualisiert vorhandene, lässt neue Keys in Ruhe.

### F. API Endpunkte

| Methode | Pfad | Beschreibung |
| :--- | :--- | :--- |
| `GET` | `/api/backups` | Liste aller Backups (Name, Größe, Datum). |
| `POST` | `/api/backups` | Erstellt manuell ein neues Backup. |
| `POST` | `/api/backups/upload` | Upload einer externen ZIP-Datei. |
| `GET` | `/api/backups/:filename` | Download eines Backups. |
| `POST` | `/api/backups/:filename/restore` | Startet den Wiederherstellungsprozess. |
| `DELETE` | `/api/backups/:filename` | Löscht ein Backup. |

---

## 5. Implementierungs-Plan

1.  **BackupManager:** Grundgerüst erstellen, `archiver` Implementierung.
2.  **API Routes:** Endpunkte in `server.js` (oder Router) registrieren.
3.  **Frontend:**
    *   Liste der Backups in `settings.js` anzeigen.
    *   Upload/Download Buttons.
    *   Restore-Dialog mit Warnhinweisen.
4.  **Recovery Logik:** Implementierung des "Wipe & Extract" Flows mit Restart.
5.  **Testing:** Restore-Szenarien testen (insb. npm dependencies).