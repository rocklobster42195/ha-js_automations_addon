from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.water_heater import (
    WaterHeaterEntity,
    WaterHeaterEntityFeature,
    ATTR_TEMPERATURE,
    ATTR_OPERATION_MODE,
    ATTR_OPERATION_LIST,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE, UnitOfTemperature

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the water_heater platform."""

    @callback
    def async_add_water_heater(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsWaterHeater(hass, data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_water_heater", async_add_water_heater)
    )

class JSAutomationsWaterHeater(JSAutomationsBaseEntity, WaterHeaterEntity):
    """Representation of a JS Automations Water Heater."""

    def __init__(self, hass: HomeAssistant, data):
        """Initialize the water heater."""
        self._attr_temperature_unit = hass.config.units.temperature_unit
        self._attr_operation_mode = None
        self._attr_supported_features = WaterHeaterEntityFeature.OPERATION_MODE
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_operation_mode = last_state.state
            attrs = last_state.attributes
            if ATTR_TEMPERATURE in attrs: self._attr_target_temperature = attrs[ATTR_TEMPERATURE]
            if ATTR_OPERATION_MODE in attrs: self._attr_operation_mode = attrs[ATTR_OPERATION_MODE]
            if ATTR_OPERATION_LIST in attrs: self._attr_operation_list = attrs[ATTR_OPERATION_LIST]

    def _update_specific_state(self, data):
        """Update water heater specific state."""
        if CONF_STATE in data:
            self._attr_operation_mode = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "current_temperature" in attrs: self._attr_current_temperature = attrs["current_temperature"]
            if ATTR_TEMPERATURE in attrs:
                self._attr_target_temperature = attrs[ATTR_TEMPERATURE]
                self._attr_supported_features |= WaterHeaterEntityFeature.TARGET_TEMPERATURE
            if ATTR_OPERATION_LIST in attrs:
                self._attr_operation_list = attrs[ATTR_OPERATION_LIST]
                self._attr_supported_features |= WaterHeaterEntityFeature.OPERATION_MODE
            if ATTR_OPERATION_MODE in attrs:
                self._attr_operation_mode = attrs[ATTR_OPERATION_MODE]
            
            # Home Assistant's water_heater component uses operation_mode as state.
            # If 'off' is a valid operation mode, it implies turn_on/off functionality.
            if self._attr_operation_list and "off" in self._attr_operation_list:
                self._attr_supported_features |= WaterHeaterEntityFeature.TURN_ON
                self._attr_supported_features |= WaterHeaterEntityFeature.TURN_OFF

            if "supported_features" in attrs:
                self._attr_supported_features = WaterHeaterEntityFeature(attrs["supported_features"])

    async def async_set_temperature(self, **kwargs) -> None:
        """Set new target temperature."""
        self.send_event("set_temperature", kwargs)

    async def async_set_operation_mode(self, operation_mode: str) -> None:
        """Set new operation mode."""
        self.send_event("set_operation_mode", {"operation_mode": operation_mode})

    async def async_turn_on(self) -> None:
        """Turn the water heater on."""
        # Assuming 'on' or a specific heating mode is available
        if self._attr_operation_list and "heat" in self._attr_operation_list:
            await self.async_set_operation_mode("heat")
        elif self._attr_operation_list and "on" in self._attr_operation_list:
            await self.async_set_operation_mode("on")
        else:
            self.send_event("turn_on") # Fallback if no specific mode

    async def async_turn_off(self) -> None:
        """Turn the water heater off."""
        # Assuming 'off' is a valid operation mode
        if self._attr_operation_list and "off" in self._attr_operation_list:
            await self.async_set_operation_mode("off")
        else:
            self.send_event("turn_off") # Fallback if no specific mode