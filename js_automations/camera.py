import base64

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.camera import (
    Camera,
    CameraEntityFeature,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.util import dt as dt_util

from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE, async_format_device_info
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE, STATE_IDLE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_camera(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsCamera(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_camera", async_add_camera)
    )

class JSAutomationsCamera(Camera):
    """Representation of a JS Automations Camera that receives images via service calls."""

    def __init__(self, data):
        """Initialize the camera."""
        super().__init__()
        self.entity_id = data["entity_id"]
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._last_image_bytes: bytes | None = None
        self.update_data(data)

    def update_data(self, data):
        """Update entity state and attributes from a service call."""
        self._attr_name = data.get(CONF_NAME, self._attr_name)
        self._attr_icon = data.get(CONF_ICON, self._attr_icon)
        self._attr_available = data.get(CONF_AVAILABLE, self._attr_available)
        
        # Camera state can be 'streaming', 'recording', 'idle'
        self._attr_state = data.get(CONF_STATE, STATE_IDLE)

        device_info = async_format_device_info(data)
        if device_info: self._attr_device_info = device_info
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() 
                if k not in ["image_data_b64", "stream_source"]}
            
            if "image_data_b64" in attrs and attrs["image_data_b64"]:
                try:
                    self._last_image_bytes = base64.b64decode(attrs["image_data_b64"])
                    self._attr_image_last_updated = dt_util.utcnow()
                except (ValueError, TypeError):
                    self._last_image_bytes = None
            
            # Support for streaming
            features = CameraEntityFeature.TURN_ON | CameraEntityFeature.TURN_OFF
            if "stream_source" in attrs and attrs["stream_source"]:
                self._attr_stream_source = attrs["stream_source"]
                features |= CameraEntityFeature.STREAM
            
            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Return the last received image."""
        return self._last_image_bytes

    async def async_turn_on(self) -> None:
        """Turn the camera on."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_on"})

    async def async_turn_off(self) -> None:
        """Turn the camera off."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_off"})