from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.switch import SwitchEntity
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
    def async_add_switch(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsSwitch(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_switch", async_add_switch)
    )

class JSAutomationsSwitch(SwitchEntity, RestoreEntity):
    """Representation of a JS Automations Switch."""

    def __init__(self, data):
        self.entity_id = data["entity_id"]
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

    def update_data(self, data):
        """Update entity state and attributes."""
        self._attr_name = data.get(CONF_NAME, self._attr_name)
        self._attr_icon = data.get(CONF_ICON, self._attr_icon)
        self._attr_extra_state_attributes = data.get(CONF_ATTRIBUTES, self._attr_extra_state_attributes)
        self._attr_available = data.get(CONF_AVAILABLE, self._attr_available)

        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

        device_info = async_format_device_info(data)
        if device_info:
            self._attr_device_info = device_info
        
        self._attr_assumed_state = False
        
        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs):
        """Turn the entity on."""
        self.hass.bus.async_fire(
            f"{DOMAIN}_event",
            {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_on"}
        )

    async def async_turn_off(self, **kwargs):
        """Turn the entity off."""
        self.hass.bus.async_fire(
            f"{DOMAIN}_event",
            {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_off"}
        )