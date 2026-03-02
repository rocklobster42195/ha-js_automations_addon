from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.climate import (
    ClimateEntity,
    ClimateEntityFeature,
    HVACMode,
    ATTR_TEMPERATURE,
    ATTR_TARGET_TEMP_HIGH,
    ATTR_TARGET_TEMP_LOW,
    ATTR_PRESET_MODE,
    ATTR_FAN_MODE,
    ATTR_SWING_MODE,
    ATTR_HUMIDITY,
    ATTR_TARGET_HUMIDITY,
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
    """Set up the climate platform."""

    @callback
    def async_add_climate(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsClimate(hass, data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_climate", async_add_climate)
    )

class JSAutomationsClimate(JSAutomationsBaseEntity, ClimateEntity):
    """Representation of a JS Automations Climate entity."""
    _enable_turn_on_off_backwards_compatibility = False

    def __init__(self, hass: HomeAssistant, data):
        """Initialize the climate entity."""
        self._attr_hvac_mode = HVACMode.OFF
        self._attr_supported_features = ClimateEntityFeature(0)
        self._attr_temperature_unit = hass.config.units.temperature_unit
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_hvac_mode = last_state.state
            attrs = last_state.attributes
            if ATTR_TEMPERATURE in attrs: self._attr_target_temperature = attrs[ATTR_TEMPERATURE]
            if ATTR_TARGET_TEMP_HIGH in attrs: self._attr_target_temperature_high = attrs[ATTR_TARGET_TEMP_HIGH]
            if ATTR_TARGET_TEMP_LOW in attrs: self._attr_target_temperature_low = attrs[ATTR_TARGET_TEMP_LOW]
            if ATTR_PRESET_MODE in attrs: self._attr_preset_mode = attrs[ATTR_PRESET_MODE]
            if ATTR_FAN_MODE in attrs: self._attr_fan_mode = attrs[ATTR_FAN_MODE]
            if ATTR_SWING_MODE in attrs: self._attr_swing_mode = attrs[ATTR_SWING_MODE]
            if ATTR_HUMIDITY in attrs: self._attr_current_humidity = attrs[ATTR_HUMIDITY]
            if ATTR_TARGET_HUMIDITY in attrs: self._attr_target_humidity = attrs[ATTR_TARGET_HUMIDITY]

    def _update_specific_state(self, data):
        """Update climate specific state."""
        if CONF_STATE in data and data[CONF_STATE] in iter(HVACMode):
            self._attr_hvac_mode = HVACMode(data[CONF_STATE])

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            
            if "hvac_modes" in attrs: self._attr_hvac_modes = [HVACMode(m) for m in attrs["hvac_modes"]]
            
            if "current_temperature" in attrs: self._attr_current_temperature = attrs["current_temperature"]
            if "target_temperature" in attrs:
                self._attr_target_temperature = attrs["target_temperature"]
                self._attr_supported_features |= ClimateEntityFeature.TARGET_TEMPERATURE
            if "target_temperature_high" in attrs:
                self._attr_target_temperature_high = attrs["target_temperature_high"]
                self._attr_supported_features |= ClimateEntityFeature.TARGET_TEMPERATURE_RANGE
            if "target_temperature_low" in attrs:
                self._attr_target_temperature_low = attrs["target_temperature_low"]
                self._attr_supported_features |= ClimateEntityFeature.TARGET_TEMPERATURE_RANGE
            
            if "current_humidity" in attrs: self._attr_current_humidity = attrs["current_humidity"]
            if "target_humidity" in attrs:
                self._attr_target_humidity = attrs["target_humidity"]
                self._attr_supported_features |= ClimateEntityFeature.TARGET_HUMIDITY

            if "preset_modes" in attrs:
                self._attr_preset_modes = attrs["preset_modes"]
                self._attr_supported_features |= ClimateEntityFeature.PRESET_MODE
            if "preset_mode" in attrs: self._attr_preset_mode = attrs["preset_mode"]

            if "fan_modes" in attrs:
                self._attr_fan_modes = attrs["fan_modes"]
                self._attr_supported_features |= ClimateEntityFeature.FAN_MODE
            if "fan_mode" in attrs: self._attr_fan_mode = attrs["fan_mode"]

            if "swing_modes" in attrs:
                self._attr_swing_modes = attrs["swing_modes"]
                self._attr_supported_features |= ClimateEntityFeature.SWING_MODE
            if "swing_mode" in attrs: self._attr_swing_mode = attrs["swing_mode"]
            
            if self._attr_hvac_modes and HVACMode.OFF in self._attr_hvac_modes:
                self._attr_supported_features |= ClimateEntityFeature.TURN_OFF
            if self._attr_hvac_modes and any(mode != HVACMode.OFF for mode in self._attr_hvac_modes):
                self._attr_supported_features |= ClimateEntityFeature.TURN_ON

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        self.send_event("set_hvac_mode", {"hvac_mode": hvac_mode})

    async def async_set_temperature(self, **kwargs) -> None:
        self.send_event("set_temperature", kwargs)

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        self.send_event("set_preset_mode", {"preset_mode": preset_mode})

    async def async_set_fan_mode(self, fan_mode: str) -> None:
        self.send_event("set_fan_mode", {"fan_mode": fan_mode})

    async def async_set_swing_mode(self, swing_mode: str) -> None:
        self.send_event("set_swing_mode", {"swing_mode": swing_mode})
        
    async def async_set_humidity(self, humidity: int) -> None:
        self.send_event("set_humidity", {"humidity": humidity})

    async def async_turn_on(self) -> None:
        self.send_event("turn_on")

    async def async_turn_off(self) -> None:
        self.send_event("turn_off")