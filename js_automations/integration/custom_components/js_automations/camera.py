import base64
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.camera import (
    Camera,
    CameraEntityFeature,
)
from homeassistant.util import dt as dt_util
from . import (
    JSAutomationsBaseEntity,
    async_setup_js_platform,
    CONF_ATTRIBUTES,
)
from homeassistant.const import CONF_STATE, STATE_IDLE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the JS Automations camera platform."""
    connection = await async_setup_js_platform(
        hass, "camera", JSAutomationsCamera, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsCamera(JSAutomationsBaseEntity, Camera):
    """Representation of a JS Automations Camera."""

    _last_image_bytes: bytes | None = None

    def _restore_state(self, last_state):
        """Zustand für Camera wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_state = last_state.state

    def update_data(self, data):
        """Update Camera Image und Status."""
        super().update_data(data)
        self._attr_state = data.get(CONF_STATE, STATE_IDLE)

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "image_data_b64" in attrs and attrs["image_data_b64"]:
                try:
                    self._last_image_bytes = base64.b64decode(attrs["image_data_b64"])
                    self._attr_image_last_updated = dt_util.utcnow()
                except (ValueError, TypeError):
                    self._last_image_bytes = None
            
            # Cleanup
            managed_keys = ["image_data_b64", "stream_source"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

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
        return self._last_image_bytes

    async def async_turn_on(self) -> None: self._fire_js_event("turn_on")
    async def async_turn_off(self) -> None: self._fire_js_event("turn_off")