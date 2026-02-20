# ⚙️ Technical Architecture: JS Automations

## Core Philosophy
The system is designed to be **fault-tolerant** and **asynchronous-first**. It bridges the gap between the Home Assistant WebSocket/REST APIs and a local Node.js runtime.

## System Components

### 1. Master Process (`server.js`)
The "Brain" of the system.
- **HA Bridge:** Manages a single persistent WebSocket connection to Home Assistant.
- **State Provider:** Maintains a master RAM cache of all HA entity states.
- **Event Dispatcher:** Uses a subscription-map to route HA events only to the Worker Threads that actually need them.
- **API Server:** Express.js based server handling the Dashboard UI and script management.

### 2. Worker Manager (`core/worker-manager.js`)
- **Orchestration:** Spawns and kills `Worker Threads`.
- **Mirroring:** Communicates with `StoreManager` to keep global variables synced across all threads.
- **Crash Detection:** Monitors exit codes (e.g., Code 1 for runtime errors) and updates the UI status to "error".

### 3. Worker Wrapper (`core/worker-wrapper.js`)
The "Sandbox" for user scripts.
- **Path Injection:** Modifies `Module.globalPaths` and `NODE_PATH` to allow scripts to find NPM packages located in the persistent `/config/js-automation/.storage/node_modules` folder.
- **Lifecycle Control:** Implements `ref()` and `unref()` logic. If a script has no active listeners (Cron or `ha.on`), the thread terminates itself automatically to save memory.
- **Graceful Stop:** Listens for `stop_request` from master to execute `onStop` callbacks before exiting.

### 4. Dependency Manager (`core/dependency-manager.js`)
- **Sequential NPM:** Handles `npm install` and `npm uninstall` commands.
- **Sanitized Pruning:** Scans all script headers to determine which packages are truly needed and removes orphans from the `.storage` directory.

### 5. Entity Manager (`core/entity-manager.js`)
- **Entity Abstraction:** Manages the lifecycle of Home Assistant entities created by the addon, such as the script switches.
- **Event Handling:** Subscribes to HA events (specifically `call_service`) to intercept user actions on the created entities.
- **Command Forwarding:** Translates HA service calls (e.g., `switch.turn_on`) into commands for the `WorkerManager` (e.g., `startScript`).

## Feature Deep Dive: Script-as-Switch

This feature creates a Home Assistant `switch` entity for each `.js` script, allowing users to monitor and control script execution from the UI.

### Virtual Entity Creation
The addon does not use MQTT discovery or a full integration manifest. Instead, it leverages Home Assistant's dynamic nature by "announcing" entities that are not persisted in the HA entity registry.

1.  **On Startup:** The `EntityManager` iterates through all scripts.
2.  **Entity ID:** It constructs an entity ID (e.g., `switch.js_automation_my_script`).
3.  **Announcement:** It calls `ha.updateState` via the `HAConnector` for this new ID, providing an initial state (`off`) and attributes (`friendly_name`, `icon`).
4.  **HA's Behavior:** Home Assistant receives a state for an unknown entity and dynamically adds it to its state machine. The entity is now visible and usable in the UI for the current session.
5.  **Persistence:** Because these entities are not saved by Home Assistant, this process is repeated on every addon (re)start, effectively making them persistent from a user's perspective.

### Control Flow (Switch -> Script)
1.  User toggles a script switch to `ON` in the Lovelace UI.
2.  Home Assistant fires a `call_service` event for `domain: switch`, `service: turn_on`.
3.  The `HAConnector` receives this event and forwards it to all its subscribers.
4.  The `EntityManager`, being a subscriber, catches the event.
5.  It maps the `entity_id` back to a script filename using the `StateManager`.
6.  It calls `workerManager.startScript(filename)`.

### Control Flow (Script -> Switch)
1.  A script is started (e.g., by the `turn_on` service or a CRON trigger).
2.  The `WorkerManager` successfully spawns a worker thread and emits a `script_start` event.
3.  `server.js` listens for this event.
4.  It calls `connector.updateState()` for the corresponding switch entity, setting its state to `on`.
5.  Home Assistant's UI updates to show the switch as active.
6.  When the script exits, a `script_exit` event triggers the same process to set the switch state back to `off`.

## 📡 Real-Time Synchronization
1. **Master** receives a WebSocket message from HA.
2. **Master** updates its internal `this.states` object.
3. **Master** calls `workerManager.dispatchStateChange()`.
4. **WorkerManager** sends a `state_update` message to **ALL** workers (to keep their synchronous `ha.states` cache up to date).
5. **WorkerManager** sends a `ha_event` message **ONLY** to workers that have a matching subscription pattern (`ha.on`).

## 📂 Data Storage (`/config/js-automation/`)
- `.storage/`: Hidden directory containing system data.
  - `state.json`: Registry of which scripts should autostart.
  - `store.json`: Persistent global variables.
  - `package.json`: NPM package manifest for user scripts.
  - `node_modules/`: Installed third-party libraries.
  
---

## 🌍 Internationalization (i18n)

The dashboard frontend is fully internationalized to support multiple languages.

### Libraries Used
- **`i18next`**: The core framework for handling translations.
- **`i18next-http-backend`**: A plugin to load translation files from the server.

### File Structure
Translations are stored in JSON format inside the `/public/locales` directory. Each language has its own subdirectory named with its two-letter ISO code (e.g., `en`, `de`).

```
/public
└── /locales
    ├── /en
    │   └── translation.json
    └── /de
        └── translation.json
```

### How it Works
1.  **Initialization:** In `app.js`, the `initI18next` function is called on startup.
2.  **Language Detection:** It first checks for a `?lng=` URL parameter. If not present, it defaults to the browser's language (`navigator.language`). The fallback is always 'en'.
3.  **Loading:** `i18next-http-backend` fetches the appropriate `translation.json` file.
4.  **UI Update:** The `updateUIWithTranslations` function scans the DOM for elements with the `data-i18n` attribute and replaces their content with the corresponding translated string.

### Adding a New Language
1.  Create a new folder in `/public/locales` (e.g., `/fr` for French).
2.  Add a `translation.json` file inside it, copying the key structure from the English (`/en`) file.
3.  Translate the values in the new file. No code changes are needed; the system will automatically pick up the new language if the user's browser is set to it or if it's forced via the URL parameter (`?lng=fr`).
