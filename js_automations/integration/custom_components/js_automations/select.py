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

        if last_state.state not in ("unknown", "unavailable"):
            # Prüfen, ob der wiederhergestellte Zustand valide ist (sofern Optionen bekannt)
            if not hasattr(self, "_attr_options") or not self._attr_options or last_state.state in self._attr_options:
                self._attr_current_option = last_state.state

    def update_data(self, data):
        """Update Select spezifische Daten."""
        super().update_data(data) # Verarbeitet Optionen, Name, Icon, etc.

        if CONF_STATE in data:
            new_state = str(data[CONF_STATE]) if data[CONF_STATE] is not None else None
            # Validierung: Nur setzen, wenn es eine erlaubte Option ist
            if not hasattr(self, "_attr_options") or not self._attr_options or new_state in self._attr_options:
                self._attr_current_option = new_state

    async def async_select_option(self, option: str) -> None:
        """Change the selected option."""
        self._attr_current_option = option
        self.async_write_ha_state()

        # Wir senden 'state', damit e.state im JS-Listener korrekt befüllt ist
        self._fire_js_event("select_option", {"state": option})