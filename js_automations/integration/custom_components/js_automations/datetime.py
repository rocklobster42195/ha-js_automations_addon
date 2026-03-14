from datetime import datetime
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.datetime import DateTimeEntity
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
    """Set up the JS Automations datetime platform."""
    connection = await async_setup_js_platform(
        hass, "datetime", JSAutomationsDateTime, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsDateTime(JSAutomationsBaseEntity, DateTimeEntity):
    """Representation of a JS Automations DateTime Entity."""

    def _restore_state(self, last_state):
        """Zustand für DateTime wiederherstellen."""
        super()._restore_state(last_state)
        if last_state.state not in ("unknown", "unavailable"):
            try:
                self._attr_native_value = datetime.fromisoformat(last_state.state)
            except ValueError:
                pass

    def update_data(self, data):
        """Update DateTime spezifische Daten."""
        super().update_data(data)
        
        if CONF_STATE in data:
            try:
                self._attr_native_value = datetime.fromisoformat(str(data[CONF_STATE])) if data[CONF_STATE] else None
            except ValueError:
                self._attr_native_value = None
        
        if self.hass:
            self.async_write_ha_state()

    async def async_set_value(self, value: datetime) -> None:
        """Update the datetime."""
        self._fire_js_event("set_value", {"value": value.isoformat()})