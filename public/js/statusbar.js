/**
 * Status Bar Logic
 * Handles the rendering of the footer slots based on settings.
 */

const statusBar = {
    // Cache für Entity-IDs pro Slot, um Updates effizient zu filtern
    slotEntities: {
        slot1: null,
        slot2: null,
        slot3: null
    },

    // Cache für aktuelle Werte (für zeitbasiertes Rendering)
    currentValues: {
        slot1: null,
        slot2: null,
        slot3: null
    },
    
    // History für Sparklines (10 Datenpunkte)
    history: {
        slot1: new Array(10).fill(null),
        slot2: new Array(10).fill(null),
        slot3: new Array(10).fill(null)
    },

    fetchPromise: null,

    init() {
        this.injectStyles();

        // Globalen Cache initialisieren (falls settings.js noch nicht lief)
        window.cachedEntities = window.cachedEntities || [];

        // Listener für Settings-Änderungen
        window.addEventListener('settings-changed', (e) => {
            this.render(e.detail);
        });

        // Listener für System Stats (CPU/RAM)
        socket.on('system_stats', (data) => {
            this.updateSystemStats(data);
        });

        // Listener für HA Entity Updates
        socket.on('ha_state_changed', (data) => {
            // Cache live aktualisieren
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

        // Initial Render falls Settings schon da sind
        if (window.currentSettings) {
            this.render(window.currentSettings);
        }
    },

    injectStyles() {
        if (document.getElementById('statusbar-styles')) return;
        const style = document.createElement('style');
        style.id = 'statusbar-styles';
        // Konzept 1: Wenn 3 Slots aktiv sind (.has-three-slots), Breite auf 33% reduzieren und Canvas ausblenden
        style.innerHTML = `
            .status-slots.has-three-slots .sb-item { min-width: 0; font-size: 0.8rem; }
            .status-slots.has-three-slots.hide-sparklines canvas { display: none !important; }
            .sb-item .val { white-space: nowrap; }
        `;
        document.head.appendChild(style);
    },

    render(settings) {
        // Fallback: Wenn keine Settings da sind, zeige CPU/RAM als Default
        const conf = (settings && settings.statusbar) ? settings.statusbar : { slot1: 'cpu', slot2: 'ram', slot3: 'none' };

        // Sichtbarkeit der gesamten Statusleiste steuern
        const statusBarEl = document.getElementById('status-bar');
        if (statusBarEl) {
            statusBarEl.style.display = conf.show_statusbar === false ? 'none' : 'flex';
        }

        // Layout-Anpassung für 3 Slots (Konzept 1)
        const slotsContainer = document.querySelector('.status-slots');
        if (slotsContainer) {
            const activeSlots = [conf.slot1, conf.slot2, conf.slot3].filter(s => s && s !== 'none').length;
            if (activeSlots >= 3) {
                slotsContainer.classList.add('has-three-slots');
                // Prüfen, ob Sparklines bei Platzmangel ausgeblendet werden sollen (Default: true)
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

        // Reset
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
        } else if (type === 'ram') {
            el.innerHTML = `<i class="mdi mdi-memory"></i> <span class="val">---&nbsp;MB</span> ${canvasHtml}`;
            el.dataset.type = 'ram';
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
        // data = { cpu, app_ram, ... }
        
        ['slot1', 'slot2', 'slot3'].forEach(slotId => {
            const el = document.getElementById(`sb-${slotId}`);
            if (!el || el.classList.contains('sb-hidden')) return;
            
            // History Array holen
            const hist = this.history[slotId];

            if (el.dataset.type === 'cpu') {
                hist.push(data.cpu);
                if (hist.length > 10) hist.shift();

                const valEl = el.querySelector('.val');
                // Pad to 3 chars to prevent jumping (e.g. "  5", " 12")
                valEl.innerText = `${Math.round(data.cpu).toString().padStart(3, '\u00A0')}\u00A0%`;
                if (data.cpu >= 90) valEl.style.color = '#ff5555';
                else if (data.cpu >= 70) valEl.style.color = '#ffb86c';
                else valEl.style.color = '';
                
                // Tooltip wiederherstellen
                el.title = `CPU Usage: ${data.cpu}%`;
                
                this.drawSparkline(el.querySelector('canvas'), hist, { max: 100, thresholds: [50, 70, 90] });
            } else if (el.dataset.type === 'ram') {
                hist.push(data.app_ram);
                if (hist.length > 10) hist.shift();

                const valEl = el.querySelector('.val');
                // Pad to 4 chars to prevent jumping
                valEl.innerText = `${Math.round(data.app_ram).toString().padStart(4, '\u00A0')}\u00A0MB`;
                // Warnung ab 400MB (bei 512MB Limit)
                if (data.app_ram >= 400) valEl.style.color = '#ffb86c';
                else valEl.style.color = '';
                
                // Tooltip wiederherstellen
                const sysUsed = data.ram_used > 1024 ? (data.ram_used / 1024).toFixed(1) + ' GB' : data.ram_used + ' MB';
                const sysTotal = data.ram_total > 1024 ? (data.ram_total / 1024).toFixed(1) + ' GB' : data.ram_total + ' MB';
                el.title = `Node Heap: ${data.app_heap} MB (Scripts)\nNode RSS: ${data.app_ram} MB (Total)\nSystem: ${sysUsed} / ${sysTotal}`;
                
                this.drawSparkline(el.querySelector('canvas'), hist, { max: 512, thresholds: [256, 400, 480] });
            } else if (el.dataset.type === 'custom') {
                // Zeitbasiertes Update: Nutze den letzten bekannten Wert
                const val = this.currentValues[slotId];
                if (val !== null) {
                    hist.push(val);
                    if (hist.length > 10) hist.shift();
                    // Zeichnen (Auto-Scaling passiert in drawSparkline)
                    this.drawSparkline(el.querySelector('canvas'), hist, { color: '#666' });
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
                    const val = data.new_state ? data.new_state.state : 'N/A';
                    const unit = data.new_state && data.new_state.attributes.unit_of_measurement ? `\u00A0${data.new_state.attributes.unit_of_measurement}` : '';
                    el.querySelector('.val').innerText = `${val}${unit}`;

                    // Wert nur cachen, nicht zeichnen (passiert im Takt von updateSystemStats)
                    const numVal = parseFloat(val);
                    this.currentValues[slotId] = !isNaN(numVal) ? numVal : null;

                    // Icon aktualisieren, falls vorhanden
                    if (data.new_state && data.new_state.attributes.icon) {
                        const iconName = data.new_state.attributes.icon.replace('mdi:', '');
                        console.log(`Statusbar: Updating icon for ${data.entity_id} to mdi-${iconName}. Full icon attribute: ${data.new_state.attributes.icon}`);
                        const iconEl = el.querySelector('i');
                        if (iconEl) iconEl.className = `mdi mdi-${iconName}`;
                    }

                    // Tooltip Update: Friendly Name + (Entity ID)
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
        
        // Filter null values for calculation
        const validData = data.filter(v => v !== null && !isNaN(v));
        if (validData.length === 0) return;

        // Auto-Scaling Logic
        let min = options.min !== undefined ? options.min : Math.min(...validData);
        let max = options.max !== undefined ? options.max : Math.max(...validData);
        
        // Prevent flat line division by zero
        if (max === min) { max += 1; min -= 1; }
        const range = max - min;

        const barW = w / data.length;
        data.forEach((v, i) => {
            if (v === null || isNaN(v)) return;

            let color = options.color || '#666'; // Default Grau
            if (options.thresholds) {
                if (v >= options.thresholds[2]) color = '#ff5555';      // Rot
                else if (v >= options.thresholds[1]) color = '#ffb86c'; // Orange
                else if (v >= options.thresholds[0]) color = '#f1fa8c'; // Gelb
            }
            
            ctx.fillStyle = color;
            // Normalize to 0..1 based on range
            const normalized = (v - min) / range;
            const barH = Math.max(2, normalized * h); // Mindestens 2px hoch
            ctx.fillRect(i * barW, h - barH, barW, barH);
        });
    },

    async fetchInitialState(entityId) {
        if (!entityId) return;
        const cleanId = entityId.trim().toLowerCase();
        console.log(`Statusbar: Requesting initial state for '${cleanId}'...`);
        
        // Deduplication: Falls schon ein Request läuft, anhängen
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
                // Retry once after 500ms if apiFetch is missing (race condition)
                setTimeout(() => this.fetchInitialState(entityId), 500);
                return;
            }

            // Request starten (mit Retry)
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
            
            // Nach erfolgreichem Laden: Prüfen für DIESEN Aufruf
            const state = all.find(s => s.entity_id === cleanId);
            if (state) {
                this.updateEntityState({ entity_id: cleanId, new_state: state });
            } else {
                this.updateSlotError(cleanId, 'N/A');
            }
        } catch (e) { 
            console.warn("Statusbar: Init fetch failed", e);
            this.updateSlotError(cleanId, 'Err');
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
                }
            }
        });
    }
};

// Export für app.js
window.statusBar = statusBar;