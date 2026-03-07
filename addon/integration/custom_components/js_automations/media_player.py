from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
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
    def async_add_media_player(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsMediaPlayer(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_media_player", async_add_media_player)
    )

class JSAutomationsMediaPlayer(MediaPlayerEntity, RestoreEntity):
    """Representation of a JS Automations Media Player."""

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_state = last_state.state
            if "volume_level" in last_state.attributes:
                self._attr_volume_level = last_state.attributes["volume_level"]
            if "is_volume_muted" in last_state.attributes:
                self._attr_is_volume_muted = last_state.attributes["is_volume_muted"]
            if "source" in last_state.attributes:
                self._attr_source = last_state.attributes["source"]
            if "source_list" in last_state.attributes:
                self._attr_source_list = last_state.attributes["source_list"]

    def update_data(self, data):
        """Update entity state and attributes."""
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data: self._attr_available = data[CONF_AVAILABLE]
        
        if CONF_STATE in data:
            self._attr_state = data[CONF_STATE]

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
                if k not in ["volume_level", "is_volume_muted", "source", "source_list", "media_title", "media_artist", "media_album_name", "media_content_type", "media_duration", "media_position"]}
            
            if "volume_level" in attrs: self._attr_volume_level = float(attrs["volume_level"])
            if "is_volume_muted" in attrs: self._attr_is_volume_muted = bool(attrs["is_volume_muted"])
            if "source" in attrs: self._attr_source = attrs["source"]
            if "source_list" in attrs: self._attr_source_list = attrs["source_list"]
            
            if "media_title" in attrs: self._attr_media_title = attrs["media_title"]
            if "media_artist" in attrs: self._attr_media_artist = attrs["media_artist"]
            if "media_album_name" in attrs: self._attr_media_album_name = attrs["media_album_name"]
            if "media_content_type" in attrs: self._attr_media_content_type = attrs["media_content_type"]
            if "media_duration" in attrs: self._attr_media_duration = int(attrs["media_duration"])
            if "media_position" in attrs: self._attr_media_position = int(attrs["media_position"])

            # Determine supported features
            features = 0
            # Basic features usually supported if we are a media player
            features |= MediaPlayerEntityFeature.TURN_ON | MediaPlayerEntityFeature.TURN_OFF
            features |= MediaPlayerEntityFeature.PLAY | MediaPlayerEntityFeature.PAUSE | MediaPlayerEntityFeature.STOP
            
            if "volume_level" in attrs:
                features |= MediaPlayerEntityFeature.VOLUME_SET
            if "is_volume_muted" in attrs:
                features |= MediaPlayerEntityFeature.VOLUME_MUTE
            if "source_list" in attrs:
                features |= MediaPlayerEntityFeature.SELECT_SOURCE
            
            # Enable Next/Prev by default as they are common
            features |= MediaPlayerEntityFeature.NEXT_TRACK | MediaPlayerEntityFeature.PREVIOUS_TRACK

            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self) -> None:
        """Turn the media player on."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_on"})

    async def async_turn_off(self) -> None:
        """Turn the media player off."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_off"})

    async def async_set_volume_level(self, volume: float) -> None:
        """Set volume level, range 0..1."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "set_volume_level", "volume_level": volume})

    async def async_mute_volume(self, mute: bool) -> None:
        """Mute the volume."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "mute_volume", "mute": mute})

    async def async_media_play(self) -> None:
        """Send play command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "media_play"})

    async def async_media_pause(self) -> None:
        """Send pause command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "media_pause"})

    async def async_media_stop(self) -> None:
        """Send stop command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "media_stop"})

    async def async_media_next_track(self) -> None:
        """Send next track command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "media_next_track"})

    async def async_media_previous_track(self) -> None:
        """Send previous track command."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "media_previous_track"})

    async def async_select_source(self, source: str) -> None:
        """Select input source."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "select_source", "source": source})