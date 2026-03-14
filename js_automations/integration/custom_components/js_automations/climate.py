from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.climate import (
    ClimateEntity,
    ClimateEntityFeature,
    HVACMode,
)
from homeassistant.const import (
    ATTR_TEMPERATURE,
    CONF_STATE,
    CONF_UNIT_OF_MEASUREMENT,
    UnitOfTemperature,
)
from . import (
    JSAutomationsBaseEntity,
    async_setup_js_platform,
    CONF_ATTRIBUTES,
)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the JS Automations climate platform."""
    connection = await async_setup_js_platform(
        hass, "climate", JSAutomationsClimate, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsClimate(JSAutomationsBaseEntity, ClimateEntity):
    """Representation of a JS Automations Climate Entity."""

    _attr_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_hvac_modes = [HVACMode.OFF, HVACMode.HEAT, HVACMode.COOL, HVACMode.AUTO]
    _attr_supported_features = ClimateEntityFeature.TARGET_TEMPERATURE

    def _restore_state(self, last_state):
        """Zustand für Climate wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_hvac_mode = last_state.state
        if "temperature" in last_state.attributes:
            self._attr_target_temperature = last_state.attributes["temperature"]
        if "current_temperature" in last_state.attributes:
            self._attr_current_temperature = last_state.attributes["current_temperature"]

    def update_data(self, data):
        """Update Climate spezifische Daten und filtern der Attribute."""
        super().update_data(data)

        if CONF_UNIT_OF_MEASUREMENT in data:
            self._attr_temperature_unit = data[CONF_UNIT_OF_MEASUREMENT]

        # State in HA for climate is hvac_mode
        if CONF_STATE in data and data[CONF_STATE]:
            self._attr_hvac_mode = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            
            # 1. Native Properties extrahieren
            if "current_temperature" in attrs: self._attr_current_temperature = float(attrs["current_temperature"])
            if "temperature" in attrs: self._attr_target_temperature = float(attrs["temperature"])
            if "hvac_modes" in attrs: self._attr_hvac_modes = attrs["hvac_modes"]
            if "min_temp" in attrs: self._attr_min_temp = float(attrs["min_temp"])
            if "max_temp" in attrs: self._attr_max_temp = float(attrs["max_temp"])
            if "target_temp_step" in attrs: self._attr_target_temperature_step = float(attrs["target_temp_step"])
            if "preset_mode" in attrs: self._attr_preset_mode = attrs["preset_mode"]
            if "preset_modes" in attrs: self._attr_preset_modes = attrs["preset_modes"]
            if "fan_mode" in attrs: self._attr_fan_mode = attrs["fan_mode"]
            if "fan_modes" in attrs: self._attr_fan_modes = attrs["fan_modes"]
            
            # 2. Bereinigen der Extra Attributes (verhindert Duplikate in der UI)
            managed_keys = [
                "current_temperature", "temperature", "hvac_modes", "min_temp", 
                "max_temp", "target_temp_step", "preset_mode", "preset_modes", 
                "fan_mode", "fan_modes"
            ]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

            # 3. Dynamische Feature Flags
            features = ClimateEntityFeature.TARGET_TEMPERATURE
            if "preset_modes" in attrs:
                features |= ClimateEntityFeature.PRESET_MODE
            if "fan_modes" in attrs:
                features |= ClimateEntityFeature.FAN_MODE
                
            if HVACMode.OFF in self._attr_hvac_modes:
                features |= ClimateEntityFeature.TURN_OFF
                features |= ClimateEntityFeature.TURN_ON

            self._attr_supported_features = features
            if self.hass:
                self.async_write_ha_state()

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        """Set new target hvac mode."""
        self._fire_js_event("set_hvac_mode", {"hvac_mode": hvac_mode})

    async def async_set_temperature(self, **kwargs) -> None:
        """Set new target temperature."""
        data = {}
        if ATTR_TEMPERATURE in kwargs: data["temperature"] = kwargs[ATTR_TEMPERATURE]
        if "hvac_mode" in kwargs: data["hvac_mode"] = kwargs["hvac_mode"]
        self._fire_js_event("set_temperature", data)

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Set new preset mode."""
        self._fire_js_event("set_preset_mode", {"preset_mode": preset_mode})

    async def async_set_fan_mode(self, fan_mode: str) -> None:
        """Set new fan mode."""
        self._fire_js_event("set_fan_mode", {"fan_mode": fan_mode})