from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.air_quality import (
    AirQualityEntity,
    ATTR_CO,
    ATTR_CO2,
    ATTR_NO,
    ATTR_NO2,
    ATTR_O3,
    ATTR_PM1,
    ATTR_PM25,
    ATTR_PM10,
    ATTR_SO2,
    ATTR_VOC,
    ATTR_AQI,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE, CONF_DEVICE_CLASS

import logging

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the air_quality platform."""

    @callback
    def async_add_air_quality(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsAirQuality(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_air_quality", async_add_air_quality)
    )

class JSAutomationsAirQuality(JSAutomationsBaseEntity, AirQualityEntity):
    """Representation of a JS Automations Air Quality entity."""

    def __init__(self, data):
        """Initialize the air quality entity."""
        self._attr_native_carbon_monoxide = None
        self._attr_native_carbon_dioxide = None
        self._attr_native_nitrogen_oxide = None
        self._attr_native_nitrogen_dioxide = None
        self._attr_native_ozone = None
        self._attr_native_pm_0_1 = None
        self._attr_native_particulate_matter_2_5 = None
        self._attr_native_particulate_matter_10 = None
        self._attr_native_sulfur_dioxide = None
        self._attr_native_volatile_organic_compounds = None
        self._attr_native_formaldehyde = None
        self._attr_native_air_quality_index = None
        self._attr_attribution = None
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            # Air quality entities typically don't have a simple state, but expose metrics as attributes.
            # We can use the last state for a general condition if provided, but it's not a core metric.
            self._attr_state = last_state.state
            attrs = last_state.attributes
            if ATTR_CO in attrs: self._attr_native_carbon_monoxide = attrs[ATTR_CO]
            if ATTR_CO2 in attrs: self._attr_native_carbon_dioxide = attrs[ATTR_CO2]
            if ATTR_NO in attrs: self._attr_native_nitrogen_oxide = attrs[ATTR_NO]
            if ATTR_NO2 in attrs: self._attr_native_nitrogen_dioxide = attrs[ATTR_NO2]
            if ATTR_O3 in attrs: self._attr_native_ozone = attrs[ATTR_O3]
            if ATTR_PM1 in attrs: self._attr_native_pm_0_1 = attrs[ATTR_PM1]
            if ATTR_PM25 in attrs: self._attr_native_particulate_matter_2_5 = attrs[ATTR_PM25]
            if ATTR_PM10 in attrs: self._attr_native_particulate_matter_10 = attrs[ATTR_PM10]
            if ATTR_SO2 in attrs: self._attr_native_sulfur_dioxide = attrs[ATTR_SO2]
            if ATTR_VOC in attrs: self._attr_native_volatile_organic_compounds = attrs[ATTR_VOC]
            if "formaldehyde" in attrs: self._attr_native_formaldehyde = attrs["formaldehyde"]
            if ATTR_AQI in attrs: self._attr_native_air_quality_index = attrs[ATTR_AQI]
            if "attribution" in attrs: self._attr_attribution = attrs["attribution"]
            if CONF_DEVICE_CLASS in attrs: self._attr_device_class = attrs[CONF_DEVICE_CLASS]

    def _update_specific_state(self, data):
        """Update air quality specific state."""
        if CONF_STATE in data: self._attr_state = data[CONF_STATE]
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if ATTR_CO in attrs: self._attr_native_carbon_monoxide = attrs[ATTR_CO]
            if ATTR_CO2 in attrs: self._attr_native_carbon_dioxide = attrs[ATTR_CO2]
            if ATTR_NO in attrs: self._attr_native_nitrogen_oxide = attrs[ATTR_NO]
            if ATTR_NO2 in attrs: self._attr_native_nitrogen_dioxide = attrs[ATTR_NO2]
            if ATTR_O3 in attrs: self._attr_native_ozone = attrs[ATTR_O3]
            if ATTR_PM1 in attrs: self._attr_native_pm_0_1 = attrs[ATTR_PM1]
            if ATTR_PM25 in attrs: self._attr_native_particulate_matter_2_5 = attrs[ATTR_PM25]
            if ATTR_PM10 in attrs: self._attr_native_particulate_matter_10 = attrs[ATTR_PM10]
            if ATTR_SO2 in attrs: self._attr_native_sulfur_dioxide = attrs[ATTR_SO2]
            if ATTR_VOC in attrs: self._attr_native_volatile_organic_compounds = attrs[ATTR_VOC]
            if "formaldehyde" in attrs: self._attr_native_formaldehyde = attrs["formaldehyde"]
            if ATTR_AQI in attrs: self._attr_native_air_quality_index = attrs[ATTR_AQI]
            if "attribution" in attrs: self._attr_attribution = attrs["attribution"]
            if CONF_DEVICE_CLASS in attrs: self._attr_device_class = attrs[CONF_DEVICE_CLASS]