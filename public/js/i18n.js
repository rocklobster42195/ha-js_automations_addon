/**
 * JS AUTOMATIONS - Internationalization (i18n)
 * Handles language loading and UI translation.
 */

async function initI18next() {
    
    const urlParams = new URLSearchParams(window.location.search);
    let lang = urlParams.get('lng');
    let opts = {};

    // Config vom Backend laden (Sprache & Expertenmodus)
    // apiFetch ist global verfügbar (definiert in app.js oder api.js)
    try {
        const res = await apiFetch('api/settings');
        if (res.ok) {
            const settings = await res.json();
            if (settings.general) opts = settings.general;
        }
    } catch (e) { console.debug("Could not load options", e); }

    if (opts.expert_mode || urlParams.get('expert') === 'true') {
        document.body.classList.add('expert-mode');
        document.getElementById('btn-store-explorer')?.classList.remove('hidden');
        document.getElementById('btn-clear-server-logs')?.classList.remove('hidden');
    }

    if (!lang && opts.ui_language) lang = opts.ui_language;

    // Fallback: Browser-Sprache
    if (!lang) lang = navigator.language.split('-')[0];

    await i18next
        .use(i18nextHttpBackend)
        .init({
            lng: lang,
            fallbackLng: 'en',
            debug: false,
            ns: ['translation'],
            defaultNS: 'translation',
            backend: {
                loadPath: 'locales/{{lng}}/translation.json'
            }
        });
    updateUIWithTranslations();
}

function updateUIWithTranslations() {
    document.title = i18next.t('app_title');
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (el.hasAttribute('data-i18n-placeholder')) {
            el.placeholder = i18next.t(key);
        } else if (el.hasAttribute('data-i18n-title')) {
            el.title = i18next.t(key);
        } else {
            el.innerHTML = i18next.t(key);
        }
    });
}

window.initI18next = initI18next;
window.updateUIWithTranslations = updateUIWithTranslations;