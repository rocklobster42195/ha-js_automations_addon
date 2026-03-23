# Concept: `ha.frontend.installCard()`

*   **Status:** Proposal
*   **Date:** 2026-03-22

---

## 1. Summary

This document proposes a new API function, `ha.frontend.installCard()`, for the JS Automations addon. Its purpose is to streamline the deployment of "single-script integrations" that include a custom Lovelace card. The function will automate the process of saving the card's JavaScript code to the `www` directory and automatically registering it as a Lovelace resource, providing a true zero-touch setup for custom cards.

## 2. Motivation

The "single-script integration" paradigm, as demonstrated with the `openligadb.js` example, is powerful. A single file contains all the logic for a sensor and its UI. However, the current workflow has significant manual steps that undermine the "single-file" concept: the user must manually create a `.js` file in their `config/www` directory, paste in the card's code, and then navigate the Home Assistant UI to register the card as a Lovelace resource.

This manual process is:
*   **Error-prone:** Users can make mistakes during copy-pasting, file naming, or URL registration.
*   **Cumbersome:** It detracts from the "plug-and-play" experience.
*   **Hard to maintain:** Updating the card code requires the user to repeat the manual process.

By providing a function to handle this entire workflow, we can make single-script integrations truly self-contained and dramatically improve the user experience.

## 3. Proposed API

A new function will be added under the `ha.frontend` namespace.

### `ha.frontend.installCard(options)`

This function installs a Lovelace card from a string into the `config/www` directory and registers it as a 'module' in the Lovelace frontend resources using the Home Assistant WebSocket API (via the `lovelace/resources/create` command).

**Arguments:**

*   `options` (Object): An object containing the details of the card to install.

    *   `name` (String, required): The desired filename for the card, without the `.js` extension. This name will be sanitized to prevent path traversal. For example, `'openligadb-card'`.
    *   `code` (String, required): A string variable containing the entire JavaScript source code for the custom card.
    *   `force` (Boolean, optional, default: `false`): If `true`, the function will overwrite an existing file with the same name. If `false`, it will not overwrite. If the card is already registered, the function will not attempt to register it again.

**Returns:**

*   `(String)`: On success, the function returns the URL path that was used to register the card (e.g., `/local/openligadb-card.js`).

**Throws:**

*   An error if the `name` or `code` is invalid.
*   An error if `force` is `false` and the file already exists.
*   An error if the file cannot be written due to permissions.
*   An error if the card registration via the WebSocket API fails (e.g., authentication issues, invalid response).

## 4. Detailed Behavior & User Workflow

The primary goal is to create a zero-effort setup process for the user.

**Old Workflow:**
1.  User copies the script.
2.  User sees log messages instructing them to create a file.
3.  User navigates to the `config/www` directory.
4.  User creates a new file.
5.  User copies the `CARD_CODE` variable's content from the script.
6.  User pastes the code into the new file.
7.  User goes to Lovelace settings to add the resource.

**New, Fully Automated Workflow:**
1.  User copies the script.
2.  The script runs automatically.
3.  The `ha.frontend.installCard()` function saves the card file to `config/www/` and registers it with Home Assistant's frontend.
4.  The user sees a simple confirmation message:
    > "Card 'openligadb-card' installed and registered successfully. It is now available to be added to your dashboards."

This new workflow is seamless, requiring no manual file operations or UI navigation from the user.

## 5. Security Considerations

*   **Path Traversal:** The `name` parameter must be strictly sanitized to ensure it only contains alphanumeric characters, dashes, and underscores. Any attempt to use `.` or `/` to navigate the filesystem must be blocked to prevent writing files outside the `config/www` directory.
*   **File Overwriting:** The `force: false` default is crucial. Scripts should not have default permission to overwrite files in the user's configuration, as the user may have customized them.
*   **API Authentication:** The underlying WebSocket API call to register the resource must be properly authenticated. This will be handled transparently by the `js_automations` addon's core connection.

## 6. Example Usage

This is how the `init()` function in `openligadb.js` would be modified to use the new API.

```javascript
// --- SCRIPT INITIALIZATION ---
async function init() {
    ha.log('--- OpenLigaDB Script Initializing ---');
    
    // Register the backend sensor entity
    ha.register(CONFIG.entity_id, {
        name: `OpenLigaDB ${CONFIG.teamName}`,
        icon: 'mdi:soccer',
        initial_state: 'unknown'
    });

    // --- Frontend Card Installation & Registration ---
    try {
        const cardPath = await ha.frontend.installCard({ 
            name: 'openligadb-card', 
            code: CARD_CODE,
            force: false // It's good practice to not overwrite user files
        });
        ha.log(`[OK] Card 'openligadb-card' installed and registered successfully.`);
        ha.log(`--> You can now add the card to your Lovelace dashboards.`);
    } catch (e) {
        // If the card already exists, this is not a critical error.
        if (e.message.includes('file already exists') || e.message.includes('already registered')) {
             ha.log(`[INFO] Card 'openligadb-card' already exists. Skipping installation.`);
        } else {
             ha.warn(`[WARN] Could not auto-install and register card: ${e.message}. Please try a manual installation.`);
        }
    }

    // Perform an initial update for the sensor
    updateMatchData();

    // ... rest of the scheduler logic
}
```

## 7. Developer Experience for Card Authors

A key challenge for authors of single-script integrations is managing the card's source code. Writing complex JavaScript inside a string literal is not practical and removes all benefits of modern IDEs (syntax highlighting, linting, formatting).

To address this, the following workflow is recommended:

1.  **Source File:** The card's JavaScript code should be written in a separate file (e.g., `my-card.src.js`).

2.  **Location:** This source file should be placed in the existing `scripts/libraries` directory. This treats the card's source code as a non-runnable library asset, which is consistent with the established project structure.

3.  **Editor Support:** The JS Automations addon editor must support viewing and editing files within the `scripts/libraries` directory without attempting to execute them as standalone scripts.

4.  **Build Step:** A build tool or a simple helper script is used to read the source file and convert its content into a string literal for the `code` parameter of the `installCard()` function. This can be a manual step for the developer (copy-paste from a script's output) or fully automated by a bundler like `esbuild` or `vite`.

This approach provides a clean development workflow while requiring only minimal adjustments to the addon editor to recognize the `libraries` folder as a place for non-runnable source files.
