/**
 * JS AUTOMATIONS - Internationalization (i18n)
 * Handles language loading and UI translation.
 */

async function initI18next() {
    
    const urlParams = new URLSearchParams(window.location.search);
    let lang = urlParams.get('lng');
    let opts = {};

    // Load configuration from backend (Language & Expert Mode).
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

    // If 'auto' is selected, attempt to load the Home Assistant system language.
    if (!lang && opts.ui_language === 'auto') {
        try {
            const res = await apiFetch('api/ha/metadata');
            if (res.ok) {
                const data = await res.json();
                if (data.language) lang = data.language;
            }
        } catch (e) { console.debug("Could not load HA language", e); }
    }

    // Fallback: Browser language.
    if (!lang) lang = navigator.language || 'en';
    
    // Debugging for Add-on context.
    console.log(`I18N: Target language is ${lang}, loading from ${BASE_PATH}locales/`);

    // Normalize language code (shorten to 2 characters to match folder structure).
    const finalLang = lang.split('-')[0];

    await i18next
        .use(i18nextHttpBackend)
        .init({
            lng: finalLang,
            fallbackLng: 'en',
            load: 'languageOnly', // Prevents attempts to load de-DE if only de exists.
            debug: false,
            ns: ['translation'],
            defaultNS: 'translation',
            backend: {
                loadPath: BASE_PATH + 'locales/{{lng}}/translation.json'
            }
        });

    // Global shortcut for easy use in other scripts (e.g., Wizard).
    window.t = i18next.t.bind(i18next);

    updateUIWithTranslations();

    // Re-open settings tab after a reload (e.g., after language change) if requested.
    if (urlParams.get('open') === 'settings') {
        setTimeout(() => {
            if (typeof window.openSettingsTab === 'function') window.openSettingsTab();
            // Remove parameter from URL without reloading the page.
            const newUrl = new URL(window.location.href);
            newUrl.searchParams.delete('open');
            window.history.replaceState({}, document.title, newUrl.toString());
        }, 300);
    }
}

/**
 * Updates UI elements with translations.
 * Can be called for the entire document or a specific element (e.g., the Wizard).
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
        
        // Translate content only if it's not a pure input element or if no attribute target is defined.
        const isInput = ['INPUT', 'TEXTAREA'].includes(el.tagName);
        if (!isInput && !el.hasAttribute('data-i18n-placeholder') && !el.hasAttribute('data-i18n-title')) {
            el.innerHTML = translation;
        }
    });
}

window.initI18next = initI18next;
window.updateUIWithTranslations = updateUIWithTranslations;