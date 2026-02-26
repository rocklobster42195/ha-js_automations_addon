from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.switch import SwitchEntity
from . import DOMAIN, DATA_ADD_ENTITIES, DATA_ENTITIES, CONF_ATTRIBUTES
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    def create_entity(data):
        unique_id = data[CONF_UNIQUE_ID]
        entity = JSAutomationsSwitch(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    hass.data[DOMAIN][DATA_ADD_ENTITIES]["switch"] = create_entity

class JSAutomationsSwitch(SwitchEntity):
    """Representation of a JS Automations Switch."""

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self.update_data(data)

    def update_data(self, data):
        """Update entity state and attributes."""
        if CONF_NAME in data:
            self._attr_name = data[CONF_NAME]
        if CONF_ICON in data:
            self._attr_icon = data[CONF_ICON]
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True
        if CONF_ATTRIBUTES in data:
            self._attr_extra_state_attributes = data[CONF_ATTRIBUTES]
        
        # Optimistic mode: We assume the state is correct as pushed by Node.js
        self._attr_assumed_state = True
        
        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs):
        """Turn the entity on."""
        self._attr_is_on = True
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs):
        """Turn the entity off."""
        self._attr_is_on = False
        self.async_write_ha_state()
