from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.remote import (
    RemoteEntity,
    RemoteEntityFeature,
    ATTR_ACTIVITY,
    ATTR_DEVICE,
    ATTR_DELAY_SECS,
    ATTR_HOLD_SECS,
    ATTR_NUM_REPEATS,
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
    """Set up the JS Automations remote platform."""
    connection = await async_setup_js_platform(
        hass, "remote", JSAutomationsRemote, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsRemote(JSAutomationsBaseEntity, RemoteEntity):
    """Representation of a JS Automations Remote."""

    def _restore_state(self, last_state):
        """Zustand für Remote wiederherstellen."""
        super()._restore_state(last_state)
        
        attrs = last_state.attributes
        self._attr_activity_list = attrs.get("activity_list")
        self._attr_is_on = last_state.state == "on"
        
        if "current_activity" in attrs:
            activity = attrs["current_activity"]
            if not self._attr_activity_list or activity in self._attr_activity_list:
                self._attr_current_activity = activity

    def update_data(self, data):
        """Update Remote spezifische Daten."""
        super().update_data(data)
        
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            
            # Update activity_list first for validation
            if "activity_list" in attrs: self._attr_activity_list = attrs["activity_list"]
            
            if "current_activity" in attrs:
                activity = attrs["current_activity"]
                if not self._attr_activity_list or activity in self._attr_activity_list:
                    self._attr_current_activity = activity
            
            # Determine supported features
            features = 0
            if "activity_list" in attrs:
                features |= RemoteEntityFeature.ACTIVITY
            
            self._attr_supported_features = features

            # Cleanup der Extra Attributes
            managed_keys = ["current_activity", "activity_list"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the remote on."""
        self._attr_is_on = True
        if ATTR_ACTIVITY in kwargs:
            self._attr_current_activity = kwargs[ATTR_ACTIVITY]
        self.async_write_ha_state()

        data = {}
        if ATTR_ACTIVITY in kwargs: data["activity"] = kwargs[ATTR_ACTIVITY]
        self._fire_js_event("turn_on", data)

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the remote off."""
        self._attr_is_on = False
        self.async_write_ha_state()
        self._fire_js_event("turn_off")

    async def async_send_command(self, command: list[str], **kwargs) -> None:
        """Send a command to a device."""
        data = {"command": command}
        if ATTR_DEVICE in kwargs: data["device"] = kwargs[ATTR_DEVICE]
        if ATTR_NUM_REPEATS in kwargs: data["num_repeats"] = kwargs[ATTR_NUM_REPEATS]
        if ATTR_DELAY_SECS in kwargs: data["delay_secs"] = kwargs[ATTR_DELAY_SECS]
        if ATTR_HOLD_SECS in kwargs: data["hold_secs"] = kwargs[ATTR_HOLD_SECS]
        self._fire_js_event("send_command", data)