from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.weather import (
    WeatherEntity,
    WeatherEntityFeature,
)
from . import (
    JSAutomationsBaseEntity,
    async_setup_js_platform,
    CONF_ATTRIBUTES,
)
from homeassistant.const import (
    CONF_STATE,
    UnitOfTemperature, UnitOfPressure, UnitOfSpeed, UnitOfLength, UnitOfPrecipitationDepth
)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the JS Automations weather platform."""
    connection = await async_setup_js_platform(
        hass, "weather", JSAutomationsWeather, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsWeather(JSAutomationsBaseEntity, WeatherEntity):
    """Representation of a JS Automations Weather Entity."""

    _attr_native_temperature_unit = UnitOfTemperature.CELSIUS
    _attr_native_pressure_unit = UnitOfPressure.HPA
    _attr_native_wind_speed_unit = UnitOfSpeed.KILOMETERS_PER_HOUR
    _attr_native_visibility_unit = UnitOfLength.KILOMETERS
    _attr_native_precipitation_unit = UnitOfPrecipitationDepth.MILLIMETERS

    _forecast_daily = None
    _forecast_hourly = None
    _forecast_twice_daily = None

    def _restore_state(self, last_state):
        """Zustand für Weather wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_condition = last_state.state

    def update_data(self, data):
        """Update Weather spezifische Daten."""
        super().update_data(data)

        if CONF_STATE in data:
            self._attr_condition = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]

            if "temperature" in attrs: self._attr_native_temperature = float(attrs["temperature"])
            if "pressure" in attrs: self._attr_native_pressure = float(attrs["pressure"])
            if "humidity" in attrs: self._attr_native_humidity = float(attrs["humidity"])
            if "wind_speed" in attrs: self._attr_native_wind_speed = float(attrs["wind_speed"])
            if "wind_bearing" in attrs: self._attr_wind_bearing = float(attrs["wind_bearing"])
            if "visibility" in attrs: self._attr_native_visibility = float(attrs["visibility"])

            if "temperature_unit" in attrs: self._attr_native_temperature_unit = attrs["temperature_unit"]
            if "pressure_unit" in attrs: self._attr_native_pressure_unit = attrs["pressure_unit"]
            if "wind_speed_unit" in attrs: self._attr_native_wind_speed_unit = attrs["wind_speed_unit"]

            # Cleanup
            managed_keys = ["temperature", "pressure", "humidity", "wind_speed", "wind_bearing", 
                            "visibility", "temperature_unit", "pressure_unit", "wind_speed_unit",
                            "forecast_daily", "forecast_hourly", "forecast_twice_daily"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

            # Forecast handling
            features = 0
            if "forecast_daily" in attrs:
                self._forecast_daily = attrs["forecast_daily"]
                features |= WeatherEntityFeature.FORECAST_DAILY
            if "forecast_hourly" in attrs:
                self._forecast_hourly = attrs["forecast_hourly"]
                features |= WeatherEntityFeature.FORECAST_HOURLY
            
            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_forecast_daily(self) -> list[dict] | None:
        return self._forecast_daily
    async def async_forecast_hourly(self) -> list[dict] | None:
        return self._forecast_hourly