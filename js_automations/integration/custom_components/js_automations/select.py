from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.select import SelectEntity
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
    """Set up the JS Automations select platform."""
    connection = await async_setup_js_platform(
        hass, "select", JSAutomationsSelect, async_add_entities
    )
    config_entry.async_on_unload(connection)


class JSAutomationsSelect(JSAutomationsBaseEntity, SelectEntity):
    """Representation of a JS Automations Select Entity."""

    def _restore_state(self, last_state):
        """Zustand für Select wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_current_option = last_state.state
        if "options" in last_state.attributes:
            self._attr_options = last_state.attributes["options"]

    def update_data(self, data):
        """Update Select spezifische Daten."""
        super().update_data(data)

        if CONF_STATE in data:
            self._attr_current_option = str(data[CONF_STATE]) if data[CONF_STATE] is not None else None

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "options" in attrs:
                self._attr_options = attrs["options"]
                # Bereinigen der Extra Attributes (verhindert Duplikate in der UI)
                self._attr_extra_state_attributes.pop("options", None)

        if self.hass:
            self.async_write_ha_state()

    async def async_select_option(self, option: str) -> None:
        """Change the selected option."""
        self._fire_js_event("select_option", {"value": option})