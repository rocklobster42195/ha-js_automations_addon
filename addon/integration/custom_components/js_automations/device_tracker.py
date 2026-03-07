from homeassistant.components.device_tracker import SourceType, TrackerEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
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

class JSAutomationsDeviceTracker(TrackerEntity, RestoreEntity):
    """Representation of a JS Automations Device Tracker."""

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()

    def update_data(self, data):
        """Update entity state and attributes."""
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data: self._attr_available = data[CONF_AVAILABLE]
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() 
                if k not in ["latitude", "longitude", "battery_level", "source_type", "gps_accuracy", "location_name", "ip_address", "mac_address", "hostname"]}
            
            if "latitude" in attrs: self._attr_latitude = float(attrs["latitude"])
            if "longitude" in attrs: self._attr_longitude = float(attrs["longitude"])
            if "gps_accuracy" in attrs: self._attr_gps_accuracy = int(attrs["gps_accuracy"])
            if "battery_level" in attrs: self._attr_battery_level = int(attrs["battery_level"])
            
            if "source_type" in attrs: 
                self._attr_source_type = attrs["source_type"]
            elif "latitude" in attrs:
                self._attr_source_type = SourceType.GPS
            else:
                self._attr_source_type = SourceType.ROUTER

            if "location_name" in attrs: self._attr_location_name = attrs["location_name"]
            if "ip_address" in attrs: self._attr_ip_address = attrs["ip_address"]
            if "mac_address" in attrs: self._attr_mac_address = attrs["mac_address"]
            if "hostname" in attrs: self._attr_hostname = attrs["hostname"]

        # If state is provided (e.g. 'home', 'not_home'), use it as location_name if no GPS
        if CONF_STATE in data:
            state = data[CONF_STATE]
            # If no GPS data provided in this update or previously set, assume state is location name
            if not getattr(self, "_attr_latitude", None):
                self._attr_location_name = state

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
        
        if self.hass:
            self.async_write_ha_state()