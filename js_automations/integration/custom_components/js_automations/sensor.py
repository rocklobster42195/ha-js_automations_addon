from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE, async_format_device_info
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE, CONF_UNIT_OF_MEASUREMENT, CONF_DEVICE_CLASS, CONF_STATE_CLASS

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_sensor(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsSensor(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_sensor", async_add_sensor)
    )

class JSAutomationsSensor(SensorEntity, RestoreEntity):
    """Representation of a JS Automations Sensor."""

    def __init__(self, data):
        self.entity_id = data["entity_id"]
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            # Try to restore as number if possible for better statistics
            try:
                self._attr_native_value = float(last_state.state)
            except (ValueError, TypeError):
                self._attr_native_value = last_state.state

    def update_data(self, data):
        """Update entity state and attributes."""
        self._attr_name = data.get(CONF_NAME, self._attr_name)
        self._attr_icon = data.get(CONF_ICON, self._attr_icon)
        self._attr_native_value = data.get(CONF_STATE, self._attr_native_value)
        self._attr_extra_state_attributes = data.get(CONF_ATTRIBUTES, self._attr_extra_state_attributes)
        self._attr_native_unit_of_measurement = data.get(CONF_UNIT_OF_MEASUREMENT, self._attr_native_unit_of_measurement)
        self._attr_device_class = data.get(CONF_DEVICE_CLASS, self._attr_device_class)
        self._attr_state_class = data.get(CONF_STATE_CLASS, self._attr_state_class)
        self._attr_available = data.get(CONF_AVAILABLE, self._attr_available)

        device_info = async_format_device_info(data)
        if device_info:
            self._attr_device_info = device_info
        
        if self.hass:
            self.async_write_ha_state()