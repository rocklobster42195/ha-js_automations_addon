from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.number import NumberEntity
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
    """Set up the JS Automations number platform."""
    connection = await async_setup_js_platform(
        hass, "number", JSAutomationsNumber, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsNumber(JSAutomationsBaseEntity, NumberEntity):
    """Representation of a JS Automations Number."""

    def _restore_state(self, last_state):
        """Zustand für Number wiederherstellen."""
        super()._restore_state(last_state)
        attrs = last_state.attributes
        if last_state.state not in ("unknown", "unavailable"):
            try:
                self._attr_native_value = float(last_state.state)
            except ValueError:
                pass
        
        if "min" in attrs: self._attr_native_min_value = float(attrs["min"])
        if "max" in attrs: self._attr_native_max_value = float(attrs["max"])
        if "step" in attrs: self._attr_native_step = float(attrs["step"])
        if "mode" in attrs: self._attr_mode = attrs["mode"]

    def update_data(self, data):
        """Update Number spezifische Daten."""
        super().update_data(data)

        if CONF_STATE in data:
            try:
                self._attr_native_value = float(data[CONF_STATE]) if data[CONF_STATE] is not None else None
            except (ValueError, TypeError):
                self._attr_native_value = None

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "min" in attrs: self._attr_native_min_value = float(attrs["min"])
            if "max" in attrs: self._attr_native_max_value = float(attrs["max"])
            if "step" in attrs: self._attr_native_step = float(attrs["step"])
            if "mode" in attrs: self._attr_mode = attrs["mode"]

            # Bereinigen der Extra Attributes
            for key in ["min", "max", "step", "mode"]:
                self._attr_extra_state_attributes.pop(key, None)

        if self.hass:
            self.async_write_ha_state()

    async def async_set_native_value(self, value: float) -> None:
        """Set new value."""
        self._fire_js_event("set_value", {"value": value})