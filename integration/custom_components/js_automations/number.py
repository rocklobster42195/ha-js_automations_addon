from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.number import NumberEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE, CONF_UNIT_OF_MEASUREMENT, CONF_DEVICE_CLASS

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

class JSAutomationsNumber(JSAutomationsBaseEntity, NumberEntity):
    """Representation of a JS Automations Number."""

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state not in ("unknown", "unavailable"):
            try:
                self._attr_native_value = float(last_state.state)
            except ValueError:
                pass

    def _update_specific_state(self, data):
        """Update number specific state."""
        if CONF_STATE in data: self._attr_native_value = float(data[CONF_STATE]) if data[CONF_STATE] is not None else None
        if CONF_UNIT_OF_MEASUREMENT in data: self._attr_native_unit_of_measurement = data[CONF_UNIT_OF_MEASUREMENT]
        if CONF_DEVICE_CLASS in data: self._attr_device_class = data[CONF_DEVICE_CLASS]
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "min" in attrs: self._attr_native_min_value = float(attrs["min"])
            if "max" in attrs: self._attr_native_max_value = float(attrs["max"])
            if "step" in attrs: self._attr_native_step = float(attrs["step"])
            if "mode" in attrs: self._attr_mode = attrs["mode"]

    async def async_set_native_value(self, value: float) -> None:
        """Set new value."""
        self.send_event("set_value", value)