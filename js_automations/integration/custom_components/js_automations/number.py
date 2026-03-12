from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.number import NumberEntity
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE, async_format_device_info
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE, CONF_UNIT_OF_MEASUREMENT, CONF_DEVICE_CLASS

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_number(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsNumber(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_number", async_add_number)
    )

class JSAutomationsNumber(NumberEntity, RestoreEntity):
    """Representation of a JS Automations Number."""

    def __init__(self, data):
        self.entity_id = data["entity_id"]
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state not in ("unknown", "unavailable"):
            try:
                self._attr_native_value = float(last_state.state)
            except ValueError:
                pass

    def update_data(self, data):
        """Update entity state and attributes."""
        self._attr_name = data.get(CONF_NAME, self._attr_name)
        self._attr_icon = data.get(CONF_ICON, self._attr_icon)
        self._attr_native_unit_of_measurement = data.get(CONF_UNIT_OF_MEASUREMENT, self._attr_native_unit_of_measurement)
        self._attr_device_class = data.get(CONF_DEVICE_CLASS, self._attr_device_class)
        self._attr_available = data.get(CONF_AVAILABLE, self._attr_available)

        if CONF_STATE in data: self._attr_native_value = float(data[CONF_STATE]) if data[CONF_STATE] is not None else None

        device_info = async_format_device_info(data)
        if device_info:
            self._attr_device_info = device_info
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            self._attr_extra_state_attributes = attrs
            if "min" in attrs: self._attr_native_min_value = float(attrs["min"])
            if "max" in attrs: self._attr_native_max_value = float(attrs["max"])
            if "step" in attrs: self._attr_native_step = float(attrs["step"])
            if "mode" in attrs: self._attr_mode = attrs["mode"]

        if self.hass:
            self.async_write_ha_state()

    async def async_set_native_value(self, value: float) -> None:
        """Set new value."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "set_value", "value": value})