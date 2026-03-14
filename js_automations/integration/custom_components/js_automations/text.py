from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.text import TextEntity
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
    """Set up the JS Automations text platform."""
    connection = await async_setup_js_platform(
        hass, "text", JSAutomationsText, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsText(JSAutomationsBaseEntity, TextEntity):
    """Representation of a JS Automations Text Entity."""

    def _restore_state(self, last_state):
        """Zustand für Text wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_native_value = last_state.state

    def update_data(self, data):
        """Update Text spezifische Daten."""
        super().update_data(data)

        if CONF_STATE in data:
            self._attr_native_value = str(data[CONF_STATE]) if data[CONF_STATE] is not None else None
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "min" in attrs: self._attr_native_min = int(attrs["min"])
            if "max" in attrs: self._attr_native_max = int(attrs["max"])
            if "pattern" in attrs: self._attr_pattern = attrs["pattern"]
            if "mode" in attrs: self._attr_mode = attrs["mode"]

            # Bereinigen der Extra Attributes (verhindert Duplikate in der UI)
            for key in ["min", "max", "pattern", "mode"]:
                self._attr_extra_state_attributes.pop(key, None)

        if self.hass:
            self.async_write_ha_state()

    async def async_set_value(self, value: str) -> None:
        """Set new value."""
        self._fire_js_event("set_value", {"value": value})