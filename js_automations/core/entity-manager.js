/**
 * JS AUTOMATIONS - Entity Manager
 * Orchestrates Home Assistant entities via MQTT Discovery and provides IntelliSense definitions.
 */

const path = require('path');
const fs = require('fs');
const ScriptHeaderParser = require('./script-header-parser');
const ScriptWatcher = require('./script-watcher');
const ScriptCommandRouter = require('./script-command-router');
const TypeDefinitionGenerator = require('./type-definition-generator');

class EntityManager {

    /**
     * @param {object} haConnection - The Home Assistant connection manager.
     * @param {object} workerManager - The worker thread manager.
     * @param {object} stateManager - The script state persistence manager.
     * @param {object} depManager - The dependency manager for NPM packages.
     * @param {object} systemService - The system monitoring service.
     * @param {object} mqttManager - The MQTT communication manager.
     * @param {object} compilerManager - The TypeScript compiler manager.
     */
    constructor(haConnection, workerManager, stateManager, depManager, systemService, mqttManager, compilerManager) {
        this.haConnection = haConnection;
        this.workerManager = workerManager;
        this.stateManager = stateManager;
        this.depManager = depManager;
        this.systemService = systemService;
        this.mqttManager = mqttManager;
        this.compilerManager = compilerManager;
        this.warnedEntities = new Set(); // Tracks entities that already triggered a device_class warning
        this.typings = new TypeDefinitionGenerator(haConnection, workerManager);

        new ScriptCommandRouter(workerManager, stateManager, haConnection, mqttManager);

        this.mqttManager.on('status_change', (status) => {
            if (status.connected) {
                this.createSystemEntities();
                const activeScripts = this.workerManager.getScripts().map(p => path.basename(p, path.extname(p)));
                this.cleanupOrphanedEntities(activeScripts);
                this.createExposedEntities(true);
            }
        });

        this.workerManager.on('script_start', (data) => this.handleScriptLifecycle(data, 'start'));
        this.workerManager.on('script_exit', (data) => this.handleScriptLifecycle(data, 'stop'));
        this.workerManager.on('create_entity', (data) => this.handleDynamicEntity(data));
        this.workerManager.on('update_entity_state', (data) => this.handleEntityStateUpdate(data));
        this.workerManager.on('request_device_cleanup', (name) => this.checkDeviceCleanup(name));
        this.workerManager.on('sweep_entity_removed', (entityId) => {
            if (this.haConnection.isReady) {
                this.haConnection.removeEntity(entityId).catch(err => {
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Could not remove swept entity ${entityId} from HA registry: ${err.message}`, level: 'warn' });
                });
            }
        });
        this.systemService.on('system_stats_updated', (stats) => this.updateSystemStates(stats));

        if (this.workerManager.storeManager) {
            this.workerManager.storeManager.on('changed', () => this.typings.schedule());
        }

        this.watcher = new ScriptWatcher(
            workerManager, stateManager, mqttManager, haConnection, compilerManager,
            {
                resolveId:          this.resolveId.bind(this),
                checkDeviceCleanup: this.checkDeviceCleanup.bind(this),
                warnIconConflict:   this._warnIconConflict.bind(this),
                onTypingsNeeded:    () => this.typings.schedule(),
            }
        );
        this.watcher.start();
    }

    /**
     * Attempts to resolve a name to an ID using Home Assistant metadata.
     */
    resolveId(input, list, idField) {
        if (!input || typeof input !== 'string') return undefined;
        const cleanInput = input.trim();
        if (!cleanInput || !list || list.length === 0) return undefined;

        const lowerInput = cleanInput.toLowerCase();

        // 1. Direct ID Match
        const directMatch = list.find(item => item[idField] === cleanInput);
        if (directMatch) return directMatch[idField];

        // 2. Name Match (Case-Insensitive)
        const nameMatch = list.find(item => item.name && item.name.toLowerCase() === lowerInput);
        return nameMatch ? nameMatch[idField] : undefined;
    }

    /**
     * Updates the HA state of a script's control entity (switch/button)
     * based on its running status.
     */
    async handleScriptLifecycle({ filename, meta }, action) {
        if (!meta || !meta.expose || !this.mqttManager.isConnected) return;

        const ext = path.extname(filename);
        const scriptNameRaw = path.basename(filename, ext);
        const slug = scriptNameRaw.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const domain = meta.expose === 'button' ? 'button' : 'switch';
        const scriptFile = path.basename(filename);
        const entityId = `${domain}.jsa_${slug}`;
        const isRunning = (action === 'start');

        this.stateManager.set(entityId, isRunning ? 'on' : 'off');

        // Determine dynamic icon based on current running state
        let entityIcon = meta.icon;
        if (domain === 'button') entityIcon = 'mdi:play';
        else if (domain === 'switch') entityIcon = isRunning ? 'mdi:stop' : 'mdi:play';

        // Publish state and updated icon to MQTT. The icon is passed as an attribute 
        // to support the icon_template defined in discovery.
        const scriptEntities = this.workerManager.scriptEntityMap.get(scriptFile);
        if (scriptEntities && scriptEntities.has(entityId)) {
            const config = this.workerManager.nativeEntities.get(entityId);
            this.mqttManager.publishEntityState(config, isRunning ? 'ON' : 'OFF', { icon: entityIcon });
        }
    }

    /**
     * Handles dynamic entity registration from ha.register() in scripts.
     * Generates MQTT discovery payloads for these entities.
     * @param {object} data - The registration data containing filename, entityId, and config.
     */
    async handleDynamicEntity({ filename, entityId, config }) {
        this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Registering dynamic entity: ${entityId}`, level: 'debug' });

        if (!this.mqttManager.isConnected) return;

        const ext = path.extname(filename);
        const scriptNameRaw = path.basename(filename, ext);
        const scriptPath = path.join(this.workerManager.scriptsDir, filename);
        const meta = fs.existsSync(scriptPath) ? ScriptHeaderParser.parse(scriptPath) : { name: scriptNameRaw };

        // Prettify the script/device name for the HA UI.
        const displayName = (meta.name && meta.name !== filename)
            ? meta.name
            : scriptNameRaw.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        const scriptSlug = scriptNameRaw.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

        // Extract domain and the object part (everything after the first dot)
        const domain = entityId.split('.')[0];
        const objectId = entityId.includes('.') ? entityId.split('.').slice(1).join('.') : entityId;

        // Generate a readable default name from the ID
        const defaultFriendlyName = objectId.replace(/[._-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

        // Unique ID: jsa_<scriptSlug>_<objectId> — globally unique in HA's entity registry.
        const uniqueId = `jsa_${scriptSlug}_${objectId}`;

        // Use objectId (not uniqueId) as the discovery topic component.
        // HA derives the entity_id from the topic component, so this ensures
        // the resulting entity_id is exactly what the user specified (e.g. sensor.mqtt_test_4).
        const discoveryTopic = `homeassistant/${domain}/${objectId}/config`;

        // Don't force a fallback icon when device_class is set — HA provides its own class icon.
        const fallbackIcon = config.icon || (config.device_class ? undefined : 'mdi:eye');
        const payload = {
            name: config.name || config.friendly_name || defaultFriendlyName,
            // default_entity_id: HA 2025.10+ replacement for the deprecated object_id field.
            // Takes the full entity_id (domain.object_id). object_id is kept for HA < 2025.10.
            default_entity_id: entityId,
            object_id: objectId,
            unique_id: uniqueId,
            state_topic: `jsa/${domain}/${objectId}/data`,
            value_template: "{{ value_json.state }}",
            json_attributes_topic: `jsa/${domain}/${objectId}/data`,
            json_attributes_template: "{{ value_json.attributes | tojson }}",
            icon: fallbackIcon,
            force_update: true,
            availability_topic: 'jsa/status',
            unit_of_measurement: config.unit_of_measurement,
            device_class: config.device_class,
            state_class: config.state_class,
            entity_category: config.entity_category,
            options: config.options,
            min: config.min,
            max: config.max,
            step: config.step,
            mode: config.mode,
            suggested_display_precision: config.suggested_display_precision,
            enabled_by_default: config.enabled_by_default,
            expire_after: config.expire_after,
        };

        // Attach the entity to the script's device only if the user opts in via `device: true`
        // in ha.register(). By default, entities are standalone so that HA uses `default_entity_id`
        // directly for entity_id generation — without device context, HA reliably sets
        // entity_id = default_entity_id (exactly what the user specified).
        // With a device block present, HA tends to generate entity_id from
        // {device_name_slug}_{entity_name_slug}, ignoring default_entity_id.
        if (config.device === true || (typeof config.device === 'object' && config.device !== null)) {
            const deviceConfig = typeof config.device === 'object' ? config.device : {};
            payload.device = {
                identifiers: deviceConfig.identifiers || [`jsa_script_${scriptSlug}`],
                name: deviceConfig.name || displayName,
                manufacturer: deviceConfig.manufacturer || "JS Automations",
                model: deviceConfig.model || "Script",
            };
            if (deviceConfig.sw_version) payload.device.sw_version = deviceConfig.sw_version;
            if (deviceConfig.hw_version) payload.device.hw_version = deviceConfig.hw_version;
            if (deviceConfig.configuration_url) payload.device.configuration_url = deviceConfig.configuration_url;
        }

        // Add command topic for interactive entities
        if (['switch', 'button', 'number', 'select', 'text'].includes(domain)) {
            payload.command_topic = `jsa/${domain}/${objectId}/set`;
        }

        // For device entities: set suggested_area as a discovery-time hint.
        // Standalone entities get their area set post-registration via WebSocket API.
        if (payload.device && (config.area || config.suggested_area)) {
            const { areas } = await this.haConnection.getHAMetadata();
            const areaName = config.area || config.suggested_area;
            const areaId = this.resolveId(areaName, areas, 'area_id');
            if (areaId) payload.device.suggested_area = areaName;
        }

        // Check for potential icon conflicts with device_class
        const hasIcon = config.icon || (config.attributes && config.attributes.icon);
        if (config.device_class && hasIcon) {
            this._warnIconConflict(entityId, config.device_class);
        }

        // Before publishing: remove any stale HA entity that would prevent HA from creating
        // the correct entity_id. Two cases:
        // 1. Same unique_id, wrong entity_id (code version change, topic format change)
        // 2. Name-slug entity_id — HA creates this when object_id is missing in old payload.
        //    HA won't rename an existing entity even if object_id is added later.
        //
        // Critical: when a stale entity is found, we MUST also clear our own discovery topic
        // BEFORE republishing. HA's MQTT integration keeps an internal topic→entity mapping;
        // removing only the registry entry is not enough — HA will still update the old entity
        // when it sees a new config on the same topic. Publishing empty first forces HA to
        // dissolve the mapping, so the follow-up config creates a fresh entity correctly.
        let needsTopicClear = false;
        if (this.haConnection.isReady) {
            try {
                const entityReg = await this.haConnection.getEntityRegistry();

                const removeStale = async (stale) => {
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Removing stale entity ${stale.entity_id} (should be ${entityId})`, level: 'debug' });
                    await this.haConnection.removeEntity(stale.entity_id);
                    const staleObjId = stale.entity_id.split('.').slice(1).join('.');
                    this.mqttManager.publish(`homeassistant/${domain}/${staleObjId}/config`, '', { retain: true });
                    if (stale.unique_id && stale.unique_id !== staleObjId) {
                        this.mqttManager.publish(`homeassistant/${domain}/${stale.unique_id}/config`, '', { retain: true });
                    }
                    needsTopicClear = true;
                };

                // Case 1: same unique_id, wrong entity_id
                const staleById = entityReg.find(e => e.unique_id === uniqueId && e.entity_id !== entityId);
                if (staleById) await removeStale(staleById);

                // Case 2: HA derived entity_id from name slug (no object_id in old payload).
                // HA slugifies: lowercase, non-[a-z0-9] → '_', collapse multiple underscores.
                const nameSlug = (payload.name || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
                const nameEntityId = `${domain}.${nameSlug}`;
                if (nameEntityId !== entityId) {
                    const staleByName = entityReg.find(e =>
                        e.entity_id === nameEntityId &&
                        e.unique_id?.startsWith('jsa_') &&
                        e !== staleById
                    );
                    if (staleByName) await removeStale(staleByName);
                }

                // Case 3: desired entity_id is blocked by a foreign (non-JSA) entity — a relic
                // from a previous integration (e.g. old Tedee integration, renamed script, etc.).
                // HA would silently append '_2', '_3'… to avoid the collision. We remove the
                // blocker so our entity_id lands correctly.
                const blocker = entityReg.find(e =>
                    e.entity_id === entityId &&
                    e.unique_id !== uniqueId &&
                    !e.unique_id?.startsWith('jsa_') &&
                    e !== staleById
                );
                if (blocker) {
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] entity_id ${entityId} blocked by foreign relic ${blocker.unique_id} — removing blocker.`, level: 'warn' });
                    await removeStale(blocker);
                }
            } catch (err) {
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Could not check HA registry for stale entity (${entityId}): ${err.message}`, level: 'warn' });
            }
        }

        // Clear our discovery topic before publishing the real config when:
        // (a) a stale entity was found and removed (needsTopicClear), OR
        // (b) the entity is brand-new (not yet tracked in nativeEntities).
        //
        // Case (b) handles old retained broker messages: if a previous addon version
        // published this topic WITHOUT object_id, HA already processed that retained
        // message at startup and created the wrong entity_id (name-slug based). Our
        // new payload would arrive too late and just update the wrong entity.
        // Publishing empty first forces HA's MQTT integration to dissolve its
        // internal topic→entity mapping, so the follow-up config creates a fresh
        // entity with the correct object_id.
        const isNewEntity = !this.workerManager.nativeEntities.has(entityId);
        if (needsTopicClear || isNewEntity) {
            this.mqttManager.publish(discoveryTopic, '', { retain: true });
        }

        this.mqttManager.publish(discoveryTopic, payload, { retain: true });

        const initialState = config.initial_state !== undefined ? config.initial_state : 'unknown';
        this.mqttManager.publishEntityState(payload, initialState, {
            icon: fallbackIcon,
            ...config.attributes
        });

        // Register in managers to track ownership and state
        this.workerManager.registerEntity(filename, entityId, payload);
        // Ensure full path is used for state tracking consistency
        this.stateManager.registerEntity(entityId, scriptPath);

        // Post-registration: apply area_id, labels, and device alias.
        // HA needs a moment to process the MQTT discovery message before the entity
        // appears in the registry, so we defer these by 2 seconds.
        const needsPostUpdate = this.haConnection.isReady && (
            payload.device || config.area_id || config.area || config.labels
        );
        if (needsPostUpdate) {
            // Add a small stagger/jitter (0-500ms) to prevent a "thundering herd" of WebSocket 
            // requests when a script registers many entities at once, avoiding MaxListenersExceededWarning.
            const stagger = Math.floor(Math.random() * 500);
            setTimeout(async () => {
                try {
                    const entityReg = await this.haConnection.getEntityRegistry();
                    const haEntry = entityReg.find(e => e.unique_id === uniqueId);
                    if (!haEntry) return;

                    // Device alias: HA may generate a different entity_id for device-grouped entities
                    if (payload.device && haEntry.entity_id !== entityId) {
                        this.workerManager.setEntityIdAlias(haEntry.entity_id, entityId);
                    }

                    // Area and labels: resolve names → IDs and push via WebSocket API
                    const registryUpdates = {};

                    if (config.area_id) {
                        registryUpdates.area_id = config.area_id;
                    } else if (config.area || config.suggested_area) {
                        const { areas } = await this.haConnection.getHAMetadata();
                        const areaName = config.area || config.suggested_area;
                        const resolved = this.resolveId(areaName, areas, 'area_id');
                        if (resolved) registryUpdates.area_id = resolved;
                    }

                    if (Array.isArray(config.labels) && config.labels.length > 0) {
                        const { labels: allLabels } = await this.haConnection.getHAMetadata();
                        const resolvedLabels = config.labels
                            .map(l => {
                                const found = allLabels.find(al =>
                                    al.label_id === l || al.name?.toLowerCase() === l.toLowerCase()
                                );
                                return found ? found.label_id : null;
                            })
                            .filter(Boolean);
                        if (resolvedLabels.length > 0) registryUpdates.labels = resolvedLabels;
                    }

                    if (Object.keys(registryUpdates).length > 0) {
                        await this.haConnection.updateEntityRegistry(haEntry.entity_id, registryUpdates);
                    }
                } catch (_) {}
            }, 2000 + stagger);
        }
    }

    /**
     * Publishes state updates for dynamic entities via MQTT.
     */
    handleEntityStateUpdate({ entityId, state, attributes }) {
        this.workerManager.emit('log', { source: 'System', message: `[EntityManager] State update for ${entityId}: ${state}. Attributes: ${JSON.stringify(attributes)}`, level: 'debug' });

        if (!this.mqttManager.isConnected) return;

        const config = this.workerManager.nativeEntities.get(entityId);
        if (config) {
            if (config.device_class && attributes && (attributes.icon || attributes.entity_icon)) {
                this._warnIconConflict(entityId, config.device_class);
            }

            // If a new icon is provided, re-publish the discovery payload with the updated icon.
            // icon_template is deprecated in HA 2024+, so we update the static icon field directly.
            const newIcon = attributes?.icon || attributes?.entity_icon;
            if (newIcon && newIcon !== config.icon) {
                config.icon = newIcon;

                const domain = entityId.split('.')[0];
                const topicId = config.object_id || config.unique_id;
                const discoveryTopic = `homeassistant/${domain}/${topicId}/config`;
                this.mqttManager.publish(discoveryTopic, config, { retain: true });

                // Persist the updated icon to disk so republishNativeEntities uses the
                // correct icon after a restart instead of the original ha.register() value.
                this.workerManager.saveRegistry();

                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Re-publishing discovery for ${entityId} with new icon: ${newIcon}`, level: 'debug' });
            }

            const enrichedAttributes = {
                ...(config.icon ? { icon: config.icon } : {}),
                ...attributes,
            };

            this.mqttManager.publishEntityState(config, state, enrichedAttributes);
        }
    }

    /**
     * Logs a warning if an entity might have its icon ignored by Home Assistant due to device_class.
     * @param {string} entityId - The entity ID.
     * @param {string} deviceClass - The device class of the entity.
     * @private
     */
    _warnIconConflict(entityId, deviceClass) {
        if (!this.warnedEntities.has(entityId)) {
            this.warnedEntities.add(entityId);
            this.workerManager.emit('log', {
                source: 'System',
                message: `⚠️ Warning: Entity '${entityId}' uses device_class '${deviceClass}'. Home Assistant often ignores custom icons for these classes in favor of class-specific defaults.`,
                level: 'warn'
            });
        }
    }

    /**
     * Robust extraction helper for numeric values from various data structures.
     * @private
     */
    _getNumericValue(raw, keys) {
        if (raw === undefined || raw === null) return undefined;
        if (typeof raw === 'object') {
            for (const key of keys) {
                if (raw[key] !== undefined && raw[key] !== null) return parseFloat(raw[key]);
            }
            return undefined;
        }
        return parseFloat(raw);
    }

    /**
     * Updates the actual state of the system entities in Home Assistant.
     * Called whenever the SystemService provides new statistics.
     */
    async updateSystemStates(stats) {
        if (!this.mqttManager.isConnected) return;

        // Defensive extraction for CPU
        const cpuValue = this._getNumericValue(stats.cpu, ['usage', 'percent', 'percentage']);

        // Defensive extraction for RAM
        // Check multiple common property names for memory stats.
        // statusbar.js uses 'app_ram' (Node RSS) and 'app_heap' (V8 Memory).
        let ramRaw = stats.ram;
        if (ramRaw === undefined) ramRaw = stats.memory;
        if (ramRaw === undefined) ramRaw = stats.mem;
        if (ramRaw === undefined) ramRaw = stats.app_ram;
        if (ramRaw === undefined) ramRaw = stats.app_heap;

        const ramValue = this._getNumericValue(ramRaw, ['used', 'usage', 'mem_usage', 'percentage', 'percent', 'value', 'rss', 'heapUsed', 'app_ram']);

        const updates = [
            { slug: 'system_cpu_usage', state: cpuValue },
            { slug: 'system_mem_usage', state: ramValue }
        ];

        for (const update of updates) {
            if (update.state === undefined || update.state === null || isNaN(update.state)) continue;
            this.mqttManager.publish(`jsa/sensor/${update.slug}/state`, update.state.toString(), { retain: true });
        }
    }

    /**
     * Ensures that system-wide entities (CPU, RAM) are registered 
     * within the central "JS Automations" device.
     */
    async createSystemEntities() {
        const device = {
            identifiers: ['jsa_system_device'],
            name: "JS Automations",
            manufacturer: "JS Automations",
            model: "System",
        };

        const entities = [
            {
                slug: 'system_cpu_usage',
                name: 'System CPU Usage',
                icon: 'mdi:chip',
                unit: '%',
                device_class: 'measurement'
            },
            {
                slug: 'system_mem_usage',
                name: 'System RAM Usage',
                icon: 'mdi:memory',
                unit: 'MB',
                device_class: 'measurement'
            }
        ];

        for (const entity of entities) {
            const discoveryTopic = `homeassistant/sensor/jsa_${entity.slug}/config`;
            const payload = {
                name: entity.name,
                unique_id: `jsa_${entity.slug}`,
                state_topic: `jsa/sensor/${entity.slug}/state`,
                unit_of_measurement: entity.unit,
                icon: entity.icon,
                device: device,
                availability_topic: 'jsa/status'
            };
            this.mqttManager.publish(discoveryTopic, payload, { retain: true });
            this.workerManager.registerEntity('system', `sensor.jsa_${entity.slug}`, payload);
        }
    }

    async createExposedEntities(onlyIfMissing = false) {
        const scripts = await this.workerManager.getScripts();

        // Load metadata for ID resolution (Areas, Labels)
        const { areas, labels } = await this.haConnection.getHAMetadata();

        this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Syncing exposed entities for ${scripts.length} scripts`, level: 'debug' });

        // Register system-wide monitoring entities via MQTT
        await this.createSystemEntities();
        this.typings.schedule();

        for (const scriptPath of scripts) {
            // Skip passive libraries located in the /libraries subfolder
            if (path.basename(path.dirname(scriptPath)) === 'libraries') continue;

            const meta = ScriptHeaderParser.parse(scriptPath);
            const ext = path.extname(scriptPath);
            const scriptNameRaw = path.basename(scriptPath, ext);
            const slug = scriptNameRaw.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');

            // Prettify name if no custom name is set
            const displayName = (meta.name && meta.name !== path.basename(scriptPath))
                ? meta.name
                : scriptNameRaw.replace(/[_-]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());

            const protectedIds = [];

            const domain = meta.expose === 'button' ? 'button' : 'switch';
            const uniqueId = `jsa_${domain}_${slug}`;

            // If script has no @expose header, ensure any existing MQTT discovery is purged
            if (!meta.expose || !['switch', 'button'].includes(meta.expose)) {
                this.mqttManager.publish(`homeassistant/switch/jsa_switch_${slug}/config`, null, { retain: true });
                this.mqttManager.publish(`homeassistant/button/jsa_button_${slug}/config`, null, { retain: true });
                this.workerManager.setProtectedEntities(path.basename(scriptPath), []);
                continue;
            }

            const isRunning = this.workerManager.workers.has(path.basename(scriptPath));
            const entityId = `${domain}.jsa_${slug}`;

            let entityIcon = meta.icon;
            if (domain === 'button') entityIcon = 'mdi:play';
            else if (domain === 'switch') entityIcon = isRunning ? 'mdi:stop' : 'mdi:play';

            const initialState = (domain === 'switch' && isRunning) ? 'ON' : 'OFF';

            const areaId = this.resolveId(meta.area, areas, 'area_id');
            if (meta.area && !areaId) this.workerManager.emit('log', { source: 'System', message: `⚠️ Could not resolve Area '${meta.area}' for ${scriptNameRaw}`, level: 'debug' });

            // Use uniqueId in discovery topic for stability and rename protection
            const discoveryTopic = `homeassistant/${domain}/${uniqueId}/config`;

            const payload = {
                name: null, // Entity inherits the device name directly (no doubling)
                unique_id: uniqueId,
                // Unified topic approach for script control entities
                state_topic: `jsa/${domain}/${slug}/data`,
                value_template: "{{ value_json.state }}",
                json_attributes_topic: `jsa/${domain}/${slug}/data`,
                json_attributes_template: "{{ value_json.attributes | tojson }}",
                // Dynamic icon template for exposed script entities.
                icon_template: `{{ value_json.icon if value_json.icon is defined else '${entityIcon || 'mdi:script-text'}' }}`,
                force_update: true,
                has_entity_name: true,
                availability_topic: 'jsa/status',
                device: {
                    identifiers: [`jsa_script_${slug}`],
                    name: displayName,
                    manufacturer: "JS Automations",
                    model: "Script",
                }
            };

            if (areaId) payload.device.suggested_area = meta.area;
            if (domain === 'switch' || domain === 'button') payload.command_topic = `jsa/${domain}/${slug}/set`;

            this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Syncing exposed entity ${entityId}`, level: 'debug' });
            this.mqttManager.publish(discoveryTopic, payload, { retain: true });

