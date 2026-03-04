from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.weather import (
    WeatherEntity,
    WeatherEntityFeature,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE
from homeassistant.const import (
    CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE,
    UnitOfTemperature, UnitOfPressure, UnitOfSpeed, UnitOfLength, UnitOfPrecipitationDepth
)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_weather(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsWeather(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_weather", async_add_weather)
    )

class JSAutomationsWeather(WeatherEntity, RestoreEntity):
    """Representation of a JS Automations Weather Entity."""

    _attr_native_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_native_pressure_unit = UnitOfPressure.HPA
    _attr_native_wind_speed_unit = UnitOfSpeed.KILOMETERS_PER_HOUR
    _attr_native_visibility_unit = UnitOfLength.KILOMETERS
    _attr_native_precipitation_unit = UnitOfPrecipitationDepth.MILLIMETERS

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._forecast_daily = None
        self._forecast_hourly = None
        self._forecast_twice_daily = None
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
             self._attr_condition = last_state.state

    def update_data(self, data):
        """Update entity state and attributes."""
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data: self._attr_available = data[CONF_AVAILABLE]
        
        if CONF_STATE in data:
            self._attr_condition = data[CONF_STATE]

        if CONF_DEVICE_INFO in data:
            info = data[CONF_DEVICE_INFO].copy()
            if "identifiers" in info and isinstance(info["identifiers"], list):
                ids = set()
                for x in info["identifiers"]:
                    if isinstance(x, list):
                        ids.add(tuple(x))
                    else:
                        ids.add((DOMAIN, str(x)))
                info["identifiers"] = ids
            self._attr_device_info = info
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() 
                if k not in [
                    "temperature", "pressure", "humidity", "wind_speed", "wind_bearing", 
                    "visibility", "ozone", "cloud_coverage", "uv_index", "dew_point", "apparent_temperature",
                    "temperature_unit", "pressure_unit", "wind_speed_unit", "visibility_unit", "precipitation_unit",
                    "forecast_daily", "forecast_hourly", "forecast_twice_daily"
                ]}
            
            if "temperature" in attrs: self._attr_native_temperature = float(attrs["temperature"])
            if "pressure" in attrs: self._attr_native_pressure = float(attrs["pressure"])
            if "humidity" in attrs: self._attr_native_humidity = float(attrs["humidity"])
            if "wind_speed" in attrs: self._attr_native_wind_speed = float(attrs["wind_speed"])
            if "wind_bearing" in attrs: self._attr_wind_bearing = float(attrs["wind_bearing"])
            if "visibility" in attrs: self._attr_native_visibility = float(attrs["visibility"])
            if "ozone" in attrs: self._attr_ozone = float(attrs["ozone"])
            if "cloud_coverage" in attrs: self._attr_cloud_coverage = float(attrs["cloud_coverage"])
            if "uv_index" in attrs: self._attr_uv_index = float(attrs["uv_index"])
            if "dew_point" in attrs: self._attr_native_dew_point = float(attrs["dew_point"])
            if "apparent_temperature" in attrs: self._attr_native_apparent_temperature = float(attrs["apparent_temperature"])

            # Units
            if "temperature_unit" in attrs: self._attr_native_temperature_unit = attrs["temperature_unit"]
            if "pressure_unit" in attrs: self._attr_native_pressure_unit = attrs["pressure_unit"]
            if "wind_speed_unit" in attrs: self._attr_native_wind_speed_unit = attrs["wind_speed_unit"]
            if "visibility_unit" in attrs: self._attr_native_visibility_unit = attrs["visibility_unit"]
            if "precipitation_unit" in attrs: self._attr_native_precipitation_unit = attrs["precipitation_unit"]

            # Forecasts
            features = 0
            if "forecast_daily" in attrs:
                self._forecast_daily = attrs["forecast_daily"]
                features |= WeatherEntityFeature.FORECAST_DAILY
            if "forecast_hourly" in attrs:
                self._forecast_hourly = attrs["forecast_hourly"]
                features |= WeatherEntityFeature.FORECAST_HOURLY
            if "forecast_twice_daily" in attrs:
                self._forecast_twice_daily = attrs["forecast_twice_daily"]
                features |= WeatherEntityFeature.FORECAST_TWICE_DAILY
            
            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_forecast_daily(self) -> list[dict] | None:
        return self._forecast_daily

    async def async_forecast_hourly(self) -> list[dict] | None:
        return self._forecast_hourly

    async def async_forecast_twice_daily(self) -> list[dict] | None:
        return self._forecast_twice_daily