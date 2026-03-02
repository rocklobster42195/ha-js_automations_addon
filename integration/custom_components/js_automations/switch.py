from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.switch import SwitchEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_switch(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsSwitch(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_switch", async_add_switch)
    )

class JSAutomationsSwitch(JSAutomationsBaseEntity, SwitchEntity):
    """Representation of a JS Automations Switch."""

    def __init__(self, data):
        self._attr_is_on = False
        super().__init__(data)

    def _update_specific_state(self, data):
        """Update switch specific state."""
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True
        
        self._attr_assumed_state = False

    async def async_turn_on(self, **kwargs):
        """Turn the entity on."""
        self.send_event("turn_on")

    async def async_turn_off(self, **kwargs):
        """Turn the entity off."""
        self.send_event("turn_off")