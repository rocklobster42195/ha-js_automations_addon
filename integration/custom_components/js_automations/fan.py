from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.fan import (
    FanEntity,
    FanEntityFeature,
    ATTR_PERCENTAGE,
    ATTR_PRESET_MODE,
    ATTR_OSCILLATING,
    ATTR_DIRECTION,
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
    """Set up the fan platform."""

    @callback
    def async_add_fan(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsFan(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_fan", async_add_fan)
    )

class JSAutomationsFan(JSAutomationsBaseEntity, FanEntity):
    """Representation of a JS Automations Fan."""

    def __init__(self, data):
        """Initialize the fan."""
        self._attr_is_on = False
        self._attr_supported_features = FanEntityFeature(0)
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_on = last_state.state == "on"
            if ATTR_PERCENTAGE in last_state.attributes: self._attr_percentage = last_state.attributes[ATTR_PERCENTAGE]
            if ATTR_PRESET_MODE in last_state.attributes: self._attr_preset_mode = last_state.attributes[ATTR_PRESET_MODE]
            if ATTR_OSCILLATING in last_state.attributes: self._attr_oscillating = last_state.attributes[ATTR_OSCILLATING]
            if ATTR_DIRECTION in last_state.attributes: self._attr_direction = last_state.attributes[ATTR_DIRECTION]

    def _update_specific_state(self, data):
        """Update fan specific state."""
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "percentage" in attrs:
                self._attr_percentage = attrs["percentage"]
                self._attr_supported_features |= FanEntityFeature.SET_SPEED
            if "preset_modes" in attrs:
                self._attr_preset_modes = attrs["preset_modes"]
                self._attr_supported_features |= FanEntityFeature.PRESET_MODE
            if "preset_mode" in attrs: self._attr_preset_mode = attrs["preset_mode"]
            if "oscillating" in attrs:
                self._attr_oscillating = attrs["oscillating"]
                self._attr_supported_features |= FanEntityFeature.OSCILLATE
            if "direction" in attrs:
                self._attr_direction = attrs["direction"]
                self._attr_supported_features |= FanEntityFeature.DIRECTION

    async def async_turn_on(self, **kwargs):
        self.send_event("turn_on", kwargs)

    async def async_turn_off(self, **kwargs):
        self.send_event("turn_off", kwargs)

    async def async_set_percentage(self, percentage: int) -> None:
        self.send_event("set_percentage", {"percentage": percentage})

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        self.send_event("set_preset_mode", {"preset_mode": preset_mode})

    async def async_oscillate(self, oscillating: bool) -> None:
        self.send_event("oscillate", {"oscillating": oscillating})

    async def async_set_direction(self, direction: str) -> None:
        self.send_event("set_direction", {"direction": direction})