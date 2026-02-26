from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.button import ButtonEntity
from . import DOMAIN, DATA_ADD_ENTITIES, DATA_ENTITIES, CONF_ATTRIBUTES
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    def create_entity(data):
        unique_id = data[CONF_UNIQUE_ID]
        entity = JSAutomationsButton(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    hass.data[DOMAIN][DATA_ADD_ENTITIES]["button"] = create_entity

class JSAutomationsButton(ButtonEntity):
    """Representation of a JS Automations Button."""

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self.update_data(data)

    def update_data(self, data):
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_ATTRIBUTES in data: self._attr_extra_state_attributes = data[CONF_ATTRIBUTES]
        
        if self.hass:
            self.async_write_ha_state()
            
    async def async_press(self) -> None:
        """Handle the button press."""
        # Node.js listens to call_service event, so we don't need to do anything here
        pass