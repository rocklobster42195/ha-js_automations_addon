// IIFE to handle the integration status banner
(function() {
    const BANNER_ID = 'integration-status-banner';

    // Helper to get translations with fallback
    const t = (key, defaultVal, options) => {
        return (window.i18next && window.i18next.t) ? window.i18next.t(key, options) : defaultVal;
    };

    /**
     * Creates and shows the banner at the top of the page.
     * @param {'install' | 'update'} type The type of notification.
     * @param {object} data The status data from the backend.
     */
    function showBanner(type, data) {
        // If a banner is already shown, remove it before creating a new one to ensure content is updated
        const existingBanner = document.getElementById(BANNER_ID);
        if (existingBanner) existingBanner.remove();

        const banner = document.createElement('div');
        banner.id = BANNER_ID;
        // Style matching a "Warning" theme (Orange Gradient)
        banner.style.cssText = `
            background: linear-gradient(90deg, #f57c00 0%, #ef6c00 100%);
            color: white;
            padding: 10px 20px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.2);
            position: relative;
            z-index: 1999; /* Below safe-mode banner */
            padding-right: 50px; /* Space for close button */
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
            cursor: pointer;
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
        icon.className = 'mdi mdi-package-variant-remove'; // General "package issue" icon
        icon.style.fontSize = '24px';

        // Text Message
        const msg = document.createElement('div');
        let title = '';
        let description = '';
        let buttonText = '';

        if (type === 'install') {
            title = t('integration_missing', 'Integration missing');
            description = t('integration_missing_desc', 'The custom component is required for native entities.');
            buttonText = t('integration_install_btn', 'Install Integration');
            icon.className = 'mdi mdi-package-variant';
        } else if (type === 'update') {
            title = t('integration_update_available', 'Update available');
            description = t('integration_update_desc', 'Installed: v{{installed}} / Available: v{{available}}', {
                installed: data.version_installed,
                available: data.version_available
            });
            buttonText = t('integration_update_btn', 'Update to v{{version}}', { version: data.version_available });
            icon.className = 'mdi mdi-arrow-up-bold-circle-outline';
        }

        msg.innerHTML = `
            <div style="font-weight: bold; font-size: 14px;">${title}</div>
            <div style="font-size: 13px; opacity: 0.9;">${description}</div>
        `;

        // Button
        const btn = document.createElement('button');
        btn.style.cssText = `
            margin-left: auto;
            font-weight: bold;
            border: none;
            background: #ffffff !important;
            color: #f57c00 !important;
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
        btn.innerHTML = `<i class="mdi mdi-cog" style="font-size: 16px;"></i> ${buttonText}`;
        
        // Use the global function to open the settings tab
        btn.onclick = (e) => {
            e.stopPropagation(); // prevent banner click
            if (typeof openSettingsTab === 'function') {
                openSettingsTab('integration');
            }
        };
        
        // Close Button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'mdi mdi-close';
        closeBtn.title = t('banner_close_tooltip', 'Close');
        closeBtn.style.cssText = `
            position: absolute;
            right: 10px;
            top: 50%;
            transform: translateY(-50%);
            background: none;
            border: none;
            color: white;
            font-size: 20px;
            cursor: pointer;
            opacity: 0.7;
            padding: 5px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: opacity 0.2s;
        `;
        closeBtn.onmouseover = () => closeBtn.style.opacity = '1';
        closeBtn.onmouseout = () => closeBtn.style.opacity = '0.7';
        closeBtn.onclick = (e) => {
            e.stopPropagation(); // prevent banner click
            sessionStorage.setItem('js_automations_banner_dismissed', 'true');
            hideBanner();
        };

        banner.onclick = () => {
             if (typeof openSettingsTab === 'function') {
                openSettingsTab('integration');
            }
        };

        content.appendChild(icon);
        content.appendChild(msg);
        content.appendChild(btn);
        banner.appendChild(content);
        banner.appendChild(closeBtn);

        // Prepend to body, but after the safe mode banner if it exists
        const safeModeBanner = document.getElementById('safe-mode-banner');
        if (safeModeBanner) {
            safeModeBanner.insertAdjacentElement('afterend', banner);
        } else {
            document.body.insertBefore(banner, document.body.firstChild);
        }
    }

    function hideBanner() {
        const banner = document.getElementById(BANNER_ID);
        if (banner) banner.remove();
    }

    /**
     * Main handler for the integration status event.
     * @param {object} status The status object from the backend.
     */
    function handleIntegrationStatus(status) {
        if (!status) return;

        // Check if user dismissed it in this session
        if (sessionStorage.getItem('js_automations_banner_dismissed') === 'true') {
            return;
        }

        // Condition to show banner: not installed OR needs update
        const needsBanner = !status.installed || status.needs_update;

        if (needsBanner) {
            const type = !status.installed ? 'install' : 'update';
            showBanner(type, status);
        } else {
            hideBanner();
        }
    }
    
    // Connect to Socket and listen for events
    const init = () => {
        if (!window.socket) {
            setTimeout(init, 100); // Wait for socket-client.js to initialize
            return;
        }
        
        // This is the main trigger
        window.socket.on('integration_status', (status) => {
            handleIntegrationStatus(status);
        });
        
        // Also listen for the initial response to get_integration_status
        window.socket.on('connect', () => {
             if (!window.socket || !window.socket.connected) return;
             window.socket.emit('get_integration_status', (response) => {
                if (response && !response.error) {
                    handleIntegrationStatus(response);
                }
            });
        });
    };

    // Wait for the DOM and socket to be ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
