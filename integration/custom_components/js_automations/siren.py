from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.siren import (
    SirenEntity,
    SirenEntityFeature,
    ATTR_VOLUME_LEVEL,
    ATTR_TONE,
    ATTR_DURATION,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the siren platform."""

    @callback
    def async_add_siren(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsSiren(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_siren", async_add_siren)
    )

class JSAutomationsSiren(JSAutomationsBaseEntity, SirenEntity):
    """Representation of a JS Automations Siren."""

    def __init__(self, data):
        """Initialize the siren."""
        self._attr_is_on = False
        self._attr_supported_features = SirenEntityFeature.TURN_ON | SirenEntityFeature.TURN_OFF
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_on = last_state.state == "on"
            attrs = last_state.attributes
            if ATTR_VOLUME_LEVEL in attrs: self._attr_volume_level = attrs[ATTR_VOLUME_LEVEL]
            if ATTR_TONE in attrs: self._attr_tone = attrs[ATTR_TONE]
            if ATTR_DURATION in attrs: self._attr_duration = attrs[ATTR_DURATION]

    def _update_specific_state(self, data):
        """Update siren specific state."""
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if ATTR_VOLUME_LEVEL in attrs:
                self._attr_volume_level = attrs[ATTR_VOLUME_LEVEL]
                self._attr_supported_features |= SirenEntityFeature.VOLUME_SET
            if ATTR_TONE in attrs:
                self._attr_tone = attrs[ATTR_TONE]
                self._attr_supported_features |= SirenEntityFeature.TONES
            if "available_tones" in attrs:
                self._attr_available_tones = attrs["available_tones"]
                self._attr_supported_features |= SirenEntityFeature.TONES
            if ATTR_DURATION in attrs:
                self._attr_duration = attrs[ATTR_DURATION]
                self._attr_supported_features |= SirenEntityFeature.DURATION
            if "supported_features" in attrs:
                self._attr_supported_features = SirenEntityFeature(attrs["supported_features"])

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the siren on."""
        self.send_event("turn_on", kwargs)

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the siren off."""
        self.send_event("turn_off", kwargs)

    async def async_set_volume(self, volume: float) -> None:
        """Set siren volume."""
        self.send_event("set_volume", {"volume": volume})

    async def async_set_tone(self, tone: str) -> None:
        """Set siren tone."""
        self.send_event("set_tone", {"tone": tone})

    async def async_set_duration(self, duration: int) -> None:
        """Set siren duration."""
        self.send_event("set_duration", {"duration": duration})