from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.binary_sensor import BinarySensorEntity
from . import (
    JSAutomationsBaseEntity,
    async_setup_js_platform,
)
from homeassistant.const import CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the JS Automations binary sensor platform."""
    connection = await async_setup_js_platform(
        hass, "binary_sensor", JSAutomationsBinarySensor, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsBinarySensor(JSAutomationsBaseEntity, BinarySensorEntity):
    """Representation of a JS Automations Binary Sensor."""

    def _restore_state(self, last_state):
        """Restore state for Binary Sensor."""
        super()._restore_state(last_state)
        self._attr_is_on = last_state.state == "on"

    def update_data(self, data):
        """Update Binary Sensor specific data."""
        super().update_data(data)
        if CONF_STATE in data:
            val = data[CONF_STATE]
            self._attr_is_on = val == "on" or val is True

        if self.hass:
            self.async_write_ha_state()