from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.button import ButtonEntity
from . import (
    JSAutomationsBaseEntity,
    async_setup_js_platform,
)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the JS Automations button platform."""
    connection = await async_setup_js_platform(
        hass, "button", JSAutomationsButton, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsButton(JSAutomationsBaseEntity, ButtonEntity):
    """Representation of a JS Automations Button."""

    def update_data(self, data):
        """Update Button specific data."""
        super().update_data(data)

    async def async_press(self) -> None:
        """Handle the button press."""
        self._fire_js_event("press")