/**
 * Settings Schema Definition
 *
 * This schema defines the structure of user settings.
 * It is used for:
 * 1. Frontend: UI generation (Schema-Driven UI)
 * 2. Backend: Validation of input values
 * 3. Defaults: Initialization of settings.json
 */

interface SettingOption {
  value: string;
  label: string;
}

interface SettingCondition {
  key: string;
  value: unknown;
}

interface SettingItem {
  key: string;
  label: string | null;
  description?: string;
  type: string;
  options?: SettingOption[];
  default?: unknown;
  min?: number;
  max?: number;
  unit?: string;
  hidden?: boolean;
  active?: boolean;
  indent?: boolean;
  condition?: SettingCondition;
  text?: string;
  buttonLabel?: string;
  actionUrl?: string;
  mode?: string;
}

interface SettingSection {
  id: string;
  label: string;
  icon: string;
  items: SettingItem[];
}

const settingsSchema: SettingSection[] = [
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
          { value: 'en', label: 'settings.general.language_option_en' },
        ],
        default: 'auto',
      },
      {
        key: 'expert_mode',
        label: 'settings.general.expert_mode',
        description: 'settings.general.expert_mode_desc',
        type: 'boolean',
        default: false,
      },
      {
        key: 'confirm_delete',
        label: 'settings.general.confirm_delete',
        description: 'settings.general.confirm_delete_desc',
        type: 'boolean',
        default: true,
      },
      {
        key: 'hide_mobile_toggle_in_desktop',
        label: 'settings.general.hide_mobile_toggle_in_desktop',
        description: 'settings.general.hide_mobile_toggle_in_desktop_desc',
        type: 'boolean',
        default: false,
      },
    ],
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
        default: 14,
      },
      {
        key: 'wordWrap',
        label: 'settings.editor.word_wrap',
        type: 'select',
        options: [
          { value: 'on', label: 'settings.editor.word_wrap_on' },
          { value: 'off', label: 'settings.editor.word_wrap_off' },
        ],
        default: 'on',
        hidden: true,
      },
      {
        key: 'minimap',
        label: 'settings.editor.minimap',
        type: 'boolean',
        default: true,
      },
      {
        key: 'showToolbar',
        label: 'settings.editor.show_toolbar',
        type: 'boolean',
        default: true,
        active: false, // Temporarily disabled.
      },
    ],
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
        description: 'settings.statusbar.show_statusbar_desc',
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
          { value: 'custom', label: 'settings.statusbar.custom_entity' },
        ],
        default: 'cpu',
      },
      {
        key: 'customEntitySlot1',
        label: 'settings.statusbar.custom_entity',
        type: 'entity-picker',
        condition: { key: 'slot1', value: 'custom' },
        default: '',
      },
      {
        key: 'show_sparkline_slot1',
        label: 'settings.statusbar.show_sparkline',
        type: 'boolean',
        default: true,
        indent: true,
        description: 'settings.statusbar.show_sparkline_desc',
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
          { value: 'custom', label: 'settings.statusbar.custom_entity' },
        ],
        default: 'ram',
      },
      {
        key: 'customEntitySlot2',
        label: 'settings.statusbar.custom_entity',
        type: 'entity-picker',
        condition: { key: 'slot2', value: 'custom' },
        default: '',
      },
      {
        key: 'show_sparkline_slot2',
        label: 'settings.statusbar.show_sparkline',
        type: 'boolean',
        default: true,
        indent: true,
        description: 'settings.statusbar.show_sparkline_desc',
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
          { value: 'custom', label: 'settings.statusbar.custom_entity' },
        ],
        default: 'none',
      },
      {
        key: 'customEntitySlot3',
        label: 'settings.statusbar.custom_entity',
        type: 'entity-picker',
        condition: { key: 'slot3', value: 'custom' },
        default: '',
      },
      {
        key: 'show_sparkline_slot3',
        label: 'settings.statusbar.show_sparkline',
        type: 'boolean',
        default: true,
        indent: true,
        description: 'settings.statusbar.show_sparkline_desc',
      },
      {
        key: 'hide_sparkline_on_dense',
        label: 'settings.statusbar.hide_sparkline_on_dense',
        type: 'boolean',
        default: true,
        description: 'settings.statusbar.hide_sparkline_on_dense_desc',
      },

      // Header Action Buttons
      {
        key: 'header_action_1',
        label: 'settings.statusbar.header_action_1',
        description: 'settings.statusbar.header_action_desc',
        type: 'entity-picker',
        default: '',
      },
      {
        key: 'header_action_2',
        label: 'settings.statusbar.header_action_2',
        type: 'entity-picker',
        default: '',
      },
      {
        key: 'header_action_3',
        label: 'settings.statusbar.header_action_3',
        type: 'entity-picker',
        default: '',
      },
    ],
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
        default: false,
      },
      {
        key: 'mosquitto_hint',
        label: null,
        type: 'info',
        text: 'settings.mqtt.mosquitto_hint',
        condition: { key: 'enabled', value: true },
      },
      {
        key: 'autodetect',
        label: null,
        type: 'mqtt-autodetect',
        condition: { key: 'enabled', value: true },
      },
      {
        key: 'host',
        label: 'settings.mqtt.host',
        type: 'text',
        default: 'core-mosquitto',
        description: 'settings.mqtt.host_desc',
        condition: { key: 'enabled', value: true },
      },
      {
        key: 'port',
        label: 'settings.mqtt.port',
        type: 'number',
        default: 1883,
        condition: { key: 'enabled', value: true },
      },
      {
        key: 'username',
        label: 'settings.mqtt.username',
        type: 'text',
        default: '',
        condition: { key: 'enabled', value: true },
      },
      {
        key: 'password',
        label: 'settings.mqtt.password',
        type: 'text',
        mode: 'password',
        default: '',
        condition: { key: 'enabled', value: true },
      },
      {
        key: 'test',
        label: null,
        type: 'mqtt-test',
        condition: { key: 'enabled', value: true },
      },
    ],
  },
  {
    id: 'webhook',
    label: 'settings.sections.webhook',
    icon: 'mdi:webhook',
    items: [
      {
        key: 'external_url',
        label: 'settings.webhook.external_url',
        description: 'settings.webhook.external_url_desc',
        type: 'text',
        default: '',
      },
      {
        key: 'trust_proxy',
        label: 'settings.webhook.trust_proxy',
        description: 'settings.webhook.trust_proxy_desc',
        type: 'boolean',
        default: false,
      },
    ],
  },
  {
    id: 'backup',
    label: 'settings.sections.backup',
    icon: 'mdi:backup-restore',
    items: [
      {
        key: 'schedule_enabled',
        label: 'settings.backup.schedule_enabled',
        description: 'settings.backup.schedule_enabled_desc',
        type: 'boolean',
        default: false,
      },
      {
        key: 'schedule_frequency',
        label: 'settings.backup.schedule_frequency',
        type: 'select',
        options: [
          { value: 'daily', label: 'settings.backup.schedule_frequency_daily' },
          { value: 'weekly', label: 'settings.backup.schedule_frequency_weekly' },
        ],
        default: 'daily',
        condition: { key: 'schedule_enabled', value: true },
      },
      {
        key: 'schedule_weekday',
        label: 'settings.backup.schedule_weekday',
        type: 'select',
        options: [
          { value: 'mon', label: 'settings.backup.weekday_mon' },
          { value: 'tue', label: 'settings.backup.weekday_tue' },
          { value: 'wed', label: 'settings.backup.weekday_wed' },
          { value: 'thu', label: 'settings.backup.weekday_thu' },
          { value: 'fri', label: 'settings.backup.weekday_fri' },
          { value: 'sat', label: 'settings.backup.weekday_sat' },
          { value: 'sun', label: 'settings.backup.weekday_sun' },
        ],
        default: 'sun',
        condition: { key: 'schedule_frequency', value: 'weekly' },
        indent: true,
      },
      {
        key: 'schedule_time',
        label: 'settings.backup.schedule_time',
        description: 'settings.backup.schedule_time_desc',
        type: 'text',
        default: '03:00',
        condition: { key: 'schedule_enabled', value: true },
      },
      {
        key: 'retention_count',
        label: 'settings.backup.retention_count',
        description: 'settings.backup.retention_count_desc',
        type: 'number',
        min: 1,
        max: 60,
        default: 14,
      },
      {
        key: 'run_now',
        label: 'settings.backup.run_now',
        type: 'backup-run-now',
      },
      {
        key: 'webdav_enabled',
        label: 'settings.backup.webdav_enabled',
        description: 'settings.backup.webdav_enabled_desc',
        type: 'boolean',
        default: false,
      },
      {
        key: 'webdav_url',
        label: 'settings.backup.webdav_url',
        type: 'text',
        default: '',
        condition: { key: 'webdav_enabled', value: true },
      },
      {
        key: 'webdav_username',
        label: 'settings.backup.webdav_username',
        type: 'text',
        default: '',
        condition: { key: 'webdav_enabled', value: true },
      },
      {
        key: 'webdav_password',
        label: 'settings.backup.webdav_password',
        type: 'text',
        mode: 'password',
        default: '',
        condition: { key: 'webdav_enabled', value: true },
      },
      {
        key: 'webdav_test',
        label: null,
        type: 'webdav-test',
        condition: { key: 'webdav_enabled', value: true },
      },
    ],
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
          { value: 'error', label: 'log_level_error' },
        ],
        default: 'info',
      },
      {
        key: 'default_throttle',
        label: 'settings.system.default_throttle',
        description: 'settings.system.default_throttle_desc',
        type: 'number',
        min: 0,
        max: 5000,
        default: 0,
        unit: 'ms',
      },
      {
        key: 'backup',
        label: 'settings.system.backup',
        type: 'button',
        buttonLabel: 'settings.system.backup_btn',
        actionUrl: 'api/system/backup',
        hidden: false,
      },
    ],
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
        default: 256,
      },
      {
        key: 'restart_count',
        label: 'settings.danger.restart_count',
        description: 'settings.danger.restart_count_desc',
        type: 'number',
        min: 2,
        max: 20,
        default: 5,
      },
      {
        key: 'restart_time',
        label: 'settings.danger.restart_time',
        description: 'settings.danger.restart_time_desc',
        type: 'number',
        min: 10,
        max: 300,
        default: 60,
        unit: 's',
      },
      {
        key: 'filesystem_enabled',
        label: 'settings.danger.filesystem_enabled',
        description: 'settings.danger.filesystem_enabled_desc',
        type: 'toggle',
        default: false,
      },
      {
        key: 'quota_internal',
        label: 'settings.danger.quota_internal',
        description: 'settings.danger.quota_desc',
        type: 'number',
        min: 0,
        max: 10240,
        default: 0,
        unit: 'MB',
        indent: true,
        condition: { key: 'filesystem_enabled', value: true },
      },
      {
        key: 'quota_shared',
        label: 'settings.danger.quota_shared',
        description: 'settings.danger.quota_desc',
        type: 'number',
        min: 0,
        max: 10240,
        default: 0,
        unit: 'MB',
        indent: true,
        condition: { key: 'filesystem_enabled', value: true },
      },
      {
        key: 'quota_media',
        label: 'settings.danger.quota_media',
        description: 'settings.danger.quota_desc',
        type: 'number',
        min: 0,
        max: 10240,
        default: 0,
        unit: 'MB',
        indent: true,
        condition: { key: 'filesystem_enabled', value: true },
      },
      {
        key: 'capability_enforcement',
        label: 'settings.danger.capability_enforcement',
        description: 'settings.danger.capability_enforcement_desc',
        type: 'toggle',
        default: true,
      },
    ],
  },
];

export = settingsSchema;
