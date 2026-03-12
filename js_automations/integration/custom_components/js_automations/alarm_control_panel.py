from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.alarm_control_panel import (
    AlarmControlPanelEntity,
    AlarmControlPanelEntityFeature,
    CodeFormat,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE, async_format_device_info
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_alarm_control_panel(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsAlarmControlPanel(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_alarm_control_panel", async_add_alarm_control_panel)
    )

class JSAutomationsAlarmControlPanel(AlarmControlPanelEntity, RestoreEntity):
    """Representation of a JS Automations Alarm Control Panel."""

    def __init__(self, data):
        self.entity_id = data["entity_id"]
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._attr_code_format = None
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_alarm_state = last_state.state
            if "changed_by" in last_state.attributes:
                self._attr_changed_by = last_state.attributes["changed_by"]
            if "code_format" in last_state.attributes:
                cf = last_state.attributes["code_format"]
                if cf == "number": self._attr_code_format = CodeFormat.NUMBER
                elif cf == "text": self._attr_code_format = CodeFormat.TEXT

    def update_data(self, data):
        """Update entity state and attributes."""
        self._attr_name = data.get(CONF_NAME, self._attr_name)
        self._attr_icon = data.get(CONF_ICON, self._attr_icon)
        self._attr_available = data.get(CONF_AVAILABLE, self._attr_available)
        
        if CONF_STATE in data:
            self._attr_alarm_state = data[CONF_STATE]

        device_info = async_format_device_info(data)
        if device_info: self._attr_device_info = device_info
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() 
                if k not in ["code_format", "changed_by", "code_arm_required"]}
            
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

        if self.hass:
            self.async_write_ha_state()

    async def async_alarm_disarm(self, code: str | None = None) -> None:
        """Send disarm command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "alarm_disarm", "code": code})

    async def async_alarm_arm_home(self, code: str | None = None) -> None:
        """Send arm home command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "alarm_arm_home", "code": code})

    async def async_alarm_arm_away(self, code: str | None = None) -> None:
        """Send arm away command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "alarm_arm_away", "code": code})

    async def async_alarm_arm_night(self, code: str | None = None) -> None:
        """Send arm night command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "alarm_arm_night", "code": code})

    async def async_alarm_arm_vacation(self, code: str | None = None) -> None:
        """Send arm vacation command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "alarm_arm_vacation", "code": code})

    async def async_alarm_arm_custom_bypass(self, code: str | None = None) -> None:
        """Send arm custom bypass command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "alarm_arm_custom_bypass", "code": code})

    async def async_alarm_trigger(self, code: str | None = None) -> None:
        """Send alarm trigger command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "alarm_trigger", "code": code})