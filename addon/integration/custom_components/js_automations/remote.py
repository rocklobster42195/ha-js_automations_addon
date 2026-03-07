from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
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
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_remote(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsRemote(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_remote", async_add_remote)
    )

class JSAutomationsRemote(RemoteEntity, RestoreEntity):
    """Representation of a JS Automations Remote."""

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._attr_is_on = False
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_on = last_state.state == "on"
            if "current_activity" in last_state.attributes:
                self._attr_current_activity = last_state.attributes["current_activity"]
            if "activity_list" in last_state.attributes:
                self._attr_activity_list = last_state.attributes["activity_list"]

    def update_data(self, data):
        """Update entity state and attributes."""
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data: self._attr_available = data[CONF_AVAILABLE]
        
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

        if CONF_DEVICE_INFO in data:
            info = data[CONF_DEVICE_INFO].copy()
            if "identifiers" in info and isinstance(info["identifiers"], list):
                ids = set()
                for x in info["identifiers"]:
                    if isinstance(x, list):
                        ids.add(tuple(x))
                    else:
                        ids.add((DOMAIN, str(x)))
                info["identifiers"] = ids
            self._attr_device_info = info
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() 
                if k not in ["current_activity", "activity_list"]}
            
            if "current_activity" in attrs: self._attr_current_activity = attrs["current_activity"]
            if "activity_list" in attrs: self._attr_activity_list = attrs["activity_list"]
            
            # Determine supported features
            features = 0
            if "activity_list" in attrs:
                features |= RemoteEntityFeature.ACTIVITY
            
            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the remote on."""
        data = {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_on"}
        if ATTR_ACTIVITY in kwargs: data["activity"] = kwargs[ATTR_ACTIVITY]
        self.hass.bus.async_fire(f"{DOMAIN}_event", data)

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the remote off."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_off"})

    async def async_send_command(self, command: list[str], **kwargs) -> None:
        """Send a command to a device."""
        data = {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "send_command", "command": command}
        if ATTR_DEVICE in kwargs: data["device"] = kwargs[ATTR_DEVICE]
        if ATTR_NUM_REPEATS in kwargs: data["num_repeats"] = kwargs[ATTR_NUM_REPEATS]
        if ATTR_DELAY_SECS in kwargs: data["delay_secs"] = kwargs[ATTR_DELAY_SECS]
        if ATTR_HOLD_SECS in kwargs: data["hold_secs"] = kwargs[ATTR_HOLD_SECS]
        self.hass.bus.async_fire(f"{DOMAIN}_event", data)