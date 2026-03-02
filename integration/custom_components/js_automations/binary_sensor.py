from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.binary_sensor import BinarySensorEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE, CONF_DEVICE_CLASS

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_binary_sensor(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsBinarySensor(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_binary_sensor", async_add_binary_sensor)
    )

class JSAutomationsBinarySensor(JSAutomationsBaseEntity, BinarySensorEntity):
    """Representation of a JS Automations Binary Sensor."""

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_on = last_state.state == "on"

    def _update_specific_state(self, data):
        """Update binary sensor specific state."""
        if CONF_STATE in data: 
            val = data[CONF_STATE]
            self._attr_is_on = val == "on" or val is True
        if CONF_DEVICE_CLASS in data: self._attr_device_class = data[CONF_DEVICE_CLASS]