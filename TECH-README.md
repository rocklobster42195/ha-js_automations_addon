# ⚙️ Technical Documentation (Architecture & Internals)

This document provides a deep dive into the internal workings of the **JS-Automation** engine. It explains the architecture, the data flow, and the purpose of every file in the repository.

---

## 🏗 Architecture Overview

The system is built on a **Hub-and-Spoke** architecture using Node.js.

1.  **The Hub (Main Process):**
    *   Runs the Express Web Server (Dashboard).
    *   Manages the WebSocket connection to Home Assistant.
    *   Orchestrates the lifecycle of user scripts.
    *   Handles file operations and NPM dependency installation.

2.  **The Spokes (Worker Threads):**
    *   Each user script runs in its own isolated Node.js `Worker Thread`.
    *   This ensures that a crash in a user script (e.g., infinite loop or syntax error) **never** crashes the main server or Home Assistant.
    *   Communication happens via the `parentPort` messaging system.

3.  **The Bridge (Home Assistant):**
    *   **WebSocket API:** Used for real-time event streaming (`state_changed`) and executing services (`call_service`).
    *   **REST API:** Used for updating/creating virtual entities (`updateState`).
    *   **Authentication:** Automatically handled via the `SUPERVISOR_TOKEN` environment variable injected by Home Assistant.

---

## 📂 File Structure & Explanations

### Root Directory
| File | Description |
| :--- | :--- |
| `server.js` | **The Entry Point.** Initializes Express, Socket.IO, and the HA Connection. It handles API routes (`/api/scripts/...`) and orchestrates the startup sequence (restoring state, creating directories). |
| `Dockerfile` | Defines the container image. We use `node:20-alpine` to avoid conflicts with the Home Assistant S6 overlay system. Node runs as PID 1. |
| `config.yaml` | The manifest for the Home Assistant Supervisor. Defines permissions, ports, and Ingress configuration. |
| `package.json` | Dependencies for the *engine* itself (express, socket.io, ws). Note: User script dependencies are tracked separately. |

### `/core` (The Backend Logic)
| File | Description |
| :--- | :--- |
| `ha-connection.js` | **The Bridge.** Manages the WebSocket connection. It handles auto-reconnection, auth handshakes, and fetches all entities to generate the `entities.d.ts` for IntelliSense. |
| `worker-manager.js` | **The Process Manager.** Starts, stops, and restarts Worker Threads. It routes messages (logs, service calls) from workers to the Frontend or Home Assistant. |
| `worker-wrapper.js` | **The Sandbox.** This file is the *entry point* for every Worker Thread. It injects the global `ha` object, sets up the `require` paths for NPM modules, and executes the user's code. |
| `dependency-manager.js` | **NPM Handler.** Parsers `@npm` headers and executes `npm install` inside the user's config directory (`/config/js-automation/node_modules`). |
| `parser.js` | **Metadata Reader.** Reads the top comments of a script (`@name`, `@icon`, `@npm`) using Regex without executing the code. |
| `state-manager.js` | **Persistence.** Reads/writes `state.json` to remember which scripts were running before a restart. |

### `/public` (The Frontend / Dashboard)
| File | Description |
| :--- | :--- |
| `index.html` | The main layout. Loads Monaco Editor and Socket.IO libraries via CDN (to bypass HA Proxy caching issues). |
| `style.css` | Styling for the dark mode UI. Contains aggressive CSS overrides to force the Monaco Suggestion Widget to be visible inside the HA Ingress iframe. |
| `app.js` | **The Frontend Logic.** Handles Ingress path detection, Socket.IO communication, DOM manipulation, and the complex configuration of the Monaco Editor (injecting TypeScript definitions). |

---

## 🔄 Data Flow Examples

### 1. Starting a Script
1.  **UI:** User clicks "Play". `app.js` sends `POST /api/scripts/control`.
2.  **Server:** `server.js` receives the request.
3.  **Manager:** `workerManager.startScript()` is called.
4.  **Worker:** A new Thread spawns, running `worker-wrapper.js`.
5.  **Wrapper:**
    *   Modifies `module.paths` to find NPM packages in `/config`.
    *   Defines the global `ha` API.
    *   Loads the user script (`require(userPath)`).
6.  **Feedback:** The worker sends a "Log" message -> Manager -> Server -> Socket.IO -> Frontend Console.

### 2. IntelliSense (Autocompletion)
1.  **Backend:** `HAConnector` fetches all states via WebSocket.
2.  **Generation:** It generates a TypeScript Definition file (`entities.d.ts`) containing a union type `EntityID = "light.kitchen" | "sensor.temp" ...`.
3.  **Storage:** Saved to `/config/js-automation/entities.d.ts`.
4.  **Frontend:** When the editor opens, `app.js` fetches the content of this file via API.
5.  **Injection:** `monaco.languages.typescript...addExtraLib()` injects these types into the browser's editor instance.

---

## 🛠 Home Assistant Specifics

### Ingress & Paths
Because the app runs inside Home Assistant's Ingress (a reverse proxy), relative paths are critical.
*   **The Problem:** The URL is not `localhost:3000`, but `http://homeassistant.local:8123/api/hassio_ingress/TOKEN/...`.
*   **The Fix:** `public/app.js` dynamically calculates `BASE_PATH` based on `window.location.pathname` and prepends it to every API fetch and Socket.IO connection.

### Persistence
*   **Docker Container:** ephemeral (deleted on update).
*   **User Data:** persistent.
*   **Mapping:** The `config.yaml` maps `config:rw`.
*   **Logic:** The server detects `SUPERVISOR_TOKEN`. If present, it switches the storage directory from `./scripts` (local dev) to `/config/js-automation` (production).

### Authentication
*   **Development:** Uses `.env` file with `HA_URL` and `HA_TOKEN`.
*   **Production:** Uses `http://supervisor/core` and `process.env.SUPERVISOR_TOKEN`. No manual config required.

---

## 🐛 Debugging Guide

If you are developing the core:

1.  **Frontend Logs:** Open Browser DevTools (`F12`). Look for `[HTTP]` logs or Socket.IO connection errors.
2.  **Backend Logs:** In Home Assistant, go to the Add-on "Log" tab. The `server.js` has a middleware that logs every incoming HTTP request.
3.  **Worker Errors:** If a script crashes silently, check `core/worker-wrapper.js`. It wraps the user code in a `try/catch` block and sends errors back to the main process.