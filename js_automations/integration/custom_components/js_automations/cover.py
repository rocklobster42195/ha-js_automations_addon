from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.cover import (
    CoverEntity,
    CoverEntityFeature,
    ATTR_POSITION,
    ATTR_TILT_POSITION,
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
    """Set up the JS Automations cover platform."""
    connection = await async_setup_js_platform(
        hass, "cover", JSAutomationsCover, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsCover(JSAutomationsBaseEntity, CoverEntity):
    """Representation of a JS Automations Cover."""

    def _restore_state(self, last_state):
        """Zustand für Cover wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_is_closed = last_state.state == "closed"
        attrs = last_state.attributes
        self._attr_current_cover_position = attrs.get("current_position")
        self._attr_current_cover_tilt_position = attrs.get("current_tilt_position")

    def update_data(self, data):
        """Update Cover spezifische Daten."""
        super().update_data(data)

        if CONF_STATE in data:
            state = data[CONF_STATE]
            self._attr_is_opening = state == "opening"
            self._attr_is_closing = state == "closing"
            self._attr_is_closed = state == "closed" or state is False

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "current_position" in attrs: self._attr_current_cover_position = int(attrs["current_position"])
            if "current_tilt_position" in attrs: self._attr_current_cover_tilt_position = int(attrs["current_tilt_position"])

            # Bereinigen der Extra Attributes
            managed_keys = ["current_position", "current_tilt_position"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

            # Features
            features = (
                CoverEntityFeature.OPEN 
                | CoverEntityFeature.CLOSE 
                | CoverEntityFeature.STOP
            )

            if "current_position" in attrs:
                features |= CoverEntityFeature.SET_POSITION
            
            if "current_tilt_position" in attrs:
                features |= (
                    CoverEntityFeature.OPEN_TILT
                    | CoverEntityFeature.CLOSE_TILT
                    | CoverEntityFeature.STOP_TILT
                    | CoverEntityFeature.SET_TILT_POSITION
                )

            self._attr_supported_features = features
            if self.hass:
                self.async_write_ha_state()

    async def async_open_cover(self, **kwargs):
        self._attr_is_opening = True
        self._attr_is_closing = False
        self._attr_is_closed = False
        self.async_write_ha_state()
        self._fire_js_event("open_cover")
    async def async_close_cover(self, **kwargs):
        self._attr_is_closing = True
        self._attr_is_opening = False
        self.async_write_ha_state()
        self._fire_js_event("close_cover")
    async def async_stop_cover(self, **kwargs):
        self._attr_is_opening = False
        self._attr_is_closing = False
        self.async_write_ha_state()
        self._fire_js_event("stop_cover")
    async def async_set_cover_position(self, **kwargs):
        self._attr_current_cover_position = kwargs[ATTR_POSITION]
        self.async_write_ha_state()
        self._fire_js_event("set_cover_position", {"position": kwargs[ATTR_POSITION]})
    async def async_open_cover_tilt(self, **kwargs):
        self._attr_current_cover_tilt_position = 100
        self.async_write_ha_state()
        self._fire_js_event("open_cover_tilt")
    async def async_close_cover_tilt(self, **kwargs):
        self._attr_current_cover_tilt_position = 0
        self.async_write_ha_state()
        self._fire_js_event("close_cover_tilt")
    async def async_stop_cover_tilt(self, **kwargs):
        self.async_write_ha_state()
        self._fire_js_event("stop_cover_tilt")
    async def async_set_cover_tilt_position(self, **kwargs):
        self._attr_current_cover_tilt_position = kwargs[ATTR_TILT_POSITION]
        self.async_write_ha_state()
        self._fire_js_event("set_cover_tilt_position", {"tilt_position": kwargs[ATTR_TILT_POSITION]})