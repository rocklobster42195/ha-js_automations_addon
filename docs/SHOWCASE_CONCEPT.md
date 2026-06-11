# JSA Script Showcase — Konzept

## Ziel

Eine öffentliche Galerie-Seite, die ausgewählte JSA-Skripte präsentiert:
Name, Beschreibung, optionaler Screenshot und Gist-Link — mit einem **„Add to JSA"**-Button, der das Skript mit einem Klick direkt in die eigene JSA-Instanz importiert.

---

## Hosting

- GitHub Pages, serviert aus dem **`docs/`-Ordner dieses Repos**
- Kein separates Repo nötig — Showcase und Addon bleiben zusammen versioniert
- Aktivierung: Repository Settings → Pages → Source: `docs/` branch `main`

---

## Seitenstruktur

```
docs/
├── index.html          # Showcase-Seite
├── scripts.json        # Daten aller kuratierten Skripte
├── screenshots/        # Optionale Screenshots (PNG/WebP)
│   └── example.png
└── assets/
    ├── style.css
    └── app.js
```

---

## Script Card

Jede Karte zeigt:

| Feld         | Pflicht | Beschreibung                                   |
|--------------|---------|------------------------------------------------|
| `name`       | ✅      | Anzeigename des Skripts                        |
| `description`| ✅      | 1–3 Sätze, was das Skript tut                  |
| `gist_raw`   | ✅      | Raw-URL des Gists (für den Import)             |
| `gist_url`   | ✅      | Normale Gist-Seite (für den „Quellcode"-Link)  |
| `tags`       | ✅      | z.B. `["mqtt", "presence", "climate"]`         |
| `screenshot` | ❌      | Relativer Pfad in `screenshots/` — optional    |

**Ohne Screenshot** zeigt die Karte ein Icon-Placeholder mit dem ersten Tag als Label — sieht trotzdem sauber aus.

### scripts.json — Beispiel

```json
[
  {
    "name": "Presence Tracker",
    "description": "Erkennt Anwesenheit via MQTT-Topics und setzt einen HA-Helper. Konfigurierbar per Skript-Header.",
    "gist_raw": "https://gist.githubusercontent.com/BKemper/abc123/raw/presence-tracker.js",
    "gist_url": "https://gist.github.com/BKemper/abc123",
    "tags": ["presence", "mqtt"],
    "screenshot": "screenshots/presence-tracker.png"
  },
  {
    "name": "Climate Scheduler",
    "description": "Setzt Heizungstemperaturen nach Tageszeit und Kalender-Events.",
    "gist_raw": "https://gist.githubusercontent.com/BKemper/def456/raw/climate-scheduler.js",
    "gist_url": "https://gist.github.com/BKemper/def456",
    "tags": ["climate", "calendar"]
  }
]
```

---

## „Add to JSA"-Button

### Problem
Die Showcase-Seite (GitHub Pages) und das Addon (`http://HA-IP:8099`) sind unterschiedliche Origins — kein shared localStorage möglich.

### Lösung: Einmalige JSA-URL-Konfiguration auf der Showcase-Seite

1. Beim ersten Besuch erscheint ein kleines Banner: **„Deine JSA-Adresse eingeben"** (z.B. `http://192.168.1.100:8099`)
2. Die URL wird im localStorage der Showcase-Seite gespeichert (`jsa_base_url`)
3. Jeder „Add to JSA"-Button öffnet dann: `{jsa_base_url}/?import={gist_raw_url}`

### Komfort-Hilfe im Addon

Das Addon zeigt in den Einstellungen eine **„Showcase-Link kopieren"**-Schaltfläche, die die eigene Base-URL (`window.location.origin`) in die Zwischenablage kopiert. Kein Tippen nötig.

### Ablauf end-to-end

```
Showcase-Seite                     JSA Addon (lokal)
─────────────────                  ──────────────────
Nutzer klickt „Add to JSA"
  → öffnet neuen Tab:
    http://[HA]:8099/?import=<url>
                                   app.js prüft URL-Parameter
                                   ?import=<url> vorhanden?
                                     → openCreationWizard('import', { url })
                                   Import-Wizard öffnet sich,
                                   URL ist vorausgefüllt
                                   Nutzer klickt „Vorschau" → „Importieren"
```

### Addon-Änderung (minimal)

In `js_automations/public/js/app.js`, beim DOMContentLoaded:

```javascript
const importUrl = new URLSearchParams(window.location.search).get('import');
if (importUrl) {
    // URL-Param bereinigen ohne Reload
    history.replaceState(null, '', window.location.pathname);
    openCreationWizard('import', { url: importUrl });
}
```

---

## Design-Prinzipien

- **Mobile-first**, saubere Karten-Galerie (CSS Grid)
- **Ohne Screenshot**: Karte zeigt farbigen Tag-Badge + MDI-Icon (aus `@icon` im Skript-Header)
- **Mit Screenshot**: Karte zeigt Bild oben, Details darunter — beide Varianten im gleichen Grid
- Keine Build-Pipeline nötig — reines HTML/CSS/Vanilla JS
- Dunkles Theme (passend zur JSA-UI)

---

## Neues Skript hinzufügen (Workflow)

1. Gist auf GitHub anlegen / aktualisieren
2. Eintrag in `docs/scripts.json` hinzufügen
3. Optional: Screenshot als `docs/screenshots/<name>.png` ablegen
4. Commit + Push → GitHub Pages aktualisiert sich automatisch

---

## Offene Entscheidungen

| Frage | Option A | Option B |
|-------|----------|----------|
| JSA-URL-Eingabe | Banner beim ersten Besuch | Festes Einstellungs-Panel |
| Icon-Quelle ohne Screenshot | MDI-Icon aus Skript-Header | Generierter Farbblock mit Initiale |
| Filter/Suche | Ja (nach Tags) | Erstmal nein |
