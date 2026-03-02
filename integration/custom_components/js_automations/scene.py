from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.scene import Scene
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID

import logging

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the scene platform."""

    @callback
    def async_add_scene(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsScene(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_scene", async_add_scene)
    )

class JSAutomationsScene(JSAutomationsBaseEntity, Scene):
    """Representation of a JS Automations Scene."""

    def __init__(self, data):
        """Initialize the scene entity."""
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        # Scenes typically don't have a persistent state to restore,
        # their state is implicitly 'activated' when triggered.
        # We can optionally restore attributes if any were defined.
        last_state = await self.async_get_last_state()
        if last_state and last_state.attributes:
            self._attr_extra_state_attributes = last_state.attributes

    def _update_specific_state(self, data):
        """Update scene specific state."""
        # Scenes don't have a 'state' in the traditional sense,
        # but any attributes can be updated here.
        pass

    async def async_activate(self, **kwargs) -> None:
        """Activate the scene."""
        self.send_event("activate", kwargs)