from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.climate import (
    ClimateEntity,
    ClimateEntityFeature,
    HVACMode,
)
from homeassistant.const import (
    ATTR_TEMPERATURE,
    CONF_UNIQUE_ID,
    CONF_NAME,
    CONF_ICON,
    CONF_STATE,
    CONF_UNIT_OF_MEASUREMENT,
    UnitOfTemperature,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE, async_format_device_info

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_climate(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsClimate(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_climate", async_add_climate)
    )

class JSAutomationsClimate(ClimateEntity, RestoreEntity):
    """Representation of a JS Automations Climate Entity."""

    _attr_temperature_unit = UnitOfTemperature.CELSIUS

    def __init__(self, data):
        self.entity_id = data["entity_id"]
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._attr_supported_features = ClimateEntityFeature.TARGET_TEMPERATURE
        self._attr_hvac_modes = [HVACMode.OFF, HVACMode.HEAT, HVACMode.COOL]
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_hvac_mode = last_state.state
            if "temperature" in last_state.attributes:
                self._attr_target_temperature = last_state.attributes["temperature"]
            if "current_temperature" in last_state.attributes:
                self._attr_current_temperature = last_state.attributes["current_temperature"]

    def update_data(self, data):
        """Update entity state and attributes."""
        self._attr_name = data.get(CONF_NAME, self._attr_name)
        self._attr_icon = data.get(CONF_ICON, self._attr_icon)
        self._attr_available = data.get(CONF_AVAILABLE, self._attr_available)
        self._attr_temperature_unit = data.get(CONF_UNIT_OF_MEASUREMENT, self._attr_temperature_unit)
        
        # State in HA for climate is hvac_mode
        if CONF_STATE in data and data[CONF_STATE]:
            self._attr_hvac_mode = data[CONF_STATE]

        device_info = async_format_device_info(data)
        if device_info: self._attr_device_info = device_info
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            # Filter out attributes that are handled by properties
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() 
                if k not in ["current_temperature", "temperature", "hvac_modes", "min_temp", "max_temp", "target_temp_step", "preset_mode", "preset_modes", "fan_mode", "fan_modes"]}
            
            if "current_temperature" in attrs: self._attr_current_temperature = float(attrs["current_temperature"])
            if "temperature" in attrs: self._attr_target_temperature = float(attrs["temperature"])
            if "hvac_modes" in attrs: self._attr_hvac_modes = attrs["hvac_modes"]
            if "min_temp" in attrs: self._attr_min_temp = float(attrs["min_temp"])
            if "max_temp" in attrs: self._attr_max_temp = float(attrs["max_temp"])
            if "target_temp_step" in attrs: self._attr_target_temperature_step = float(attrs["target_temp_step"])
            
            # Dynamic Feature Flags
            features = ClimateEntityFeature.TARGET_TEMPERATURE
            
            if "preset_modes" in attrs:
                self._attr_preset_modes = attrs["preset_modes"]
                features |= ClimateEntityFeature.PRESET_MODE
            if "preset_mode" in attrs:
                self._attr_preset_mode = attrs["preset_mode"]
                
            if "fan_modes" in attrs:
                self._attr_fan_modes = attrs["fan_modes"]
                features |= ClimateEntityFeature.FAN_MODE
            if "fan_mode" in attrs:
                self._attr_fan_mode = attrs["fan_mode"]
                
            if HVACMode.OFF in self._attr_hvac_modes:
                features |= ClimateEntityFeature.TURN_OFF
                features |= ClimateEntityFeature.TURN_ON

            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_set_hvac_mode(self, hvac_mode: HVACMode) -> None:
        """Set new target hvac mode."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id,
            "unique_id": self._attr_unique_id,
            "action": "set_hvac_mode",
            "hvac_mode": hvac_mode,
        })

    async def async_set_temperature(self, **kwargs) -> None:
        """Set new target temperature."""
        data = {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "set_temperature"}
        if ATTR_TEMPERATURE in kwargs: data["temperature"] = kwargs[ATTR_TEMPERATURE]
        if "hvac_mode" in kwargs: data["hvac_mode"] = kwargs["hvac_mode"]
        self.hass.bus.async_fire(f"{DOMAIN}_event", data)

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Set new preset mode."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "set_preset_mode", "preset_mode": preset_mode
        })

    async def async_set_fan_mode(self, fan_mode: str) -> None:
        """Set new fan mode."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "set_fan_mode", "fan_mode": fan_mode
        })