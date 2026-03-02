from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
    ATTR_MEDIA_VOLUME_LEVEL,
    ATTR_MEDIA_VOLUME_MUTED,
    ATTR_MEDIA_CONTENT_ID,
    ATTR_MEDIA_CONTENT_TYPE,
    ATTR_MEDIA_DURATION,
    ATTR_MEDIA_POSITION,
    ATTR_MEDIA_POSITION_UPDATED_AT,
    ATTR_MEDIA_TITLE,
    ATTR_MEDIA_ARTIST,
    ATTR_MEDIA_ALBUM_NAME,
    ATTR_MEDIA_SERIES_TITLE,
    ATTR_MEDIA_SEASON,
    ATTR_MEDIA_EPISODE,
    ATTR_APP_ID,
    ATTR_APP_NAME,
    ATTR_INPUT_SOURCE,
    ATTR_INPUT_SOURCE_LIST,
    ATTR_SOUND_MODE,
    ATTR_SOUND_MODE_LIST,
    ATTR_MEDIA_SHUFFLE,
    ATTR_MEDIA_REPEAT,
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
    """Set up the media_player platform."""

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

class JSAutomationsMediaPlayer(JSAutomationsBaseEntity, MediaPlayerEntity):
    """Representation of a JS Automations Media Player."""

    def __init__(self, data):
        """Initialize the media player."""
        self._attr_state = MediaPlayerState.IDLE
        # Default features for a basic player
        self._attr_supported_features = (
            MediaPlayerEntityFeature.PLAY
            | MediaPlayerEntityFeature.PAUSE
            | MediaPlayerEntityFeature.STOP
            | MediaPlayerEntityFeature.TURN_ON
            | MediaPlayerEntityFeature.TURN_OFF
        )
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_state = last_state.state

    def _update_specific_state(self, data):
        """Update media player specific state."""
        if CONF_STATE in data:
            self._attr_state = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            
            # Volume
            if ATTR_MEDIA_VOLUME_LEVEL in attrs:
                self._attr_volume_level = attrs[ATTR_MEDIA_VOLUME_LEVEL]
                self._attr_supported_features |= MediaPlayerEntityFeature.VOLUME_SET
            if ATTR_MEDIA_VOLUME_MUTED in attrs:
                self._attr_is_volume_muted = attrs[ATTR_MEDIA_VOLUME_MUTED]
                self._attr_supported_features |= MediaPlayerEntityFeature.VOLUME_MUTE

            # Media Info
            if ATTR_MEDIA_CONTENT_ID in attrs: self._attr_media_content_id = attrs[ATTR_MEDIA_CONTENT_ID]
            if ATTR_MEDIA_CONTENT_TYPE in attrs: self._attr_media_content_type = attrs[ATTR_MEDIA_CONTENT_TYPE]
            if ATTR_MEDIA_DURATION in attrs: 
                self._attr_media_duration = attrs[ATTR_MEDIA_DURATION]
                self._attr_supported_features |= MediaPlayerEntityFeature.SEEK
            if ATTR_MEDIA_POSITION in attrs: self._attr_media_position = attrs[ATTR_MEDIA_POSITION]
            if ATTR_MEDIA_POSITION_UPDATED_AT in attrs: self._attr_media_position_updated_at = attrs[ATTR_MEDIA_POSITION_UPDATED_AT]
            
            if ATTR_MEDIA_TITLE in attrs: self._attr_media_title = attrs[ATTR_MEDIA_TITLE]
            if ATTR_MEDIA_ARTIST in attrs: self._attr_media_artist = attrs[ATTR_MEDIA_ARTIST]
            if ATTR_MEDIA_ALBUM_NAME in attrs: self._attr_media_album_name = attrs[ATTR_MEDIA_ALBUM_NAME]
            if ATTR_MEDIA_SERIES_TITLE in attrs: self._attr_media_series_title = attrs[ATTR_MEDIA_SERIES_TITLE]
            if ATTR_MEDIA_SEASON in attrs: self._attr_media_season = attrs[ATTR_MEDIA_SEASON]
            if ATTR_MEDIA_EPISODE in attrs: self._attr_media_episode = attrs[ATTR_MEDIA_EPISODE]
            
            if ATTR_APP_ID in attrs: self._attr_app_id = attrs[ATTR_APP_ID]
            if ATTR_APP_NAME in attrs: self._attr_app_name = attrs[ATTR_APP_NAME]

            # Source
            if ATTR_INPUT_SOURCE in attrs: self._attr_source = attrs[ATTR_INPUT_SOURCE]
            if ATTR_INPUT_SOURCE_LIST in attrs:
                self._attr_source_list = attrs[ATTR_INPUT_SOURCE_LIST]
                self._attr_supported_features |= MediaPlayerEntityFeature.SELECT_SOURCE

            # Sound Mode
            if ATTR_SOUND_MODE in attrs: self._attr_sound_mode = attrs[ATTR_SOUND_MODE]
            if ATTR_SOUND_MODE_LIST in attrs:
                self._attr_sound_mode_list = attrs[ATTR_SOUND_MODE_LIST]
                self._attr_supported_features |= MediaPlayerEntityFeature.SELECT_SOUND_MODE

            # Shuffle / Repeat
            if ATTR_MEDIA_SHUFFLE in attrs:
                self._attr_shuffle = attrs[ATTR_MEDIA_SHUFFLE]
                self._attr_supported_features |= MediaPlayerEntityFeature.SHUFFLE_SET
            if ATTR_MEDIA_REPEAT in attrs:
                self._attr_repeat = attrs[ATTR_MEDIA_REPEAT]
                self._attr_supported_features |= MediaPlayerEntityFeature.REPEAT_SET

            # Explicit supported features override
            if "supported_features" in attrs:
                self._attr_supported_features = MediaPlayerEntityFeature(attrs["supported_features"])

    async def async_turn_on(self) -> None:
        self.send_event("turn_on")

    async def async_turn_off(self) -> None:
        self.send_event("turn_off")

    async def async_set_volume_level(self, volume: float) -> None:
        self.send_event("set_volume_level", {"volume_level": volume})

    async def async_mute_volume(self, mute: bool) -> None:
        self.send_event("mute_volume", {"mute": mute})

    async def async_media_play(self) -> None:
        self.send_event("media_play")

    async def async_media_pause(self) -> None:
        self.send_event("media_pause")

    async def async_media_stop(self) -> None:
        self.send_event("media_stop")

    async def async_media_next_track(self) -> None:
        self.send_event("media_next_track")

    async def async_media_previous_track(self) -> None:
        self.send_event("media_previous_track")

    async def async_media_seek(self, position: float) -> None:
        self.send_event("media_seek", {"position": position})

    async def async_play_media(self, media_type: str, media_id: str, **kwargs) -> None:
        self.send_event("play_media", {"media_type": media_type, "media_id": media_id, **kwargs})

    async def async_select_source(self, source: str) -> None:
        self.send_event("select_source", {"source": source})

    async def async_select_sound_mode(self, sound_mode: str) -> None:
        self.send_event("select_sound_mode", {"sound_mode": sound_mode})

    async def async_set_shuffle(self, shuffle: bool) -> None:
        self.send_event("set_shuffle", {"shuffle": shuffle})

    async def async_set_repeat(self, repeat: str) -> None:
        self.send_event("set_repeat", {"repeat": repeat})