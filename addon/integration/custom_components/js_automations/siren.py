from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.siren import (
    SirenEntity,
    SirenEntityFeature,
    ATTR_TONE,
    ATTR_DURATION,
    ATTR_VOLUME_LEVEL,
)
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

class JSAutomationsSiren(SirenEntity, RestoreEntity):
    """Representation of a JS Automations Siren."""

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._attr_is_on = False
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_on = last_state.state == "on"

    def update_data(self, data):
        """Update entity state and attributes."""
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data: self._attr_available = data[CONF_AVAILABLE]
        
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

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
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() 
                if k not in ["available_tones"]}
            
            if "available_tones" in attrs: self._attr_available_tones = attrs["available_tones"]
            
            # Determine supported features
            features = SirenEntityFeature.TURN_ON | SirenEntityFeature.TURN_OFF
            
            if "available_tones" in attrs:
                features |= SirenEntityFeature.TONES
            
            # Enable duration and volume by default as they are common parameters
            features |= SirenEntityFeature.DURATION
            features |= SirenEntityFeature.VOLUME_SET

            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the siren on."""
        data = {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_on"}
        if ATTR_TONE in kwargs: data["tone"] = kwargs[ATTR_TONE]
        if ATTR_DURATION in kwargs: data["duration"] = kwargs[ATTR_DURATION]
        if ATTR_VOLUME_LEVEL in kwargs: data["volume_level"] = kwargs[ATTR_VOLUME_LEVEL]
        self.hass.bus.async_fire(f"{DOMAIN}_event", data)

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the siren off."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_off"})