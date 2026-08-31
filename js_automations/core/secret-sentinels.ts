// Wire sentinels for masked secret settings fields.
//
// The real value of a schema field flagged `mode: 'password'` never leaves the server via
// GET /api/settings — it comes back as SECRET_MASK when a value is stored (empty string when
// unset). On save the client sends one of these back to signal intent:
//   SECRET_MASK  -> "unchanged, keep what's stored" (an empty field means the same thing)
//   SECRET_CLEAR -> "wipe the stored value"
//
// Kept in sync with the copies in js_automations/public/js/components/settings-view.ts.
export const SECRET_MASK = '__JSA_SECRET_KEPT__';
export const SECRET_CLEAR = '__JSA_SECRET_CLEAR__';
