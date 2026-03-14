from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.fan import (
    FanEntity,
    FanEntityFeature,
    ATTR_PERCENTAGE,
    ATTR_PRESET_MODE,
    ATTR_OSCILLATING,
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
    """Set up the JS Automations fan platform."""
    connection = await async_setup_js_platform(
        hass, "fan", JSAutomationsFan, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsFan(JSAutomationsBaseEntity, FanEntity):
    """Representation of a JS Automations Fan."""

    def _restore_state(self, last_state):
        """Zustand für Fan wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_is_on = last_state.state == "on"
        attrs = last_state.attributes
        self._attr_percentage = attrs.get("percentage")
        self._attr_preset_mode = attrs.get("preset_mode")
        self._attr_oscillating = attrs.get("oscillating")

    def update_data(self, data):
        """Update Fan spezifische Daten."""
        super().update_data(data)
        
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] in ["on", True]
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            
            if "percentage" in attrs: self._attr_percentage = int(attrs["percentage"])
            if "preset_mode" in attrs: self._attr_preset_mode = attrs["preset_mode"]
            if "preset_modes" in attrs: self._attr_preset_modes = attrs["preset_modes"]
            if "oscillating" in attrs: self._attr_oscillating = bool(attrs["oscillating"])
            
            # Features berechnen
            features = 0
            if "percentage" in attrs: features |= FanEntityFeature.SET_SPEED
            if "preset_modes" in attrs: features |= FanEntityFeature.PRESET_MODE
            if "oscillating" in attrs: features |= FanEntityFeature.OSCILLATE
            
            self._attr_supported_features = features

            # Cleanup der Extra Attributes
            managed_keys = ["percentage", "preset_mode", "preset_modes", "oscillating"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self, percentage: int | None = None, preset_mode: str | None = None, **kwargs) -> None:
        """Turn the fan on."""
        data = {}
        if percentage is not None:
            data["percentage"] = percentage
        if preset_mode is not None:
            data["preset_mode"] = preset_mode
        self._fire_js_event("turn_on", data)

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the fan off."""
        self._fire_js_event("turn_off")

    async def async_set_percentage(self, percentage: int) -> None:
        """Set the speed of the fan."""
        self._fire_js_event("set_percentage", {"percentage": percentage})

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Set the preset mode of the fan."""
        self._fire_js_event("set_preset_mode", {"preset_mode": preset_mode})

    async def async_oscillate(self, oscillating: bool) -> None:
        """Set oscillation."""
        self._fire_js_event("oscillate", {"oscillating": oscillating})