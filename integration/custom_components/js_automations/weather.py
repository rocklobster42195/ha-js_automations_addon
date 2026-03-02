from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.weather import (
    WeatherEntity,
    Forecast,
    ATTR_CONDITION_CLEAR_NIGHT,
    ATTR_CONDITION_CLOUDY,
    ATTR_CONDITION_FOG,
    ATTR_CONDITION_HAIL,
    ATTR_CONDITION_LIGHTNING,
    ATTR_CONDITION_PARTLYCLOUDY,
    ATTR_CONDITION_POURING,
    ATTR_CONDITION_RAINY,
    ATTR_CONDITION_SNOWY,
    ATTR_CONDITION_SNOWY_RAINY,
    ATTR_CONDITION_SUNNY,
    ATTR_CONDITION_WINDY,
    ATTR_CONDITION_EXCEPTIONAL,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import (
    CONF_UNIQUE_ID,
    CONF_STATE,
    UnitOfTemperature,
    UnitOfPressure,
    UnitOfSpeed,
    ATTR_TEMPERATURE,
    ATTR_HUMIDITY,
    ATTR_PRESSURE,
    ATTR_WIND_SPEED,
    ATTR_WIND_BEARING,
    ATTR_VISIBILITY,
    ATTR_OZONE,
    ATTR_UV_INDEX,
    ATTR_DEW_POINT,
    ATTR_FORECAST,
)

import logging

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the weather platform."""

    @callback
    def async_add_weather(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsWeather(hass, data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_weather", async_add_weather)
    )

class JSAutomationsWeather(JSAutomationsBaseEntity, WeatherEntity):
    """Representation of a JS Automations Weather entity."""

    def __init__(self, hass: HomeAssistant, data):
        """Initialize the weather entity."""
        self._attr_temperature_unit = hass.config.units.temperature_unit
        self._attr_native_temperature = None
        self._attr_native_pressure = None
        self._attr_native_humidity = None
        self._attr_native_wind_speed = None
        self._attr_wind_bearing = None
        self._attr_condition = None
        self._attr_forecast = None
        self._attr_native_pressure_unit = UnitOfPressure.HPA # Default, can be overridden
        self._attr_native_wind_speed_unit = UnitOfSpeed.METERS_PER_SECOND # Default, can be overridden
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_condition = last_state.state
            attrs = last_state.attributes
            if ATTR_TEMPERATURE in attrs: self._attr_native_temperature = attrs[ATTR_TEMPERATURE]
            if ATTR_HUMIDITY in attrs: self._attr_native_humidity = attrs[ATTR_HUMIDITY]
            if ATTR_PRESSURE in attrs: self._attr_native_pressure = attrs[ATTR_PRESSURE]
            if ATTR_WIND_SPEED in attrs: self._attr_native_wind_speed = attrs[ATTR_WIND_SPEED]
            if ATTR_WIND_BEARING in attrs: self._attr_wind_bearing = attrs[ATTR_WIND_BEARING]
            if ATTR_VISIBILITY in attrs: self._attr_native_visibility = attrs[ATTR_VISIBILITY]
            if ATTR_OZONE in attrs: self._attr_ozone = attrs[ATTR_OZONE]
            if ATTR_UV_INDEX in attrs: self._attr_uv_index = attrs[ATTR_UV_INDEX]
            if ATTR_DEW_POINT in attrs: self._attr_native_dew_point = attrs[ATTR_DEW_POINT]
            if ATTR_FORECAST in attrs: self._attr_forecast = self._parse_forecast(attrs[ATTR_FORECAST])

    def _parse_forecast(self, forecast_data: list[dict]) -> list[Forecast]:
        """Parse raw forecast data from Node.js into Forecast objects."""
        forecasts = []
        for item in forecast_data:
            try:
                forecasts.append(Forecast(
                    datetime=item["datetime"],
                    condition=item.get("condition"),
                    native_temperature=item.get("temperature"),
                    native_templow=item.get("templow"),
                    native_precipitation=item.get("precipitation"),
                    native_precipitation_probability=item.get("precipitation_probability"),
                    native_wind_speed=item.get("wind_speed"),
                    wind_bearing=item.get("wind_bearing"),
                    native_pressure=item.get("pressure"),
                    native_humidity=item.get("humidity"),
                ))
            except (ValueError, KeyError) as e:
                _LOGGER.warning(f"Invalid forecast item data received for {self.entity_id}: {item} - {e}")
        return forecasts

    def _update_specific_state(self, data):
        """Update weather specific state."""
        if CONF_STATE in data: self._attr_condition = data[CONF_STATE]
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if ATTR_TEMPERATURE in attrs: self._attr_native_temperature = attrs[ATTR_TEMPERATURE]
            if ATTR_HUMIDITY in attrs: self._attr_native_humidity = attrs[ATTR_HUMIDITY]
            if ATTR_PRESSURE in attrs: self._attr_native_pressure = attrs[ATTR_PRESSURE]
            if ATTR_WIND_SPEED in attrs: self._attr_native_wind_speed = attrs[ATTR_WIND_SPEED]
            if ATTR_WIND_BEARING in attrs: self._attr_wind_bearing = attrs[ATTR_WIND_BEARING]
            if ATTR_VISIBILITY in attrs: self._attr_native_visibility = attrs[ATTR_VISIBILITY]
            if ATTR_OZONE in attrs: self._attr_ozone = attrs[ATTR_OZONE]
            if ATTR_UV_INDEX in attrs: self._attr_uv_index = attrs[ATTR_UV_INDEX]
            if ATTR_DEW_POINT in attrs: self._attr_native_dew_point = attrs[ATTR_DEW_POINT]
            if "temperature_unit" in attrs: self._attr_temperature_unit = attrs["temperature_unit"]
            if "pressure_unit" in attrs: self._attr_native_pressure_unit = attrs["pressure_unit"]
            if "wind_speed_unit" in attrs: self._attr_native_wind_speed_unit = attrs["wind_speed_unit"]
            if ATTR_FORECAST in attrs: self._attr_forecast = self._parse_forecast(attrs[ATTR_FORECAST])

    async def async_forecast_daily(self) -> list[Forecast] | None:
        """Return the daily forecast."""
        # Node.js should push forecast data via update_entity.
        # This method is primarily for HA to request it if not already present.
        # For now, we return the cached forecast. Node.js can trigger an update.
        return self._attr_forecast

    async def async_forecast_hourly(self) -> list[Forecast] | None:
        """Return the hourly forecast."""
        # Similar to daily, Node.js should push this.
        return self._attr_forecast

    async def async_forecast_twice_daily(self) -> list[Forecast] | None:
        """Return the twice daily forecast."""
        # Similar to daily, Node.js should push this.
        return self._attr_forecast