# ⚙️ Technical Architecture: JS Automations

## Core Philosophy
The system is designed to be **modular, fault-tolerant, and asynchronous-first**. It bridges the gap between the Home Assistant WebSocket/REST APIs and a local Node.js runtime, providing a professional development environment with TypeScript support.

## System Components

### 1. Kernel & Orchestration (`core/kernel.js`)
The Kernel replaces the monolithic logic previously found in `server.js`.
- **Manager Lifecycle:** Responsible for instantiating and connecting all core managers (`HAConnector`, `WorkerManager`, `StoreManager`, etc.) in the correct order.
- **Dependency Injection:** Acts as the central registry, providing manager instances to routes and services.

### 2. Bridge Service (`core/bridge.js`)
- **Event Mediation:** Decouples internal system events from the transport layer. It listens to manager events (logs, state changes, exits) and broadcasts them via Socket.io.

### 3. Compiler Manager (`core/compiler-manager.js`)
- **TS Transpilation:** Monitors `.ts` files and transpiles them into CommonJS JavaScript using the TypeScript API.
- **Distribution:** Compiled files are stored in `.storage/dist/`, maintaining the original directory structure for seamless library imports.
- **Error Reporting:** Captures compilation diagnostics and streams them to the UI via the Bridge.

### 4. Worker Manager (`core/worker-manager.js`)
- **Orchestration:** Spawns and kills `Worker Threads`.
- **Path Resolution:** Intelligently resolves script paths. If a `.ts` source is requested, it executes the corresponding `.js` file from the `dist` folder.
- **Mirroring:** Communicates with `StoreManager` to keep global variables synced across all threads.
- **Crash Detection:** Monitors exit codes (e.g., Code 1 for runtime errors) and updates the UI status to "error".

### 5. Worker Wrapper (`core/worker-wrapper.js`)
The "Sandbox" for user scripts.
- **Path Injection:** Modifies `Module.globalPaths` and `NODE_PATH` to allow scripts to find NPM packages located in the persistent `/config/js-automation/.storage/node_modules` folder.
- **Lifecycle Control:** Implements `ref()` and `unref()` logic. If a script has no active listeners (Cron or `ha.on`), the thread terminates itself automatically to save memory.
- **Graceful Stop:** Listens for `stop_request` from master to execute `onStop` callbacks before exiting.

### 6. Dependency Manager (`core/dependency-manager.js`)
- **Sequential NPM:** Handles `npm install` and `npm uninstall` commands.
- **Sanitized Pruning:** Scans all script headers to determine which packages are truly needed and removes orphans from the `.storage` directory.

### 7. Entity Manager (`core/entity-manager.js`)
- **Entity Abstraction:** Manages the lifecycle of Home Assistant entities created by the addon, such as the script switches.
- **Event Handling:** Subscribes to HA events (specifically `call_service`) to intercept user actions on the created entities.
- **Command Forwarding:** Translates HA service calls (e.g., `switch.turn_on`) into commands for the `WorkerManager` (e.g., `startScript`).

### 8. Data Storage (`/config/js-automation/`)
- `.storage/`: Hidden directory containing system data.
  - `state.json`: Registry of which scripts should autostart.
  - `store.json`: Persistent global variables.
  - `package.json`: NPM package manifest for user scripts.
  - `node_modules/`: Installed third-party libraries.
  - `entities.d.ts`: All HA entities for IntelliSense.
  - `ha-api.d.ts`: Type definitions for the global `ha` object.
  - `tsconfig.json`: Managed TypeScript configuration.
  - `dist/`: Compiled JavaScript output for TypeScript/Blockly scripts.

### 9. Internationalization (i18n)

The dashboard uses **i18next** for translations.
*   **Detection:** Automatic browser language detection with fallback to English. Can be forced via `?lng=xx`.
*   **Structure:** JSON files located in `/locales/{lang}/translation.json`.
*   **Extensibility:** Be sure to add your new language in config.yaml

### 10. Resource Usage & Optimization (Known Limitations)

Since every script runs in its own isolated **Worker Thread**, the system prioritizes stability over memory efficiency.
*   **RAM Overhead:** Each thread spawns a separate V8 instance, consuming ~20-30 MB of base RAM. With many active scripts, this adds up.
*   **State Duplication:** The `ha.states` object is replicated in every thread. For large HA installations (thousands of entities), this increases memory pressure.
*   **Compilation:** TypeScript transpilation occurs in the master process. While incremental, it can cause brief CPU spikes during script saves.