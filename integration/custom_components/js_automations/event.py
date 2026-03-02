from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.event import EventEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE
from datetime import datetime, timezone

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the event platform."""

    @callback
    def async_add_event(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsEvent(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_event", async_add_event)
    )

class JSAutomationsEvent(JSAutomationsBaseEntity, EventEntity):
    """Representation of a JS Automations Event."""

    def __init__(self, data):
        """Initialize the event entity."""
        # The event_type is a required attribute for EventEntity
        # It can be passed via data or default to "triggered"
        self._attr_event_type = data.get("event_type", "triggered")
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state and last_state.state != "unknown" and last_state.state != "unavailable":
            try:
                # Restore last_triggered from the state if it was a datetime string
                self._attr_last_triggered = datetime.fromisoformat(last_state.state).replace(tzinfo=timezone.utc)
            except ValueError:
                # Not a valid datetime string, ignore
                pass

    def _update_specific_state(self, data):
        """Update event specific state."""
        # For event entities, CONF_STATE can be used to update last_triggered
        if CONF_STATE in data and data[CONF_STATE] is not None:
            try:
                self._attr_last_triggered = datetime.fromisoformat(str(data[CONF_STATE])).replace(tzinfo=timezone.utc)
            except ValueError:
                # If CONF_STATE is not a datetime, it might be a custom event type or just ignored
                pass

    async def async_trigger(self, **kwargs) -> None:
        """Trigger the event."""
        self.send_event("trigger", kwargs)