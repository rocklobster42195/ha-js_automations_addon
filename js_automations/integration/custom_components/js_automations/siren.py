from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.siren import (
    SirenEntity,
    SirenEntityFeature,
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
    """Set up the JS Automations siren platform."""
    connection = await async_setup_js_platform(
        hass, "siren", JSAutomationsSiren, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsSiren(JSAutomationsBaseEntity, SirenEntity):
    """Representation of a JS Automations Siren."""

    def _restore_state(self, last_state):
        """Zustand für Siren wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_is_on = last_state.state == "on"

    def update_data(self, data):
        """Update Siren spezifische Daten."""
        super().update_data(data)
        
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] in ["on", True]
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            
            if "available_tones" in attrs: self._attr_available_tones = attrs["available_tones"]
            
            # Features berechnen
            features = SirenEntityFeature.TURN_ON | SirenEntityFeature.TURN_OFF
            
            if "available_tones" in attrs:
                features |= SirenEntityFeature.TONES
            
            # Standardmäßig verfügbare Parameter-Features
            features |= SirenEntityFeature.DURATION
            features |= SirenEntityFeature.VOLUME_SET

            self._attr_supported_features = features

            # Cleanup der Extra Attributes
            managed_keys = ["available_tones"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the siren on."""
        self._fire_js_event("turn_on", kwargs)

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the siren off."""
        self._fire_js_event("turn_off")