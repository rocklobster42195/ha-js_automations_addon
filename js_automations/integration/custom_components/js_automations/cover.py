from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.cover import (
    CoverEntity,
    CoverEntityFeature,
    ATTR_POSITION,
    ATTR_TILT_POSITION,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE, CONF_DEVICE_CLASS

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
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

class JSAutomationsCover(CoverEntity, RestoreEntity):
    """Representation of a JS Automations Cover."""

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._attr_is_closed = False
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_closed = last_state.state == "closed"
            if "current_position" in last_state.attributes:
                self._attr_current_cover_position = last_state.attributes["current_position"]
            if "current_tilt_position" in last_state.attributes:
                self._attr_current_cover_tilt_position = last_state.attributes["current_tilt_position"]

    def update_data(self, data):
        """Update entity state and attributes."""
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data: self._attr_available = data[CONF_AVAILABLE]
        if CONF_DEVICE_CLASS in data: self._attr_device_class = data[CONF_DEVICE_CLASS]
        
        if CONF_STATE in data:
            state = data[CONF_STATE]
            if state == "closed":
                self._attr_is_closed = True
                self._attr_is_opening = False
                self._attr_is_closing = False
            elif state == "open":
                self._attr_is_closed = False
                self._attr_is_opening = False
                self._attr_is_closing = False
            elif state == "opening":
                self._attr_is_closed = False
                self._attr_is_opening = True
                self._attr_is_closing = False
            elif state == "closing":
                self._attr_is_closed = False
                self._attr_is_opening = False
                self._attr_is_closing = True
            else:
                # Fallback for boolean or other states
                self._attr_is_closed = state == "closed" or state is False

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
                if k not in ["current_position", "current_tilt_position"]}
            
            if "current_position" in attrs: 
                self._attr_current_cover_position = int(attrs["current_position"])
            if "current_tilt_position" in attrs: 
                self._attr_current_cover_tilt_position = int(attrs["current_tilt_position"])
            
            # Determine supported features
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
        """Open the cover."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "open_cover"})

    async def async_close_cover(self, **kwargs):
        """Close the cover."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "close_cover"})

    async def async_stop_cover(self, **kwargs):
        """Stop the cover."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "stop_cover"})

    async def async_set_cover_position(self, **kwargs):
        """Move the cover to a specific position."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id, 
            "unique_id": self._attr_unique_id, 
            "action": "set_cover_position",
            "position": kwargs[ATTR_POSITION]
        })

    async def async_open_cover_tilt(self, **kwargs):
        """Open the cover tilt."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "open_cover_tilt"})

    async def async_close_cover_tilt(self, **kwargs):
        """Close the cover tilt."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "close_cover_tilt"})

    async def async_stop_cover_tilt(self, **kwargs):
        """Stop the cover tilt."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "stop_cover_tilt"})

    async def async_set_cover_tilt_position(self, **kwargs):
        """Move the cover tilt to a specific position."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id, 
            "unique_id": self._attr_unique_id, 
            "action": "set_cover_tilt_position",
            "tilt_position": kwargs[ATTR_TILT_POSITION]
        })