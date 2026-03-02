from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.device_tracker import (
    DeviceTrackerEntity,
    SourceType,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import (
    CONF_UNIQUE_ID,
    CONF_STATE,
    ATTR_LATITUDE,
    ATTR_LONGITUDE,
    ATTR_GPS_ACCURACY,
)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the device_tracker platform."""

    @callback
    def async_add_device_tracker(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsDeviceTracker(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_device_tracker", async_add_device_tracker)
    )

class JSAutomationsDeviceTracker(JSAutomationsBaseEntity, DeviceTrackerEntity):
    """Representation of a JS Automations Device Tracker."""

    def __init__(self, data):
        """Initialize the device tracker."""
        self._attr_is_home = False
        self._attr_source_type = SourceType.GPS # Default, can be overridden by data
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_home = last_state.state == "home"
            attrs = last_state.attributes
            if ATTR_LATITUDE in attrs: self._attr_latitude = attrs[ATTR_LATITUDE]
            if ATTR_LONGITUDE in attrs: self._attr_longitude = attrs[ATTR_LONGITUDE]
            if ATTR_GPS_ACCURACY in attrs: self._attr_gps_accuracy = attrs[ATTR_GPS_ACCURACY]
            if "source_type" in attrs: self._attr_source_type = attrs["source_type"]

    def _update_specific_state(self, data):
        """Update device tracker specific state."""
        if CONF_STATE in data:
            self._attr_is_home = data[CONF_STATE] == "home"
            # The state itself is often the zone name, so we set it directly
            self._attr_state = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if ATTR_LATITUDE in attrs: self._attr_latitude = attrs[ATTR_LATITUDE]
            if ATTR_LONGITUDE in attrs: self._attr_longitude = attrs[ATTR_LONGITUDE]
            if ATTR_GPS_ACCURACY in attrs: self._attr_gps_accuracy = attrs[ATTR_GPS_ACCURACY]
            if "source_type" in attrs: self._attr_source_type = attrs["source_type"]

    # Device trackers do not typically have actions like turn_on/off,
    # their state is updated via the _update_specific_state method.
    # If specific actions are needed, they would be custom services or
    # handled via the generic send_event if the HA core provides such methods.