from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.camera import (
    CameraEntity,
    CameraEntityFeature,
    ATTR_MOTION_DETECTION_ENABLED,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE

import logging

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the camera platform."""

    @callback
    def async_add_camera(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsCamera(hass, data) # Pass hass to entity for aiohttp_client
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_camera", async_add_camera)
    )

class JSAutomationsCamera(JSAutomationsBaseEntity, CameraEntity):
    """Representation of a JS Automations Camera."""

    def __init__(self, hass: HomeAssistant, data):
        """Initialize the camera."""
        self._hass = hass # Store hass for aiohttp_client
        self._attr_is_on = False
        self._attr_is_recording = False
        self._attr_is_streaming = False
        self._attr_motion_detection_enabled = False
        self._attr_image_url = None # URL to fetch the image from
        self._attr_supported_features = CameraEntityFeature.ON_OFF # Default minimal features
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_on = last_state.state == "on"
            attrs = last_state.attributes
            if ATTR_MOTION_DETECTION_ENABLED in attrs:
                self._attr_motion_detection_enabled = attrs[ATTR_MOTION_DETECTION_ENABLED]
            if "is_recording" in attrs: self._attr_is_recording = attrs["is_recording"]
            if "is_streaming" in attrs: self._attr_is_streaming = attrs["is_streaming"]
            if "image_url" in attrs: self._attr_image_url = attrs["image_url"]

    def _update_specific_state(self, data):
        """Update camera specific state."""
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if ATTR_MOTION_DETECTION_ENABLED in attrs:
                self._attr_motion_detection_enabled = attrs[ATTR_MOTION_DETECTION_ENABLED]
                self._attr_supported_features |= CameraEntityFeature.MOTION_DETECTION
            if "is_recording" in attrs: self._attr_is_recording = attrs["is_recording"]
            if "is_streaming" in attrs:
                self._attr_is_streaming = attrs["is_streaming"]
                self._attr_supported_features |= CameraEntityFeature.STREAM
            if "image_url" in attrs: self._attr_image_url = attrs["image_url"]
            if "supported_features" in attrs:
                self._attr_supported_features = CameraEntityFeature(attrs["supported_features"])

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Return a still image response from the camera."""
        if not self._attr_image_url:
            _LOGGER.warning(f"No image_url provided for camera {self.entity_id}")
            return None

        try:
            session = async_get_clientsession(self._hass)
            async with session.get(self._attr_image_url) as response:
                response.raise_for_status()
                return await response.read()
        except Exception as e:
            _LOGGER.error(f"Error fetching camera image from {self._attr_image_url}: {e}")
            return None

    async def async_enable_motion_detection(self) -> None:
        """Enable motion detection."""
        self.send_event("enable_motion_detection")

    async def async_disable_motion_detection(self) -> None:
        """Disable motion detection."""
        self.send_event("disable_motion_detection")

    async def async_turn_on(self) -> None:
        """Turn on camera."""
        self.send_event("turn_on")

    async def async_turn_off(self) -> None:
        """Turn off camera."""
        self.send_event("turn_off")

    async def async_snapshot(self, filename: str) -> None:
        """Take a snapshot."""
        self.send_event("snapshot", {"filename": filename})

    async def async_stream_source(self) -> str | None:
        """Return the stream source."""
        # Node.js should provide 'stream_source' in attributes if streaming is supported
        if self._attr_supported_features & CameraEntityFeature.STREAM and self._attr_extra_state_attributes and "stream_source" in self._attr_extra_state_attributes:
            return self._attr_extra_state_attributes["stream_source"]
        return None