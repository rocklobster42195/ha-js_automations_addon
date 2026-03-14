from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.humidifier import (
    HumidifierEntity,
    HumidifierEntityFeature,
)
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
    """Set up the JS Automations humidifier platform."""
    connection = await async_setup_js_platform(
        hass, "humidifier", JSAutomationsHumidifier, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsHumidifier(JSAutomationsBaseEntity, HumidifierEntity):
    """Representation of a JS Automations Humidifier."""

    def _restore_state(self, last_state):
        """Zustand für Humidifier wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_is_on = last_state.state == "on"
        attrs = last_state.attributes
        self._attr_target_humidity = attrs.get("humidity")
        self._attr_mode = attrs.get("mode")

    def update_data(self, data):
        """Update Humidifier spezifische Daten."""
        super().update_data(data)
        
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "humidity" in attrs: self._attr_target_humidity = int(attrs["humidity"])
            
            # Erst die Modi-Liste aktualisieren (Validierungsbasis)
            if "available_modes" in attrs: self._attr_available_modes = attrs["available_modes"]
            
            # Dann den Modus mit Validierung setzen
            if "mode" in attrs:
                mode = attrs["mode"]
                if not self._attr_available_modes or mode in self._attr_available_modes:
                    self._attr_mode = mode

            if "min_humidity" in attrs: self._attr_min_humidity = int(attrs["min_humidity"])
            if "max_humidity" in attrs: self._attr_max_humidity = int(attrs["max_humidity"])
            
            # Determine supported features
            features = 0
            if "available_modes" in attrs:
                features |= HumidifierEntityFeature.MODES
            
            self._attr_supported_features = features

            # Cleanup der Extra Attributes
            managed_keys = ["humidity", "mode", "available_modes", "min_humidity", "max_humidity"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the entity on."""
        self._attr_is_on = True
        self.async_write_ha_state()
        self._fire_js_event("turn_on")

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the entity off."""
        self._attr_is_on = False
        self.async_write_ha_state()
        self._fire_js_event("turn_off")

    async def async_set_humidity(self, humidity: int) -> None:
        """Set new target humidity."""
        self._attr_target_humidity = humidity
        self.async_write_ha_state()
        self._fire_js_event("set_humidity", {"humidity": humidity})

    async def async_set_mode(self, mode: str) -> None:
        """Set new mode."""
        self._attr_mode = mode
        self.async_write_ha_state()
        self._fire_js_event("set_mode", {"mode": mode})