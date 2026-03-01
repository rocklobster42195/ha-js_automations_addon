/**
 * Settings Schema Definition
 * 
 * Dieses Schema definiert die Struktur der Benutzereinstellungen.
 * Es wird genutzt für:
 * 1. Frontend: Generierung der UI (Schema-Driven UI)
 * 2. Backend: Validierung der Eingabewerte
 * 3. Defaults: Initialisierung der settings.json
 */

module.exports = [
    {
        id: 'general',
        label: 'settings.categories.general',
        icon: 'mdi:tune',
        items: [
            { 
                key: 'ui_language', 
                label: 'settings.general.language', 
                type: 'select', 
                options: [
                    { value: 'de', label: 'Deutsch' }, 
                    { value: 'en', label: 'English' }
                ], 
                default: 'de' 
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
        label: 'settings.categories.editor',
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
                    { value: 'on', label: 'An' }, 
                    { value: 'off', label: 'Aus' }
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
                active: false // Vorübergehend deaktiviert
            }
        ]
    },
    {
        id: 'statusbar',
        label: 'settings.categories.statusbar',
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
            // Slot 1
            { 
                key: 'slot1', 
                label: 'settings.statusbar.slot1', 
                type: 'select', 
                options: [
                    { value: 'none', label: 'Leer' }, 
                    { value: 'cpu', label: 'CPU Usage' }, 
                    { value: 'ram', label: 'RAM Usage' }, 
                    { value: 'custom', label: 'Custom Entity' }
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
                    { value: 'none', label: 'Leer' }, 
                    { value: 'cpu', label: 'CPU Usage' }, 
                    { value: 'ram', label: 'RAM Usage' }, 
                    { value: 'custom', label: 'Custom Entity' }
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
                    { value: 'none', label: 'Leer' }, 
                    { value: 'cpu', label: 'CPU Usage' }, 
                    { value: 'ram', label: 'RAM Usage' }, 
                    { value: 'custom', label: 'Custom Entity' }
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
        id: 'system',
        label: 'settings.categories.system',
        icon: 'mdi:server',
        items: [
            { 
                key: 'ha_integration_status', 
                label: 'Home Assistant Integration', 
                type: 'integration-manager' 
            },
            { 
                key: 'log_level', 
                label: 'settings.system.log_level', 
                type: 'select', 
                options: ['debug','info', 'warn', 'error'], 
                default: 'info' 
            },
            { 
                key: 'backup', 
                label: 'settings.system.backup', 
                type: 'button', 
                buttonLabel: 'settings.system.backup_btn', 
                actionUrl: 'api/system/backup' ,
                hidden: false
            },
            { 
                key: 'node_memory', 
                label: 'settings.danger.node_memory', 
                description: 'settings.danger.node_memory_desc', 
                type: 'number', 
                min: 256, 
                max: 4096, 
                default: 512,
                hidden: true // Nur anzeigen, wenn die Funktion implementiert ist und ein Memory Limit gesetzt werden kann
            }
        ]
    }
];
