/**
 * JS AUTOMATIONS - Status Bar Logic
 * Handles the rendering of the footer slots based on settings.
 */

const statusBar = {
    // Cache for entity IDs per slot to filter updates efficiently
    slotEntities: {
        slot1: null,
        slot2: null,
        slot3: null,
    },

    // Cache for current values (for time-based rendering)
    currentValues: {
        slot1: null,
        slot2: null,
        slot3: null
    },    
    // History for sparklines (10 data points)
    history: {
        // The actual history data for each slot
        slot1: new Array(10).fill(null),
        slot2: new Array(10).fill(null),
        slot3: new Array(10).fill(null)
    },

    fetchPromise: null,

    init() {
        this.injectStyles();
        window.cachedEntities = window.cachedEntities || [];

        injectSidebarFooter();

        // Listener for settings changes
        window.addEventListener('settings-changed', (e) => {
            this.render(e.detail);
            // Re-apply MQTT indicator now that settings are available.
            // Fixes reload race: integration_status can arrive before currentSettings is set,
            // causing updateMqttIndicator() to return early with the wrong (disabled) state.
            const mqtt = window.currentIntegrationStatus?.mqtt;
            if (mqtt) this.updateMqttIndicator(mqtt);
        });

        // Handle MQTT status updates
        socket.on('mqtt_status_changed', (status) => {
            this.updateMqttIndicator(status);
        });

        // Listener for system stats
        socket.on('system_stats', (data) => {
            this.updateSystemStats(data);
        });

        // Listener for HA entity updates
        socket.on('ha_state_changed', (data) => {
            if (window.cachedEntities) {
                const idx = window.cachedEntities.findIndex(e => e.entity_id === data.entity_id);
                if (data.new_state) {
                    if (idx >= 0) window.cachedEntities[idx] = data.new_state;
                    else window.cachedEntities.push(data.new_state);
                } else if (idx >= 0) {
                    window.cachedEntities.splice(idx, 1);
                }
            }
            this.updateEntityState(data);
        });

        // Perform initial render if settings are available
        if (window.currentSettings) {
            this.render(window.currentSettings);
        }
    },

    injectStyles() {
        if (document.getElementById('statusbar-styles')) return;
        const style = document.createElement('style');
        style.id = 'statusbar-styles';
        style.innerHTML = `
            #status-bar { 
                background: #111; 
                border-top: 1px solid #333; 
                color: #ccc;
            }
            .status-slots.has-three-slots .sb-item { min-width: 0; font-size: 0.8rem; }
            .status-slots.has-three-slots.hide-sparklines canvas { display: none !important; }
            .sb-item .val { white-space: nowrap; }
            
            /* Ensure the sidebar footer injected via socket-client doesn't create layout gaps */
            .sidebar-footer:empty { display: none; }

            /* Style for Orange Dots in sidebar (Repair/Warning state). */
            .script-item.needs-mqtt .script-status-dot { 
                background-color: #ffb86c !important; 
                box-shadow: 0 0 5px #ffb86c !important; 
            }
        `;
        document.head.appendChild(style);
    },

    /**
     * Updates the MQTT connection indicator using the sidebar icons.
     * @param {object} status - { connected: boolean, error?: string }
     */
    updateMqttIndicator(status) {
        const icon = document.getElementById('integration-status-icon');
        const item = document.getElementById('integration-status-item');
        if (!icon || !item) return;

        // Reset opacity
        icon.style.opacity = '1';
        
        if (!window.currentSettings?.mqtt?.enabled) {
            icon.className = 'mdi mdi-circle-outline integration-icon';
            icon.style.color = '#555';
            icon.style.opacity = '0.3';
            item.title = i18next.t('settings.system.mqtt_disabled');
            return;
        }

        if (status.connected) {
            icon.className = 'mdi mdi-circle-slice-8 integration-icon';
            icon.style.color = '#fff';
            item.title = i18next.t('statusbar.mqtt_connected');
        } else {
            icon.className = 'mdi mdi-circle-outline integration-icon';
            icon.style.color = 'var(--danger)';
            const err = status.error ? i18next.t('settings.system.mqtt_error', { error: status.error }) : i18next.t('settings.system.mqtt_disconnected');
            item.title = err;
        }
    },

    render(settings) {
        // Default configuration if settings are missing or incomplete.
        const conf = (settings && settings.statusbar) ? settings.statusbar : { 
            slot1: 'cpu', 
            slot2: 'ram', 
            slot3: 'none',
            show_statusbar: true 
        };

        const statusBarEl = document.getElementById('status-bar');
        if (statusBarEl) {
            statusBarEl.style.display = conf.show_statusbar === false ? 'none' : 'flex';
        }

        const slotsContainer = document.querySelector('.status-slots');
        if (slotsContainer) {
            const activeSlots = [conf.slot1, conf.slot2, conf.slot3].filter(s => s && s !== 'none').length;
            if (activeSlots >= 3) {
                slotsContainer.classList.add('has-three-slots');
                if (conf.hide_sparkline_on_dense !== false) {
                    slotsContainer.classList.add('hide-sparklines');
                } else {
                    slotsContainer.classList.remove('hide-sparklines');
                }
            } else {
                slotsContainer.classList.remove('has-three-slots');
                slotsContainer.classList.remove('hide-sparklines');
            }
        }

        this.renderSlot('slot1', conf.slot1, conf.customEntitySlot1, conf.show_sparkline_slot1);
        this.renderSlot('slot2', conf.slot2, conf.customEntitySlot2, conf.show_sparkline_slot2);
        this.renderSlot('slot3', conf.slot3, conf.customEntitySlot3, conf.show_sparkline_slot3);
    },

    renderSlot(slotId, type, customEntity, showSparkline) {
        const el = document.getElementById(`sb-${slotId}`);
        if (!el) return;

        // Reset slot state.
        el.className = 'sb-item';
        this.slotEntities[slotId] = null;
        this.currentValues[slotId] = null;

        if (type === 'none' || !type) {
            el.classList.add('sb-hidden');
            return;
        }

        const canvasHtml = (showSparkline !== false) ? '<canvas width="20" height="16" style="opacity:0.8"></canvas>' : '';

        if (type === 'cpu') {
            el.innerHTML = `<i class="mdi mdi-chip"></i> <span class="val">---&nbsp;%</span> ${canvasHtml}`;
            el.dataset.type = 'cpu';
            el.title = i18next.t('settings.statusbar.cpu_usage');
        } else if (type === 'ram') {
            el.innerHTML = `<i class="mdi mdi-memory"></i> <span class="val">---&nbsp;MB</span> ${canvasHtml}`;
            el.dataset.type = 'ram';
            el.title = i18next.t('settings.statusbar.ram_usage');
        } else if (type === 'custom') {
            const cleanEntity = customEntity ? customEntity.trim().toLowerCase() : '';
            this.slotEntities[slotId] = cleanEntity;
            el.dataset.type = 'custom';
            el.innerHTML = `<i class="mdi mdi-eye"></i> <span class="val">Waiting...</span> ${canvasHtml}`;
            el.title = cleanEntity;
            this.fetchInitialState(cleanEntity);
        }
    },

    updateSystemStats(data) {
        // data contains { cpu, app_ram, ... }.
        
        ['slot1', 'slot2', 'slot3'].forEach(slotId => {
            const el = document.getElementById(`sb-${slotId}`);
            if (!el || el.classList.contains('sb-hidden')) return;
            
            // Get history array for the slot.
            const hist = this.history[slotId];

            if (el.dataset.type === 'cpu') {
                hist.push(data.cpu);
                if (hist.length > 10) hist.shift();

                const valEl = el.querySelector('.val');
                // Pad to 3 chars to prevent jumping.
                valEl.innerText = `${Math.round(data.cpu).toString().padStart(3, '\u00A0')}\u00A0%`;
                if (data.cpu >= 90) valEl.style.color = '#ff5555';
                else if (data.cpu >= 70) valEl.style.color = '#ffb86c';
                else valEl.style.color = '';
                
                // Restore tooltip.
                el.title = `${i18next.t('settings.statusbar.cpu_usage')}: ${data.cpu}%`;
                
                this.drawSparkline(el.querySelector('canvas'), hist, { max: 100, thresholds: [50, 70, 90] });
            } else if (el.dataset.type === 'ram') {
                hist.push(data.app_ram);
                if (hist.length > 10) hist.shift();

                const valEl = el.querySelector('.val');
                // Pad value to prevent UI jumping.
                valEl.innerText = `${Math.round(data.app_ram).toString().padStart(4, '\u00A0')}\u00A0MB`;
                // Warning at 400MB (assuming 512MB default limit).
                if (data.app_ram >= 400) valEl.style.color = '#ffb86c';
                else valEl.style.color = '';
                
                // Restore tooltip with detailed memory info.
                const sysUsed = data.ram_used > 1024 ? (data.ram_used / 1024).toFixed(1) + ' GB' : data.ram_used + ' MB';
                const sysTotal = data.ram_total > 1024 ? (data.ram_total / 1024).toFixed(1) + ' GB' : data.ram_total + ' MB';
                el.title = `Node Heap: ${data.app_heap} MB (Scripts)\nNode RSS: ${data.app_ram} MB (Total)\nSystem: ${sysUsed} / ${sysTotal}`;
                
                this.drawSparkline(el.querySelector('canvas'), hist, { max: 512, thresholds: [256, 400, 480] });
            } else if (el.dataset.type === 'custom') {
                // Periodic update: use the last known cached value
                const val = this.currentValues[slotId];
                if (val !== null) {
                    hist.push(val);
                    if (hist.length > 10) hist.shift();
                    // Draw chart (auto-scaling applied in drawSparkline).
                    this.drawSparkline(el.querySelector('canvas'), hist, { color: '#888' });
                }
            }
        });
    },

    updateEntityState(data) {
        // data = { entity_id, new_state }
        ['slot1', 'slot2', 'slot3'].forEach(slotId => {
            const targetEntity = this.slotEntities[slotId];
            if (targetEntity && targetEntity === data.entity_id) {
                const el = document.getElementById(`sb-${slotId}`);
                if (el) {
                    let val = data.new_state ? data.new_state.state : null;
                    let unit = '';

                    if (!val || val === 'unavailable' || val === 'unknown') {
                        val = '--';
                    } else if (data.new_state.attributes.unit_of_measurement) {
                        unit = `\u00A0${data.new_state.attributes.unit_of_measurement}`;
                    }

                    el.querySelector('.val').innerText = `${val}${unit}`;

                    // Cache the value; drawing happens on the system stats interval.
                    const numVal = parseFloat(val);
                    this.currentValues[slotId] = !isNaN(numVal) ? numVal : null;

                    // Update icon.
                    let iconName = 'bookmark'; // Default fallback.
                    if (data.new_state) {
                        if (data.new_state.attributes.icon) {
                            iconName = data.new_state.attributes.icon.replace('mdi:', '');
                        } else {
                            // Domain-based Fallback.
                            const domain = data.entity_id.split('.')[0];
                            const state = data.new_state.state;

                            if (domain === 'sensor') iconName = 'chart-line';
                            else if (domain === 'binary_sensor') iconName = 'radiobox-blank';
                            else if (domain === 'switch' || domain === 'input_boolean') iconName = 'toggle-switch';
                            else if (domain === 'light') iconName = 'lightbulb';
                            else if (domain === 'person') iconName = 'account';
                            else if (domain === 'sun') iconName = 'white-balance-sunny';
                            else if (domain === 'climate') iconName = 'thermostat';
                            else if (domain === 'weather') {
                                const map = {
                                    'clear-night': 'weather-night',
                                    'cloudy': 'weather-cloudy',
                                    'fog': 'weather-fog',
                                    'hail': 'weather-hail',
                                    'lightning': 'weather-lightning',
                                    'lightning-rainy': 'weather-lightning-rainy',
                                    'partlycloudy': 'weather-partly-cloudy',
                                    'pouring': 'weather-pouring',
                                    'rainy': 'weather-rainy',
                                    'snowy': 'weather-snowy',
                                    'snowy-rainy': 'weather-snowy-rainy',
                                    'sunny': 'weather-sunny',
                                    'windy': 'weather-windy',
                                    'windy-variant': 'weather-windy-variant',
                                    'exceptional': 'alert-circle-outline'
                                };
                                iconName = map[state] || 'weather-cloudy';
                            }
                        }
                    } else {
                        iconName = 'alert-circle-outline';
                    }

                    const iconEl = el.querySelector('i');
                    if (iconEl) iconEl.className = `mdi mdi-${iconName}`;

                    // Update tooltip with friendly name and entity ID.
                    if (data.new_state) {
                        const friendly = data.new_state.attributes.friendly_name || data.entity_id;
                        el.title = `${friendly}\n(${data.entity_id})`;
                    }
                }
            }
        });
    },

    drawSparkline(canvas, data, options = {}) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        
        // Filter null values for calculation.
        const validData = data.filter(v => v !== null && !isNaN(v));
        if (validData.length === 0) return;

        // Auto-Scaling Logic.
        let min = options.min !== undefined ? options.min : Math.min(...validData);
        let max = options.max !== undefined ? options.max : Math.max(...validData);
        
        // Prevent flat line division by zero.
        if (max === min) { max += 1; min -= 1; }
        const range = max - min;

        const barW = w / data.length;
        data.forEach((v, i) => {
            if (v === null || isNaN(v)) return;

            let color = options.color || '#666'; // Default Gray.
            if (options.thresholds) {
                if (v >= options.thresholds[2]) color = '#ff5555';      // Rot
                else if (v >= options.thresholds[1]) color = '#ffb86c'; // Orange
                else if (v >= options.thresholds[0]) color = '#f1fa8c'; // Gelb
            }
            
            ctx.fillStyle = color;
            // Normalize to 0..1 based on range.
            const normalized = (v - min) / range;
            const barH = Math.max(2, normalized * h); // Minimum 2px height.
            ctx.fillRect(i * barW, h - barH, barW, barH);
        });
    },

    async fetchInitialState(entityId) {
        if (!entityId) return;
        const cleanId = entityId.trim().toLowerCase();
        console.log(`Statusbar: Requesting initial state for '${cleanId}'...`);
        
        // Deduplication: If a request is already running, wait for it.
        if (this.fetchPromise) {
            try {
                const data = await this.fetchPromise;
                const state = data.find(s => s.entity_id === cleanId);
                if (state) {
                    this.updateEntityState({ entity_id: cleanId, new_state: state });
                } else {
                    this.updateSlotError(cleanId, 'N/A');
                }
            } catch (e) {
                this.updateSlotError(cleanId, 'Err');
            }
            return;
        }

        try {
            if (typeof apiFetch !== 'function') {
                // Retry once after 500ms if apiFetch is missing (race condition).
                setTimeout(() => this.fetchInitialState(entityId), 500);
                return;
            }

            // Start request with retries.
            this.fetchPromise = (async () => {
                let lastErr;
                for (let i = 0; i < 3; i++) {
                    try {
                        console.log(`Statusbar: Fetching HA states via Socket (Attempt ${i+1}/3)...`);
                        
                        if (typeof window.getHAStates !== 'function') throw new Error("Socket client not ready");
                        
                        const data = await window.getHAStates();
                        
                        console.log(`Statusbar: Fetched ${data ? data.length : 0} entities via Socket.`);
                        window.cachedEntities = data;
                        return data;
                    } catch (e) {
                        console.warn(`Statusbar: Attempt ${i+1} failed:`, e);
                        lastErr = e;
                        if (i < 2) await new Promise(r => setTimeout(r, 1000));
                    }
                }
                throw lastErr;
            })();

            const all = await this.fetchPromise;
            
            // After successful load: check for this specific call.
            const state = all.find(s => s.entity_id === cleanId);
            if (state) {
                this.updateEntityState({ entity_id: cleanId, new_state: state });
            } else {
                this.updateSlotError(cleanId, '--');
            }
        } catch (e) { 
            console.warn("Statusbar: Init fetch failed", e);
            this.updateSlotError(cleanId, '--');
        } finally {
            this.fetchPromise = null;
        }
    },

    updateSlotError(entityId, msg) {
        ['slot1', 'slot2', 'slot3'].forEach(slotId => {
            if (this.slotEntities[slotId] === entityId) {
                const el = document.getElementById(`sb-${slotId}`);
                if (el) {
                    const valEl = el.querySelector('.val');
                    if (valEl) valEl.innerText = msg;
                    const iconEl = el.querySelector('i');
                    if (iconEl) iconEl.className = 'mdi mdi-alert-circle-outline';
                }
            }
        });
    }
};

// Export for app.js.
window.statusBar = statusBar;