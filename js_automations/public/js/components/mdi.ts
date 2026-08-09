import { html } from 'lit';

/**
 * Shadow DOM doesn't inherit the document-level MDI stylesheet <link> in
 * index.html, and `@import` inside a component's `static styles` (a
 * Constructable StyleSheet) doesn't reliably load external CSS — icons
 * silently render at 0x0 with no error. A real <link> in the render()
 * template works; the browser's HTTP cache makes the repeat fetch across
 * components free after the first one.
 */
export const mdiStylesheetLink = html`<link
  rel="stylesheet"
  href="https://cdn.jsdelivr.net/npm/@mdi/font/css/materialdesignicons.min.css"
/>`;
