from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.cover import (
    CoverEntity,
    CoverEntityFeature,
    ATTR_POSITION,
    ATTR_TILT_POSITION,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import (
    CONF_UNIQUE_ID,
    CONF_STATE,
    CONF_DEVICE_CLASS,
    STATE_OPEN,
    STATE_CLOSED,
)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the cover platform."""

    @callback
    def async_add_cover(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsCover(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_cover", async_add_cover)
    )


class JSAutomationsCover(JSAutomationsBaseEntity, CoverEntity):
    """Representation of a JS Automations Cover."""

    def __init__(self, data):
        """Initialize the cover."""
        self._attr_is_closed = None
        self._attr_current_cover_position = None
        self._attr_current_cover_tilt_position = None
        self._attr_supported_features = (
            CoverEntityFeature.OPEN | CoverEntityFeature.CLOSE | CoverEntityFeature.STOP
        )
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_closed = last_state.state == STATE_CLOSED
            if ATTR_POSITION in last_state.attributes:
                self._attr_current_cover_position = last_state.attributes[ATTR_POSITION]
            if ATTR_TILT_POSITION in last_state.attributes:
                self._attr_current_cover_tilt_position = last_state.attributes[
                    ATTR_TILT_POSITION
                ]

    def _update_specific_state(self, data):
        """Update cover specific state."""
        if CONF_STATE in data:
            state = data[CONF_STATE]
            self._attr_is_opening = state == "opening"
            self._attr_is_closing = state == "closing"
            if state == STATE_CLOSED:
                self._attr_is_closed = True
            elif state == STATE_OPEN:
                self._attr_is_closed = False

        if CONF_DEVICE_CLASS in data:
            self._attr_device_class = data[CONF_DEVICE_CLASS]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "current_position" in attrs:
                self._attr_current_cover_position = attrs["current_position"]
                self._attr_supported_features |= CoverEntityFeature.SET_COVER_POSITION

            if "current_tilt_position" in attrs:
                self._attr_current_cover_tilt_position = attrs["current_tilt_position"]
                self._attr_supported_features |= (
                    CoverEntityFeature.OPEN_TILT
                    | CoverEntityFeature.CLOSE_TILT
                    | CoverEntityFeature.STOP_TILT
                    | CoverEntityFeature.SET_TILT_POSITION
                )

    async def async_open_cover(self, **kwargs):
        self.send_event("open_cover", kwargs)

    async def async_close_cover(self, **kwargs):
        self.send_event("close_cover", kwargs)

    async def async_stop_cover(self, **kwargs):
        self.send_event("stop_cover", kwargs)

    async def async_set_cover_position(self, **kwargs):
        self.send_event("set_cover_position", kwargs)

    async def async_open_cover_tilt(self, **kwargs):
        self.send_event("open_cover_tilt", kwargs)

    async def async_close_cover_tilt(self, **kwargs):
        self.send_event("close_cover_tilt", kwargs)

    async def async_stop_cover_tilt(self, **kwargs):
        self.send_event("stop_cover_tilt", kwargs)

    async def async_set_cover_tilt_position(self, **kwargs):
        self.send_event("set_cover_tilt_position", kwargs)