/**
 * Settings Schema Definition
 * 
 * This schema defines the structure of user settings.
 * It is used for:
 * 1. Frontend: UI generation (Schema-Driven UI)
 * 2. Backend: Validation of input values
 * 3. Defaults: Initialization of settings.json
 */

module.exports = [
    {
        id: 'general',
        label: 'settings.sections.general',
        icon: 'mdi:tune',
        items: [
            { 
                key: 'ui_language', 
                label: 'settings.general.ui_language', 
                description: 'settings.general.ui_language_desc',
                type: 'select', 
                options: [
                    { value: 'auto', label: 'settings.general.language_auto' },
                    { value: 'de', label: 'settings.general.language_option_de' },
                    { value: 'en', label: 'settings.general.language_option_en' }
                ], 
                default: 'auto' 
            },
            { 
                key: 'expert_mode', 
                label: 'settings.general.expert_mode', 
                description: 'settings.general.expert_mode_desc', 
                type: 'boolean', 
                default: true,
                active: false
            },
            { 
                key: 'confirm_delete', 
                label: 'settings.general.confirm_delete', 
                description: 'settings.general.confirm_delete_desc',
                type: 'boolean', 
                default: true 
            }
        ]
    },
    {
        id: 'editor',
        label: 'settings.sections.editor',
        icon: 'mdi:code-braces',
        items: [
            { 
                key: 'fontSize', 
                label: 'settings.editor.font_size', 
                type: 'number', 
                min: 10, 
                max: 30, 
                default: 14 
            },
            { 
                key: 'wordWrap', 
                label: 'settings.editor.word_wrap', 
                type: 'select', 
                options: [
                    { value: 'on', label: 'settings.editor.word_wrap_on' },
                    { value: 'off', label: 'settings.editor.word_wrap_off' }
                ], 
                default: 'on',
                hidden:true    
            },
            { 
                key: 'minimap', 
                label: 'settings.editor.minimap', 
                type: 'boolean', 
                default: true 
            },
            { 
                key: 'showToolbar', 
                label: 'settings.editor.show_toolbar', 
                type: 'boolean', 
                default: true,
                active: false // Temporarily disabled.
            }
        ]
    },
    {
        id: 'statusbar',
        label: 'settings.sections.statusbar',
        icon: 'mdi:dock-bottom',
        items: [
            {
                key: 'show_statusbar',
                label: 'settings.statusbar.show_statusbar',
                type: 'boolean',
                default: true,
                description: 'settings.statusbar.show_statusbar_desc'
            },
            // Slot 1
            { 
                key: 'slot1', 
                label: 'settings.statusbar.slot1', 
                type: 'select', 
                options: [
                    { value: 'none', label: 'settings.statusbar.none' }, 
                    { value: 'cpu', label: 'settings.statusbar.cpu_usage' }, 
                    { value: 'ram', label: 'settings.statusbar.ram_usage' }, 
                    { value: 'custom', label: 'settings.statusbar.custom_entity' }
                ], 
                default: 'cpu' 
            },
            { 
                key: 'customEntitySlot1', 
                label: 'settings.statusbar.custom_entity', 
                type: 'entity-picker', 
                condition: { key: 'slot1', value: 'custom' }, 
                default: '' 
            },
            {
                key: 'show_sparkline_slot1',
                label: 'settings.statusbar.show_sparkline',
                type: 'boolean',
                default: true,
                indent: true,
                description: 'settings.statusbar.show_sparkline_desc'
            },
            
            // Slot 2
            { 
                key: 'slot2', 
                label: 'settings.statusbar.slot2', 
                type: 'select', 
                options: [
                    { value: 'none', label: 'settings.statusbar.none' }, 
                    { value: 'cpu', label: 'settings.statusbar.cpu_usage' }, 
                    { value: 'ram', label: 'settings.statusbar.ram_usage' }, 
                    { value: 'custom', label: 'settings.statusbar.custom_entity' }
                ], 
                default: 'ram' 
            },
            { 
                key: 'customEntitySlot2', 
                label: 'settings.statusbar.custom_entity', 
                type: 'entity-picker', 
                condition: { key: 'slot2', value: 'custom' }, 
                default: '' 
            },
            {
                key: 'show_sparkline_slot2',
                label: 'settings.statusbar.show_sparkline',
                type: 'boolean',
                default: true,
                indent: true,
                description: 'settings.statusbar.show_sparkline_desc'
            },

            // Slot 3
            { 
                key: 'slot3', 
                label: 'settings.statusbar.slot3', 
                type: 'select', 
                options: [
                    { value: 'none', label: 'settings.statusbar.none' }, 
                    { value: 'cpu', label: 'settings.statusbar.cpu_usage' }, 
                    { value: 'ram', label: 'settings.statusbar.ram_usage' }, 
                    { value: 'custom', label: 'settings.statusbar.custom_entity' }
                ], 
                default: 'none' 
            },
            { 
                key: 'customEntitySlot3', 
                label: 'settings.statusbar.custom_entity', 
                type: 'entity-picker', 
                condition: { key: 'slot3', value: 'custom' }, 
                default: '' 
            },
            {
                key: 'show_sparkline_slot3',
                label: 'settings.statusbar.show_sparkline',
                type: 'boolean',
                default: true,
                indent: true,
                description: 'settings.statusbar.show_sparkline_desc'
            },
            {
                key: 'hide_sparkline_on_dense',
                label: 'settings.statusbar.hide_sparkline_on_dense',
                type: 'boolean',
                default: true,
                description: 'settings.statusbar.hide_sparkline_on_dense_desc'
            }
        ]
    },
    {
        id: 'mqtt',
        label: 'settings.sections.mqtt',
        icon: 'mdi:lan-connect',
        items: [
            {
                key: 'enabled',
                label: 'settings.mqtt.enabled',
                type: 'boolean',
                default: false
            },
            {
                key: 'host',
                label: 'settings.mqtt.host',
                type: 'text',
                default: 'core-mosquitto',
                condition: { key: 'enabled', value: true }
            },
            {
                key: 'port',
                label: 'settings.mqtt.port',
                type: 'number',
                default: 1883,
                condition: { key: 'enabled', value: true }
            },
            {
                key: 'username',
                label: 'settings.mqtt.username',
                type: 'text',
                default: '',
                condition: { key: 'enabled', value: true }
            },
            {
                key: 'password',
                label: 'settings.mqtt.password',
                type: 'text',
                mode: 'password',
                default: '',
                condition: { key: 'enabled', value: true }
            },
            {
                key: 'test',
                label: null,
                type: 'mqtt-test',
                condition: { key: 'enabled', value: true }
            },
            {
                key: 'autodetect',
                label: null,
                type: 'mqtt-autodetect',
                condition: { key: 'enabled', value: true }
            },
        ]
    },
    {
        id: 'system',
        label: 'settings.sections.system',
        icon: 'mdi:server',
        items: [
            { 
                key: 'log_level', 
                label: 'settings.system.log_level', 
                type: 'select',
                options: [
                    { value: 'debug', label: 'log_level_debug' },
                    { value: 'info', label: 'log_level_info' },
                    { value: 'warn', label: 'log_level_warn' },
                    { value: 'error', label: 'log_level_error' }
                ],
                default: 'info' 
            },
            { 
                key: 'default_throttle', 
                label: 'settings.system.default_throttle', 
                description: 'settings.system.default_throttle_desc', 
                type: 'number', 
                min: 0, 
                max: 5000, 
                default: 0,
                unit: 'ms'
            },
            { 
                key: 'backup', 
                label: 'settings.system.backup', 
                type: 'button', 
                buttonLabel: 'settings.system.backup_btn', 
                actionUrl: 'api/system/backup' ,
                hidden: false
            }
        ]
    },
    {
        id: 'danger',
        label: 'settings.sections.danger',
        icon: 'mdi:alert',
        items: [
            { 
                key: 'node_memory', 
                label: 'settings.danger.node_memory_per_script', 
                description: 'settings.danger.node_memory_desc', 
                type: 'number', 
                min: 256, 
                max: 4096, 
                default: 256
            },
            { 
                key: 'restart_count', 
                label: 'settings.danger.restart_count', 
                description: 'settings.danger.restart_count_desc', 
                type: 'number', 
                min: 2, 
                max: 20, 
                default: 5 
            },
            { 
                key: 'restart_time', 
                label: 'settings.danger.restart_time', 
                description: 'settings.danger.restart_time_desc', 
                type: 'number', 
                min: 10, 
                max: 300, 
                default: 60,
                unit: 's'
            }
        ]
    }
];
