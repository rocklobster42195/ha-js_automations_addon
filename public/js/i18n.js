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

    if (!lang && opts.ui_language && opts.ui_language !== 'auto') lang = opts.ui_language;

    // Wenn 'auto' gewählt ist, versuchen wir die HA Sprache zu laden
    if (!lang && opts.ui_language === 'auto') {
        try {
            const res = await apiFetch('api/ha/metadata');
            if (res.ok) {
                const data = await res.json();
                if (data.language) lang = data.language;
            }
        } catch (e) { console.debug("Could not load HA language", e); }
    }

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

    // Falls wir nach einem Reload (z.B. Sprachwechsel) die Settings wieder öffnen sollen
    if (urlParams.get('open') === 'settings') {
        setTimeout(() => {
            if (typeof window.openSettingsTab === 'function') window.openSettingsTab();
            // Parameter aus der URL entfernen, ohne die Seite neu zu laden
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('open');
            window.history.replaceState({}, document.title, newUrl.toString());
        }, 300);
    }
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