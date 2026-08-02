// Entry point bundled by esbuild (see package.json "build" script). Each
// import below registers its custom element as a side effect. Add new
// migrated components here as they land — see
// docs/RFC_FRONTEND_MODERNIZATION.md section 6 for the migration order.
import './safe-mode-banner';
import './integration-banner';
import './log-viewer';
import './status-bar';
import './status-bar-header-actions';
