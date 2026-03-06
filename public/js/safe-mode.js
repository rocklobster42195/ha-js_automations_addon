/**
 * JS Automations - Safe Mode Handler
 * Injected into the frontend to handle bootloop protection UI.
 */
(function() {
    const BANNER_ID = 'safe-mode-banner';

    // Helper to get translations with fallback
    const t = (key, defaultVal) => {
        return (window.i18next && window.i18next.t) ? window.i18next.t(key) : defaultVal;
    };

    function showSafeModeBanner() {
        if (document.getElementById(BANNER_ID)) return;

        const banner = document.createElement('div');
        banner.id = BANNER_ID;
        // Style matching the "Danger" theme (Red/Orange Gradient)
        banner.style.cssText = `
            background: linear-gradient(90deg, #d32f2f 0%, #c62828 100%);
            color: white;
            padding: 10px 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            position: relative;
            z-index: 2000; /* High z-index to stay on top */
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
        `;

        const content = document.createElement('div');
        content.style.cssText = `
            display: flex;
            align-items: center;
            gap: 15px;
            max-width: 1200px;
            width: 100%;
        `;

        // Icon
        const icon = document.createElement('i');
        icon.className = 'mdi mdi-alert-decagram';
        icon.style.fontSize = '24px';

        // Text
        const msg = document.createElement('div');
        msg.innerHTML = `
            <div style="font-weight: bold; font-size: 14px;">${t('safe_mode_title', 'SAFE MODE ACTIVE')}</div>
            <div style="font-size: 13px; opacity: 0.9;">${t('safe_mode_msg', 'Bootloop detected. Scripts are disabled.')}</div>
        `;

        // Button
        const btn = document.createElement('button');
        btn.style.cssText = `
            margin-left: auto;
            font-weight: bold;
            border: none;
            background: #ffffff !important;
            color: #d32f2f !important;
            padding: 0 16px;
            height: 32px;
            line-height: 32px;
            border-radius: 4px;
            cursor: pointer;
            display: inline-flex;
            align-items: center;
            gap: 8px;
            white-space: nowrap;
        `;
        btn.innerHTML = `<i class="mdi mdi-shield-check" style="font-size: 16px;"></i> ${t('safe_mode_btn', 'Exit Safe Mode')}`;
        
        btn.onclick = async () => {
            btn.disabled = true;
            btn.style.opacity = 0.7;
            try {
                // apiFetch is global from api.js
                const res = await apiFetch('api/system/safe-mode/resolve', { method: 'POST' });
                const data = await res.json();
                if (data.success) {
                    banner.remove();
                    alert(t('safe_mode_deactivated', 'Safe Mode deactivated. You can now start scripts manually.'));
                }
            } catch (e) {
                console.error(e);
                alert(t('safe_mode_failed', 'Failed to resolve Safe Mode.'));
                btn.disabled = false;
                btn.style.opacity = 1;
            }
        };

        content.appendChild(icon);
        content.appendChild(msg);
        content.appendChild(btn);
        banner.appendChild(content);

        // Prepend to body
        document.body.insertBefore(banner, document.body.firstChild);
    }

    function hideSafeModeBanner() {
        const banner = document.getElementById(BANNER_ID);
        if (banner) banner.remove();
    }

    // Connect to Socket
    const init = () => {
        if (!window.socket) {
            setTimeout(init, 100);
            return;
        }
        
        window.socket.on('safe_mode', (isActive) => {
            if (isActive) showSafeModeBanner();
            else hideSafeModeBanner();
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();