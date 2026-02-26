from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.binary_sensor import BinarySensorEntity
from . import DOMAIN, DATA_ADD_ENTITIES, DATA_ENTITIES, CONF_ATTRIBUTES
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE, CONF_DEVICE_CLASS

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    def create_entity(data):
        unique_id = data[CONF_UNIQUE_ID]
        entity = JSAutomationsBinarySensor(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    hass.data[DOMAIN][DATA_ADD_ENTITIES]["binary_sensor"] = create_entity

class JSAutomationsBinarySensor(BinarySensorEntity):
    """Representation of a JS Automations Binary Sensor."""

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self.update_data(data)

    def update_data(self, data):
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_STATE in data: 
            val = data[CONF_STATE]
            self._attr_is_on = val == "on" or val is True
        if CONF_ATTRIBUTES in data: self._attr_extra_state_attributes = data[CONF_ATTRIBUTES]
        if CONF_DEVICE_CLASS in data: self._attr_device_class = data[CONF_DEVICE_CLASS]
        
        if self.hass:
            self.async_write_ha_state()
