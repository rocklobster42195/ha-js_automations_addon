// Bundled into js/dist/i18n-vendor.js (IIFE) so the UI works without a CDN.
// Exposes the globals that js/i18n.js expects.
import i18next from 'i18next';
import HttpBackend from 'i18next-http-backend';

window.i18next = i18next;
window.i18nextHttpBackend = HttpBackend;
