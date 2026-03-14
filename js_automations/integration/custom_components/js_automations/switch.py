from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.switch import SwitchEntity
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
    """Set up the JS Automations switch platform."""
    connection = await async_setup_js_platform(
        hass, "switch", JSAutomationsSwitch, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsSwitch(JSAutomationsBaseEntity, SwitchEntity):
    """Representation of a JS Automations Switch."""

    def _restore_state(self, last_state):
        """Restore state for Switch."""
        super()._restore_state(last_state)
        self._attr_is_on = last_state.state == "on"

    def update_data(self, data):
        """Update Switch specific data."""
        super().update_data(data)
        if CONF_STATE in data:
            val = data[CONF_STATE]
            self._attr_is_on = val == "on" or val is True

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the entity on."""
        self._attr_is_on = True
        self.async_write_ha_state()
        self._fire_js_event("turn_on")

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the entity off."""
        self._attr_is_on = False
        self.async_write_ha_state()
        self._fire_js_event("turn_off")