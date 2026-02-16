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
