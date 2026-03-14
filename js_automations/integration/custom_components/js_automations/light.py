from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.light import (
    LightEntity,
    LightEntityFeature,
    ColorMode,
    ATTR_BRIGHTNESS,
    ATTR_RGB_COLOR,
    ATTR_EFFECT,
    ATTR_COLOR_TEMP_KELVIN,
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
    """Set up the JS Automations light platform."""
    connection = await async_setup_js_platform(
        hass, "light", JSAutomationsLight, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsLight(JSAutomationsBaseEntity, LightEntity):
    """Representation of a JS Automations Light."""

    _attr_color_mode = ColorMode.UNKNOWN
    _attr_supported_color_modes = {ColorMode.ONOFF}

    def _restore_state(self, last_state):
        """Zustand für Licht wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_is_on = last_state.state == "on"
        attrs = last_state.attributes
        self._attr_brightness = attrs.get(ATTR_BRIGHTNESS)
        self._attr_rgb_color = attrs.get(ATTR_RGB_COLOR)
        self._attr_color_temp_kelvin = attrs.get(ATTR_COLOR_TEMP_KELVIN)
        self._attr_effect = attrs.get(ATTR_EFFECT)
        self._attr_color_mode = attrs.get("color_mode", ColorMode.ONOFF)
        if "supported_color_modes" in attrs:
            self._attr_supported_color_modes = set(attrs["supported_color_modes"])

    def update_data(self, data):
        """Update Licht spezifische Daten und Farbmodi."""
        super().update_data(data)

        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] in ["on", True]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            
            # 1. Native Properties extrahieren
            if "brightness" in attrs: self._attr_brightness = int(attrs["brightness"])
            if "rgb_color" in attrs: self._attr_rgb_color = tuple(attrs["rgb_color"])
            if "color_temp_kelvin" in attrs: self._attr_color_temp_kelvin = int(attrs["color_temp_kelvin"])
            if "effect" in attrs: self._attr_effect = attrs["effect"]
            if "effect_list" in attrs: self._attr_effect_list = attrs["effect_list"]
            
            # 2. Bereinigen der Extra Attributes
            managed_keys = [
                "brightness", "rgb_color", "color_temp_kelvin", 
                "effect", "effect_list", "supported_color_modes"
            ]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

            # 3. Features & Farbmodi berechnen
            supported_features = 0
            modes = {ColorMode.ONOFF}

            if "effect_list" in attrs:
                supported_features |= LightEntityFeature.EFFECT
            
            if "supported_color_modes" in attrs:
                modes = set(attrs["supported_color_modes"])
            else:
                # Automatisches Erkennen der Modi, falls nicht explizit definiert
                if "rgb_color" in attrs: modes.add(ColorMode.RGB)
                if "color_temp_kelvin" in attrs: modes.add(ColorMode.COLOR_TEMP)
                if "brightness" in attrs and len(modes) == 1: modes.add(ColorMode.BRIGHTNESS)

            self._attr_supported_features = supported_features
            self._attr_supported_color_modes = modes

            # Aktuellen Farbmodus bestimmen
            if "rgb_color" in attrs:
                self._attr_color_mode = ColorMode.RGB
            elif "color_temp_kelvin" in attrs:
                self._attr_color_mode = ColorMode.COLOR_TEMP
            elif "brightness" in attrs:
                self._attr_color_mode = ColorMode.BRIGHTNESS
            else:
                self._attr_color_mode = ColorMode.ONOFF

            if self.hass:
                self.async_write_ha_state()

    async def async_turn_on(self, **kwargs):
        """Turn the entity on."""
        self._fire_js_event("turn_on", kwargs)

    async def async_turn_off(self, **kwargs):
        """Turn the entity off."""
        self._fire_js_event("turn_off")