            // Publish initial state and icon
            this.mqttManager.publishEntityState(payload, initialState, { icon: entityIcon });

            this.workerManager.registerEntity(path.basename(scriptPath), entityId, payload);
            protectedIds.push(entityId);
            this.stateManager.registerEntity(entityId, scriptPath);
            this.stateManager.set(entityId, initialState.toLowerCase());

            // Mark as protected from Mark-and-Sweep
            this.workerManager.setProtectedEntities(path.basename(scriptPath), protectedIds);
        }
    }

    /**
     * Compares the Home Assistant entity registry with local scripts.
     * 1. Removes entities in HA that no longer have a corresponding script file.
     * 2. Ensures all @expose entities exist (Self-Healing).
     */
    async cleanupOrphanedEntities(activeScriptNames) {
        // Ensure connection to both HA (for registry access) and MQTT (for purging retained messages).
        if (!this.haConnection.isReady || !this.mqttManager.isConnected) return;

        this.workerManager.emit('log', { source: 'System', message: '[EntityManager] Running global entity cleanup and legacy relic removal...', level: 'debug' });

        const entityReg = await this.haConnection.getEntityRegistry();
        const deviceReg = await this.haConnection.getDeviceRegistry();

        // Build entity_id alias map for device: true entities.
        // When HA generates a device-prefixed entity_id (e.g. sensor.my_device_my_sensor),
        // map it back to the user's entity_id (e.g. sensor.my_sensor) so that
        // ha.getState(), ha.on(), ha.states etc. work with the user's id.
        for (const [userEntityId, payload] of this.workerManager.nativeEntities.entries()) {
            if (!payload?.unique_id) continue;
            const haEntry = entityReg.find(e => e.unique_id === payload.unique_id);
            if (haEntry && haEntry.entity_id !== userEntityId) {
                this.workerManager.setEntityIdAlias(haEntry.entity_id, userEntityId);
            }
        }

        // CLEANUP RELIC: Specifically target stubborn legacy entities or prefixed ghost variations.
        // This part targets entities from the old custom integration (platform === 'js_automations').
        const stubbornEntities = entityReg.filter(e =>
            e.entity_id.includes('waschmaschinen_skript') ||
            e.entity_id.includes('js_automations_') ||
            (e.platform === null && e.entity_id.startsWith('sensor.jsa_'))
        );

        for (const ghost of stubbornEntities) {
            this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Purging legacy/ghost entity: ${ghost.entity_id}`, level: 'debug' });

            // 1. Remove from Home Assistant Registry via WebSocket API.
            await this.haConnection.removeEntity(ghost.entity_id);

            // 2. Remove from local memory to prevent the addon from re-publishing it.
            this.workerManager.nativeEntities.delete(ghost.entity_id);

            // 3. Scrub from script-to-entity mapping cache.
            for (const [file, entities] of this.workerManager.scriptEntityMap.entries()) {
                if (entities.has(ghost.entity_id)) {
                    entities.delete(ghost.entity_id);
                }
            }

            // 4. Attempt to purge potential MQTT discovery topics for this unique_id.
            const domain = ghost.entity_id.split('.')[0];
            if (ghost.unique_id) {
                this.mqttManager.publish(`homeassistant/${domain}/${ghost.unique_id}/config`, null, { retain: true });
            }
        }

        // 5. Explicitly scan the local registry for the ghost ID, even if not found in HA's current registry.
        for (const [entityId, payload] of this.workerManager.nativeEntities) {
            if (entityId.includes('waschmaschinen_skript')) {
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Cleaning local registry for ghost: ${entityId}`, level: 'debug' });
                this.workerManager.nativeEntities.delete(entityId);
                const domain = entityId.split('.')[0];
                if (payload.unique_id) {
                    this.mqttManager.publish(`homeassistant/${domain}/${payload.unique_id}/config`, null, { retain: true });
                }
            }
        }

        // Force a save of the cleaned local registry to disk.
        this.workerManager.saveRegistry();

        const deviceMap = new Map(deviceReg.map(d => [d.id, d]));
        const lowerActiveScripts = activeScriptNames.map(n => n.toLowerCase());
        const noActiveScripts = lowerActiveScripts.length === 0;

        // Filter for entities owned by our system (legacy platform or MQTT jsa_ prefix)
        const ourEntities = entityReg.filter(e =>
            e.platform === 'js_automations' ||
            (e.unique_id && e.unique_id.startsWith('jsa_'))
        );

        for (const entity of ourEntities) {
            // CLEANUP RELIC: Legacy entities from the old custom component must be removed 
            // to allow MQTT Discovery to claim the IDs.
            const isRelic = entity.platform === 'js_automations';

            if (!entity.unique_id) {
                if (noActiveScripts) {
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Found orphaned entity ${entity.entity_id} with no unique_id. Removing...`, level: 'debug' });
                    // Note: Direct removal via WebSocket API is preferred here
                    await this.haConnection.removeEntity(entity.entity_id);
                } else {
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Skipping entity ${entity.entity_id} with no unique_id as scripts are still active.`, level: 'debug' });
                }
                continue; // Move to next entity
            }

            let scriptName = null;
            const device = entity.device_id ? deviceMap.get(entity.device_id) : null;

            // PROTECT SYSTEM ENTITIES: Explicitly skip any system related unique_ids
            if (entity.unique_id && (entity.unique_id.includes('_system_'))) {
                continue;
            }

            if (device && device.identifiers) {
                // Only look for script identifiers to determine ownership
                const mainIdentifier = device.identifiers.find(idPair => {
                    // Identifiers can be [domain, id] pairs or just strings depending on registry version/source
                    const id = Array.isArray(idPair) ? idPair[1] : idPair;
                    return id && (id.startsWith('jsa_script_') || id.startsWith('js_automations_script_'));
                });

                if (mainIdentifier) {
                    const idStr = Array.isArray(mainIdentifier) ? mainIdentifier[1] : mainIdentifier;
                    scriptName = idStr.startsWith('jsa_script_')
                        ? idStr.substring('jsa_script_'.length)
                        : idStr.substring('js_automations_script_'.length);
                }
            }

            if (!scriptName) {
                // Fallback: look up the owning script from our local registry.
                // This correctly handles both old and new unique_id formats without fragile string parsing.
                for (const [file, entityIds] of this.workerManager.scriptEntityMap.entries()) {
                    if (file === 'system') continue;
                    if (entityIds.has(entity.entity_id)) {
                        scriptName = path.basename(file, path.extname(file)).toLowerCase();
                        break;
                    }
                }
            }

            if (!scriptName) {
                // Last resort: parse legacy unique_id formats
                // Old format (pre-fix): jsa_<domain>_<scriptSlug>_<objectId> — unreliable, skip
                // Legacy format: js_automations_<domain>_<scriptSlug>
                const parts = entity.unique_id.split('_');
                if (parts.length > 3 && parts[0] === 'js' && parts[1] === 'automations') {
                    scriptName = parts.slice(3).join('_');
                } else if (parts.length > 2 && parts[0] === 'js' && parts[1] === 'automations') {
                    scriptName = parts.slice(2).join('_');
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Using legacy unique_id format fallback for ${entity.entity_id} -> ${scriptName}`, level: 'debug' });
                }
            }

            if (!scriptName) {
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Could not determine script name for ${entity.entity_id}, skipping cleanup.`, level: 'debug' });
                continue;
            }

            // STALE ENTITY_ID CHECK: For non-relic entities belonging to active scripts,
            // detect the case where HA has the entity registered under the wrong entity_id
            // (e.g. created by an older code version before the object_id fix).
            // We find any local registry entry whose unique_id matches — if the entity_id
            // differs from what HA has, remove the stale HA entry so it gets recreated correctly.
            if (!isRelic && lowerActiveScripts.includes(scriptName.toLowerCase())) {
                const localEntry = Array.from(this.workerManager.nativeEntities.entries())
                    .find(([, payload]) => payload?.unique_id === entity.unique_id);
                if (localEntry && localEntry[0] !== entity.entity_id) {
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Stale entity_id in HA: ${entity.entity_id} → should be ${localEntry[0]}. Removing stale entry.`, level: 'debug' });
                    await this.haConnection.removeEntity(entity.entity_id);
                    const staleDomain = entity.entity_id.split('.')[0];
                    this.mqttManager.publish(`homeassistant/${staleDomain}/${entity.unique_id}/config`, '', { retain: true });
                }
                continue; // Active-script entities are managed elsewhere; never orphan-remove them
            }

            if (isRelic || !lowerActiveScripts.includes(scriptName.toLowerCase())) {
                const action = isRelic ? 'Removing integration relic' : 'Removing orphaned MQTT entity from HA registry';
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] ${action}: ${entity.entity_id}`, level: 'debug' });

                // Direct removal from HA registry is the most reliable way to get rid of "ghost" entities
                // that persist after MQTT topics are cleared.
                await this.haConnection.removeEntity(entity.entity_id);

                // Clear MQTT discovery topics. Derive object_id directly from the entity_id
                // (e.g. sensor.mqtt_test_35 → mqtt_test_35) — no localPayload lookup needed.
                // For ha.register entities the discovery topic is object_id-based; for @expose
                // Determine the exact discovery topic that was used for this entity:
                //   ha.register → object_id (e.g. "mqtt_test_40")
                //   @expose switch/button → unique_id (e.g. "jsa_switch_my_script")
                // The local payload is the authoritative source; fall back to derivedObjectId.
                const domain = entity.entity_id.split('.')[0];
                const derivedObjectId = entity.entity_id.split('.').slice(1).join('.');
                const localPayload = this.workerManager.nativeEntities.get(entity.entity_id);
                const topicId = localPayload?.object_id || localPayload?.unique_id || entity.unique_id || derivedObjectId;
                this.mqttManager.publish(`homeassistant/${domain}/${topicId}/config`, '', { retain: true });
                // Clear retained state/attributes topic
                const stateTopic = localPayload?.state_topic || `jsa/${domain}/${derivedObjectId}/data`;
                this.mqttManager.publish(stateTopic, '', { retain: true });

                // Find the actual filename (js or ts) from the manager's map
                const fileName = Array.from(this.workerManager.scriptEntityMap.keys()).find(k => {
                    const base = path.basename(k, path.extname(k));
                    return base.toLowerCase() === scriptName.toLowerCase();
                });
                if (fileName) {
                    await this.workerManager.removeScriptEntities(fileName);
                }
            }
        }

        // Clean up local registry entries for scripts that are no longer active,
        // even if HA no longer has their entities (already MQTT-purged in a prior run).
        // Snapshot the entries first to avoid modifying the map while iterating.
        for (const [file, entityIds] of [...this.workerManager.scriptEntityMap.entries()]) {
            if (file === 'system') continue;
            const basename = path.basename(file, path.extname(file)).toLowerCase();
            if (!lowerActiveScripts.includes(basename) && entityIds.size > 0) {
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Purging local registry for inactive script: ${file}`, level: 'debug' });
                await this.workerManager.removeScriptEntities(file);
            }
        }

        // After cleaning entities, clean up any devices that are now empty
        await this.cleanupOrphanedDevices();

        await this.createExposedEntities();
    }

    /**
     * Removes devices from the 'js_automations' integration that no longer have any entities.
     */
    async cleanupOrphanedDevices() {
        this.workerManager.emit('log', { source: 'System', message: '[EntityManager] Starting cleanup of orphaned devices', level: 'debug' });

        const devices = await this.haConnection.getDeviceRegistry();
        const entities = await this.haConnection.getEntityRegistry();

        // Get all devices managed by this integration
        const ourDevices = devices.filter(d => d.manufacturer === 'JS Automations');
        if (ourDevices.length === 0) return;

        // Create a set of all device_ids that are actually in use by entities
        const usedDeviceIds = new Set(entities.map(e => e.device_id).filter(id => id));

        for (const device of ourDevices) {
            if (!usedDeviceIds.has(device.id)) {
                this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Found orphaned device "${device.name_by_user || device.name}". Removing from HA...`, level: 'debug' });

                // SAFETY: Only prune if it's explicitly a script device identifier.
                // This protects the main "JS Automations" system device from accidental pruning.
                const identifiers = device.identifiers
                    .filter(idPair => idPair[1].includes('_script_'))
                    .map(idPair => idPair[1]);

                if (identifiers.length > 0) {
                    // In MQTT Discovery, devices are automatically removed when all associated 
                    // entities are purged.
                    this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Device ${device.name} will be auto-removed by HA after entity purge.`, level: 'debug' });
                }
            }
        }
    }

    /**
     * Checks if a script still has any associated entities.
     * If no entities remain, the device is eventually removed by Home Assistant.
     */
    async checkDeviceCleanup(scriptName) {
        this.workerManager.emit('log', { source: 'System', message: `[EntityManager] Checking if device for ${scriptName} should be removed`, level: 'debug' });

        // Find the actual filename and entry in the registry
        const fileName = Array.from(this.workerManager.scriptEntityMap.keys()).find(k => path.basename(k, path.extname(k)) === scriptName);
        const dynamicEntities = fileName ? this.workerManager.scriptEntityMap.get(fileName) : null;

        // Check if @expose entities still exist by parsing the file
        const fullPath = fileName ? path.join(this.workerManager.scriptsDir, fileName) : '';
        const meta = (fullPath && fs.existsSync(fullPath))
            ? ScriptHeaderParser.parse(fullPath)
            : { expose: null };

        if (!meta.expose && (!dynamicEntities || dynamicEntities.size === 0)) {
            this.workerManager.emit('log', { source: 'System', message: `[EntityManager] No entities left for ${scriptName}. Removing device from HA.`, level: 'debug' });
            // The device will vanish once the last entity config is overwritten with an empty payload.
        }
    }

}

module.exports = EntityManager;
