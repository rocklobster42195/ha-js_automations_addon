from homeassistant.components.device_tracker import SourceType, TrackerEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from . import (
    JSAutomationsBaseEntity,
    async_setup_js_platform,
    CONF_ATTRIBUTES,
)
from homeassistant.const import CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the JS Automations device tracker platform."""
    connection = await async_setup_js_platform(
        hass, "device_tracker", JSAutomationsDeviceTracker, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsDeviceTracker(JSAutomationsBaseEntity, TrackerEntity):
    """Representation of a JS Automations Device Tracker."""

    def _restore_state(self, last_state):
        """Zustand für Device Tracker wiederherstellen."""
        super()._restore_state(last_state)
        attrs = last_state.attributes
        self._attr_latitude = attrs.get("latitude")
        self._attr_longitude = attrs.get("longitude")
        self._attr_gps_accuracy = attrs.get("gps_accuracy")
        self._attr_battery_level = attrs.get("battery_level")
        self._attr_source_type = attrs.get("source_type")
        self._attr_location_name = attrs.get("location_name")

    def update_data(self, data):
        """Update Tracker spezifische Daten."""
        super().update_data(data)
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]

            # GPS & Core Tracker Daten
            if "latitude" in attrs: self._attr_latitude = float(attrs["latitude"])
            if "longitude" in attrs: self._attr_longitude = float(attrs["longitude"])
            if "gps_accuracy" in attrs: self._attr_gps_accuracy = int(attrs["gps_accuracy"])
            if "battery_level" in attrs: self._attr_battery_level = int(attrs["battery_level"])
            
            # Bestimmung des Source Type
            if "source_type" in attrs: 
                self._attr_source_type = attrs["source_type"]
            elif "latitude" in attrs:
                self._attr_source_type = SourceType.GPS
            else:
                self._attr_source_type = SourceType.ROUTER

            # Netzwerk-Identifikatoren
            if "location_name" in attrs: self._attr_location_name = attrs["location_name"]
            if "ip_address" in attrs: self._attr_ip_address = attrs["ip_address"]
            if "mac_address" in attrs: self._attr_mac_address = attrs["mac_address"]
            if "hostname" in attrs: self._attr_hostname = attrs["hostname"]

            # Cleanup der Extra Attributes
            managed_keys = [
                "latitude", "longitude", "gps_accuracy", "battery_level", 
                "source_type", "location_name", "ip_address", "mac_address", "hostname"
            ]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

        # Fallback: Falls 'state' (z.B. 'home') geliefert wird und kein GPS da ist, nutze dies als Ort
        if CONF_STATE in data:
            if not getattr(self, "_attr_latitude", None):
                self._attr_location_name = data[CONF_STATE]

        if self.hass:
            self.async_write_ha_state()