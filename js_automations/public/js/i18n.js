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
    if (!lang) lang = navigator.language || 'en';
    
    // Debugging für Addon-Kontext
    console.log(`I18N: Target language is ${lang}, loading from ${BASE_PATH}locales/`);

    // Sprachcode normalisieren (immer auf 2 Zeichen kürzen, da unsere Ordnerstruktur so ist)
    const finalLang = lang.split('-')[0];

    await i18next
        .use(i18nextHttpBackend)
        .init({
            lng: finalLang,
            fallbackLng: 'en',
            load: 'languageOnly', // Verhindert Versuche de-DE zu laden, wenn nur de existiert
            debug: false,
            ns: ['translation'],
            defaultNS: 'translation',
            backend: {
                loadPath: BASE_PATH + 'locales/{{lng}}/translation.json'
            }
        });

    // Globaler Shortcut für einfache Nutzung in anderen Skripten (z.B. Wizard)
    window.t = i18next.t.bind(i18next);

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

/**
 * Aktualisiert die UI-Elemente mit Übersetzungen.
 * Kann für das gesamte Dokument oder ein spezifisches Element (z.B. den Wizard) aufgerufen werden.
 */
function updateUIWithTranslations(root = document) {
    if (root === document) {
        document.title = i18next.t('app_title');
    }

    const elements = root.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;

        const translation = i18next.t(key);

        if (el.hasAttribute('data-i18n-placeholder')) {
            el.placeholder = translation;
        } 
        if (el.hasAttribute('data-i18n-title')) {
            el.title = translation;
        }
        
        // Inhalt nur übersetzen, wenn es kein reines Input-Element ist (da dort innerHTML keinen Sinn ergibt)
        // oder wenn explizit kein Attribut-Ziel definiert wurde.
        const isInput = ['INPUT', 'TEXTAREA'].includes(el.tagName);
        if (!isInput && !el.hasAttribute('data-i18n-placeholder') && !el.hasAttribute('data-i18n-title')) {
            el.innerHTML = translation;
        }
    });
}

window.initI18next = initI18next;
window.updateUIWithTranslations = updateUIWithTranslations;