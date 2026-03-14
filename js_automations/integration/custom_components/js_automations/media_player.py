from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
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
    """Set up the JS Automations media player platform."""
    connection = await async_setup_js_platform(
        hass, "media_player", JSAutomationsMediaPlayer, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsMediaPlayer(JSAutomationsBaseEntity, MediaPlayerEntity):
    """Representation of a JS Automations Media Player."""

    def _restore_state(self, last_state):
        """Zustand für Media Player wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_state = last_state.state
        attrs = last_state.attributes
        self._attr_volume_level = attrs.get("volume_level")
        self._attr_is_volume_muted = attrs.get("is_volume_muted")
        self._attr_source = attrs.get("source")
        self._attr_source_list = attrs.get("source_list")

    def update_data(self, data):
        """Update Media Player spezifische Daten."""
        super().update_data(data)
        
        if CONF_STATE in data:
            self._attr_state = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
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

            # Features berechnen
            features = (
                MediaPlayerEntityFeature.TURN_ON 
                | MediaPlayerEntityFeature.TURN_OFF
                | MediaPlayerEntityFeature.PLAY 
                | MediaPlayerEntityFeature.PAUSE 
                | MediaPlayerEntityFeature.STOP
                | MediaPlayerEntityFeature.NEXT_TRACK 
                | MediaPlayerEntityFeature.PREVIOUS_TRACK
            )
            
            if "volume_level" in attrs: features |= MediaPlayerEntityFeature.VOLUME_SET
            if "is_volume_muted" in attrs: features |= MediaPlayerEntityFeature.VOLUME_MUTE
            if "source_list" in attrs: features |= MediaPlayerEntityFeature.SELECT_SOURCE
            
            self._attr_supported_features = features

            # Cleanup der Extra Attributes
            managed_keys = [
                "volume_level", "is_volume_muted", "source", "source_list",
                "media_title", "media_artist", "media_album_name", 
                "media_content_type", "media_duration", "media_position"
            ]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self) -> None: self._fire_js_event("turn_on")
    async def async_turn_off(self) -> None: self._fire_js_event("turn_off")

    async def async_set_volume_level(self, volume: float) -> None:
        self._fire_js_event("set_volume_level", {"volume_level": volume})

    async def async_mute_volume(self, mute: bool) -> None:
        self._fire_js_event("mute_volume", {"mute": mute})

    async def async_media_play(self) -> None: self._fire_js_event("media_play")
    async def async_media_pause(self) -> None: self._fire_js_event("media_pause")
    async def async_media_stop(self) -> None: self._fire_js_event("media_stop")
    async def async_media_next_track(self) -> None: self._fire_js_event("media_next_track")
    async def async_media_previous_track(self) -> None: self._fire_js_event("media_previous_track")

    async def async_select_source(self, source: str) -> None:
        self._fire_js_event("select_source", {"source": source})