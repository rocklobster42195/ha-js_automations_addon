from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.vacuum import (
    VacuumEntity,
    VacuumEntityFeature,
    STATE_CLEANING,
    STATE_DOCKED,
    STATE_PAUSED,
    STATE_RETURNING,
    STATE_ERROR,
    ATTR_BATTERY_LEVEL,
    ATTR_FAN_SPEED,
    ATTR_FAN_SPEED_LIST,
    ATTR_STATUS,
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
    """Set up the vacuum platform."""

    @callback
    def async_add_vacuum(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsVacuum(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_vacuum", async_add_vacuum)
    )

class JSAutomationsVacuum(JSAutomationsBaseEntity, VacuumEntity):
    """Representation of a JS Automations Vacuum."""

    def __init__(self, data):
        """Initialize the vacuum."""
        self._attr_state = None
        self._attr_supported_features = (
            VacuumEntityFeature.START
            | VacuumEntityFeature.PAUSE
            | VacuumEntityFeature.STOP
            | VacuumEntityFeature.RETURN_HOME
            | VacuumEntityFeature.LOCATE
            | VacuumEntityFeature.CLEAN_SPOT
        )
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_state = last_state.state
            attrs = last_state.attributes
            if ATTR_BATTERY_LEVEL in attrs: self._attr_battery_level = attrs[ATTR_BATTERY_LEVEL]
            if ATTR_FAN_SPEED in attrs: self._attr_fan_speed = attrs[ATTR_FAN_SPEED]
            if ATTR_STATUS in attrs: self._attr_status = attrs[ATTR_STATUS]

    def _update_specific_state(self, data):
        """Update vacuum specific state."""
        if CONF_STATE in data:
            self._attr_state = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if ATTR_BATTERY_LEVEL in attrs: self._attr_battery_level = attrs[ATTR_BATTERY_LEVEL]
            if ATTR_FAN_SPEED in attrs:
                self._attr_fan_speed = attrs[ATTR_FAN_SPEED]
                self._attr_supported_features |= VacuumEntityFeature.FAN_SPEED
            if ATTR_FAN_SPEED_LIST in attrs: self._attr_fan_speed_list = attrs[ATTR_FAN_SPEED_LIST]
            if ATTR_STATUS in attrs: self._attr_status = attrs[ATTR_STATUS]

            # Explicit supported features override
            if "supported_features" in attrs:
                self._attr_supported_features = VacuumEntityFeature(attrs["supported_features"])

    async def async_start(self) -> None:
        """Start cleaning or resume cleaning."""
        self.send_event("start")

    async def async_pause(self) -> None:
        """Pause the vacuum cleaner."""
        self.send_event("pause")

    async def async_stop(self, **kwargs) -> None:
        """Stop the vacuum cleaner."""
        self.send_event("stop")

    async def async_return_to_base(self, **kwargs) -> None:
        """Return the vacuum cleaner to its dock."""
        self.send_event("return_to_base")

    async def async_clean_spot(self, **kwargs) -> None:
        """Clean a spot."""
        self.send_event("clean_spot")

    async def async_locate(self, **kwargs) -> None:
        """Locate the vacuum cleaner."""
        self.send_event("locate")

    async def async_set_fan_speed(self, fan_speed: str, **kwargs) -> None:
        """Set fan speed."""
        self.send_event("set_fan_speed", {"fan_speed": fan_speed})

    async def async_send_command(self, command: str, params=None, **kwargs) -> None:
        """Send a command to the vacuum cleaner."""
        self.send_event("send_command", {"command": command, "params": params, **kwargs})