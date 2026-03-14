from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.sensor import SensorEntity
from . import (
    JSAutomationsBaseEntity,
    async_setup_js_platform,
)
from homeassistant.const import (
    CONF_STATE,
    CONF_UNIT_OF_MEASUREMENT,
    CONF_DEVICE_CLASS,
)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the JS Automations sensor platform."""
    connection = await async_setup_js_platform(
        hass, "sensor", JSAutomationsSensor, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsSensor(JSAutomationsBaseEntity, SensorEntity):
    """Representation of a JS Automations Sensor."""

    def _restore_state(self, last_state):
        """Restore state for Sensor."""
        super()._restore_state(last_state)
        state = last_state.state
        if state not in ("unknown", "unavailable"):
            # Numerischer Restore Logic für saubere Statistiken
            if self.native_unit_of_measurement or self.state_class:
                try:
                    self._attr_native_value = float(state)
                except ValueError:
                    self._attr_native_value = state
            else:
                self._attr_native_value = state

    def update_data(self, data):
        """Update Sensor specific data."""
        super().update_data(data)

        if CONF_STATE in data:
            val = data[CONF_STATE]
            # Explizites Casting bei numerischen Sensoren (Meilenstein 11 Standard)
            if val is not None and (self.native_unit_of_measurement or self.state_class):
                try:
                    self._attr_native_value = float(val)
                except (ValueError, TypeError):
                    self._attr_native_value = val
            else:
                self._attr_native_value = val

        if self.hass:
            self.async_write_ha_state()