from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.alarm_control_panel import (
    AlarmControlPanelEntity,
    AlarmControlPanelEntityFeature,
    CodeFormat,
)
from . import (
    JSAutomationsBaseEntity,
    async_setup_js_platform,
    CONF_ATTRIBUTES,
)
from homeassistant.const import CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the JS Automations alarm control panel platform."""
    connection = await async_setup_js_platform(
        hass, "alarm_control_panel", JSAutomationsAlarmControlPanel, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsAlarmControlPanel(JSAutomationsBaseEntity, AlarmControlPanelEntity):
    """Representation of a JS Automations Alarm Control Panel."""

    def _restore_state(self, last_state):
        """Zustand für Alarm Control Panel wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_state = last_state.state
        attrs = last_state.attributes
        self._attr_changed_by = attrs.get("changed_by")
        cf = attrs.get("code_format")
        if cf == "number":
            self._attr_code_format = CodeFormat.NUMBER
        elif cf == "text":
            self._attr_code_format = CodeFormat.TEXT

    def update_data(self, data):
        """Update Alarm Control Panel spezifische Daten."""
        super().update_data(data)
        
        if CONF_STATE in data:
            self._attr_state = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "code_format" in attrs:
                val = attrs["code_format"]
                if val == "number": self._attr_code_format = CodeFormat.NUMBER
                elif val == "text": self._attr_code_format = CodeFormat.TEXT
                else: self._attr_code_format = None
            
            if "changed_by" in attrs: self._attr_changed_by = attrs["changed_by"]
            if "code_arm_required" in attrs: self._attr_code_arm_required = bool(attrs["code_arm_required"])
            
            # Determine supported features
            features = (
                AlarmControlPanelEntityFeature.ARM_HOME
                | AlarmControlPanelEntityFeature.ARM_AWAY
                | AlarmControlPanelEntityFeature.ARM_NIGHT
                | AlarmControlPanelEntityFeature.ARM_VACATION
                | AlarmControlPanelEntityFeature.ARM_CUSTOM_BYPASS
                | AlarmControlPanelEntityFeature.TRIGGER
            )
            
            self._attr_supported_features = features

            # Cleanup der Extra Attributes
            managed_keys = ["code_format", "changed_by", "code_arm_required"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

        if self.hass:
            self.async_write_ha_state()

    async def async_alarm_disarm(self, code: str | None = None) -> None:
        """Send disarm command."""
        self._attr_state = "disarmed"
        self.async_write_ha_state()
        self._fire_js_event("alarm_disarm", {"code": code})

    async def async_alarm_arm_home(self, code: str | None = None) -> None:
        """Send arm home command."""
        self._attr_state = "armed_home"
        self.async_write_ha_state()
        self._fire_js_event("alarm_arm_home", {"code": code})

    async def async_alarm_arm_away(self, code: str | None = None) -> None:
        """Send arm away command."""
        self._attr_state = "armed_away"
        self.async_write_ha_state()
        self._fire_js_event("alarm_arm_away", {"code": code})

    async def async_alarm_arm_night(self, code: str | None = None) -> None:
        """Send arm night command."""
        self._attr_state = "armed_night"
        self.async_write_ha_state()
        self._fire_js_event("alarm_arm_night", {"code": code})

    async def async_alarm_arm_vacation(self, code: str | None = None) -> None:
        """Send arm vacation command."""
        self._attr_state = "armed_vacation"
        self.async_write_ha_state()
        self._fire_js_event("alarm_arm_vacation", {"code": code})

    async def async_alarm_arm_custom_bypass(self, code: str | None = None) -> None:
        """Send arm custom bypass command."""
        self._attr_state = "arming"
        self.async_write_ha_state()
        self._fire_js_event("alarm_arm_custom_bypass", {"code": code})

    async def async_alarm_trigger(self, code: str | None = None) -> None:
        """Send alarm trigger command."""
        self._attr_state = "triggered"
        self.async_write_ha_state()
        self._fire_js_event("alarm_trigger", {"code": code})