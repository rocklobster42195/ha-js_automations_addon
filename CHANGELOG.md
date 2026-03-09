# Changelog

## [2.43.0] - PLANNED
### 💥 Breaking Changes
*   **Memory Optimization & Consistency:** The `axios` library is no longer globally available. It is now handled like any other standard NPM package to improve consistency and reduce memory usage.
    *   **Action Required:** If your script uses `axios`, you **must** now `require` it:
        1.  Ensure your script header contains `@npm axios`.
        2.  Add `const axios = require('axios');` to your script.

## [2.42.x] - 2026-03-08
### Initial Release