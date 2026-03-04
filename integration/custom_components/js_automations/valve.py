from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.valve import (
    ValveEntity,
    ValveEntityFeature,
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
    def async_add_valve(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsValve(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_valve", async_add_valve)
    )

class JSAutomationsValve(ValveEntity, RestoreEntity):
    """Representation of a JS Automations Valve."""

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
                self._attr_current_valve_position = last_state.attributes["current_position"]

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
                if k not in ["current_position"]}
            
            if "current_position" in attrs: 
                self._attr_current_valve_position = int(attrs["current_position"])
            
            # Determine supported features
            features = ValveEntityFeature.OPEN | ValveEntityFeature.CLOSE | ValveEntityFeature.STOP
            
            if "current_position" in attrs:
                features |= ValveEntityFeature.SET_POSITION
            
            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_open_valve(self, **kwargs) -> None:
        """Open the valve."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "open_valve"})

    async def async_close_valve(self, **kwargs) -> None:
        """Close the valve."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "close_valve"})

    async def async_stop_valve(self, **kwargs) -> None:
        """Stop the valve."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "stop_valve"})

    async def async_set_valve_position(self, position: int) -> None:
        """Set the valve position."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "set_valve_position", "position": position})