from datetime import time
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.time import TimeEntity
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
    """Set up the JS Automations time platform."""
    connection = await async_setup_js_platform(
        hass, "time", JSAutomationsTime, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsTime(JSAutomationsBaseEntity, TimeEntity):
    """Representation of a JS Automations Time Entity."""

    def _restore_state(self, last_state):
        """Zustand für Time wiederherstellen."""
        super()._restore_state(last_state)
        if last_state.state not in ("unknown", "unavailable"):
            try:
                self._attr_native_value = time.fromisoformat(last_state.state)
            except ValueError:
                pass

    def update_data(self, data):
        """Update Time spezifische Daten."""
        super().update_data(data)
        
        if CONF_STATE in data:
            try:
                self._attr_native_value = time.fromisoformat(str(data[CONF_STATE])) if data[CONF_STATE] else None
            except ValueError:
                self._attr_native_value = None
        
        if self.hass:
            self.async_write_ha_state()

    async def async_set_value(self, value: time) -> None:
        """Update the time."""
        self._fire_js_event("set_value", {"value": value.isoformat()})