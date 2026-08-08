// Entry point bundled by esbuild (see package.json "build" script). Each
// import below registers its custom element as a side effect. Add new
// migrated components here as they land — see
// docs/RFC_FRONTEND_MODERNIZATION.md section 6 for the migration order.
import './safe-mode-banner';
import './integration-banner';
import './log-viewer';
import './status-bar';
import './status-bar-header-actions';
import './webhook-panel';
import './mqtt-monitor';
import './watch-panel';
import './store-explorer';
import './event-inspector';
import './settings-view';
import './script-row';
import './script-group';
import './app-sidebar';
import './card-preview';
import './confirm-dialog';
import './alert-toast';
import './entity-picker-modal';
import './store-item-modal';
import './script-modal';
import './monaco-editor';
import './editor-view';
import { observeTabVisibility } from './tab-visibility';

// repl.js (not yet migrated) still uses this as a bare global — see
// js/repl.js's `typeof observeTabVisibility === 'function'` check.
window.observeTabVisibility = observeTabVisibility;
