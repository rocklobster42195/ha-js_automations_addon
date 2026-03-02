from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.lawn_mower import (
    LawnMowerEntity,
    LawnMowerEntityFeature,
    LawnMowerActivity,
    ATTR_ACTIVITY,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE, ATTR_BATTERY_LEVEL

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the lawn_mower platform."""

    @callback
    def async_add_lawn_mower(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsLawnMower(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_lawn_mower", async_add_lawn_mower)
    )

class JSAutomationsLawnMower(JSAutomationsBaseEntity, LawnMowerEntity):
    """Representation of a JS Automations Lawn Mower."""

    def __init__(self, data):
        """Initialize the lawn mower."""
        self._attr_activity = LawnMowerActivity.IDLE
        self._attr_supported_features = (
            LawnMowerEntityFeature.START
            | LawnMowerEntityFeature.PAUSE
            | LawnMowerEntityFeature.RETURN_HOME
        )
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            if ATTR_ACTIVITY in last_state.attributes:
                try:
                    self._attr_activity = LawnMowerActivity(last_state.attributes[ATTR_ACTIVITY])
                except ValueError:
                    _LOGGER.warning(f"Invalid activity '{last_state.attributes[ATTR_ACTIVITY]}' for lawn mower {self.entity_id}")
            if ATTR_BATTERY_LEVEL in last_state.attributes:
                self._attr_battery_level = last_state.attributes[ATTR_BATTERY_LEVEL]

    def _update_specific_state(self, data):
        """Update lawn mower specific state."""
        if CONF_STATE in data:
            # The state of a lawn mower entity is its activity
            try:
                self._attr_activity = LawnMowerActivity(data[CONF_STATE])
            except ValueError:
                _LOGGER.warning(f"Invalid activity '{data[CONF_STATE]}' received for lawn mower {self.entity_id}")
                self._attr_activity = LawnMowerActivity.ERROR # Set to error if state is invalid

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if ATTR_BATTERY_LEVEL in attrs:
                self._attr_battery_level = attrs[ATTR_BATTERY_LEVEL]
            if "supported_features" in attrs:
                self._attr_supported_features = LawnMowerEntityFeature(attrs["supported_features"])

    async def async_start_mowing(self) -> None:
        """Start mowing."""
        self.send_event("start_mowing")

    async def async_pause(self) -> None:
        """Pause the lawn mower."""
        self.send_event("pause")

    async def async_return_to_base(self) -> None:
        """Return the lawn mower to its base."""
        self.send_event("return_to_base")

    async def async_dock(self) -> None:
        """Dock the lawn mower."""
        # Home Assistant's lawn_mower component does not have a separate 'dock' service,
        # it's usually part of 'return_to_base'. If a specific 'dock' action is needed
        # that differs from 'return_to_base', it would be a custom service.
        # For now, we map it to return_to_base.
        self.send_event("dock")

    async def async_set_activity(self, activity: LawnMowerActivity) -> None:
        """Set the activity of the lawn mower."""
        self.send_event("set_activity", {"activity": activity.value})