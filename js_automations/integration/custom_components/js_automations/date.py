from datetime import date
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.date import DateEntity
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
    """Set up the JS Automations date platform."""
    connection = await async_setup_js_platform(
        hass, "date", JSAutomationsDate, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsDate(JSAutomationsBaseEntity, DateEntity):
    """Representation of a JS Automations Date Entity."""

    def _restore_state(self, last_state):
        """Datum aus Restore laden."""
        super()._restore_state(last_state)
        if last_state.state not in ("unknown", "unavailable"):
            try:
                self._attr_native_value = date.fromisoformat(last_state.state)
            except ValueError:
                pass

    def update_data(self, data):
        """Update Date spezifische Daten."""
        super().update_data(data)
        if CONF_STATE in data:
            try:
                self._attr_native_value = date.fromisoformat(str(data[CONF_STATE])) if data[CONF_STATE] else None
            except ValueError:
                self._attr_native_value = None
        
        if self.hass:
            self.async_write_ha_state()

    async def async_set_value(self, value: date) -> None:
        self._fire_js_event("set_value", {"value": value.isoformat()})