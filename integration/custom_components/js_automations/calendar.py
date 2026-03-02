from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.calendar import (
    CalendarEntity,
    CalendarEvent,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE

from datetime import datetime, timedelta, timezone
import logging

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the calendar platform."""

    @callback
    def async_add_calendar(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsCalendar(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_calendar", async_add_calendar)
    )

class JSAutomationsCalendar(JSAutomationsBaseEntity, CalendarEntity):
    """Representation of a JS Automations Calendar."""

    def __init__(self, data):
        """Initialize the calendar entity."""
        self._events_cache = [] # Stores the events pushed from Node.js
        self._attr_extra_state_attributes = {} # Initialize attributes
        super().__init__(data)

    def _parse_events(self, event_data_list: list[dict]) -> list[CalendarEvent]:
        """Parse raw event data from Node.js into CalendarEvent objects."""
        events = []
        for event_data in event_data_list:
            try:
                dt_start = datetime.fromisoformat(event_data["dt_start"]).replace(tzinfo=timezone.utc)
                dt_end = datetime.fromisoformat(event_data["dt_end"]).replace(tzinfo=timezone.utc)
                events.append(
                    CalendarEvent(
                        dt_start=dt_start,
                        dt_end=dt_end,
                        summary=event_data.get("summary", "No Summary"),
                        description=event_data.get("description"),
                        location=event_data.get("location"),
                        uid=event_data.get("uid"),
                        rrule=event_data.get("rrule"),
                        recurrence_id=event_data.get("recurrence_id"),
                        all_day=event_data.get("all_day", False),
                    )
                )
            except (ValueError, KeyError) as e:
                _LOGGER.warning(f"Invalid calendar event data received for {self.entity_id}: {event_data} - {e}")
        return events

    def _update_next_event_state(self):
        """Update the entity's state based on the next upcoming event."""
        now = datetime.now(timezone.utc)
        upcoming_events = sorted([e for e in self._events_cache if e.dt_end > now], key=lambda e: e.dt_start)
        
        if upcoming_events:
            next_event = upcoming_events[0]
            self._attr_state = next_event.summary
            # Add next event details to extra_state_attributes
            self._attr_extra_state_attributes["next_event_start"] = next_event.dt_start.isoformat()
            self._attr_extra_state_attributes["next_event_end"] = next_event.dt_end.isoformat()
            self._attr_extra_state_attributes["next_event_summary"] = next_event.summary
        else:
            self._attr_state = "no_upcoming_events"
            # Remove next event details if no upcoming events
            self._attr_extra_state_attributes.pop("next_event_start", None)
            self._attr_extra_state_attributes.pop("next_event_end", None)
            self._attr_extra_state_attributes.pop("next_event_summary", None)


    def _update_specific_state(self, data):
        """Update calendar specific state."""
        if CONF_STATE in data:
            self._attr_state = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "events_cache" in attrs: # Node.js pushes the full event list
                self._events_cache = self._parse_events(attrs["events_cache"])
                self._update_next_event_state() # Update state after events cache is updated
            
            # The CalendarEntity itself does not have _attr_supported_features.
            # Support for creating/updating/deleting events is determined by the presence of the methods.

    async def async_get_events(
        self, hass: HomeAssistant, start_date: datetime, end_date: datetime
    ) -> list[CalendarEvent]:
        """Return calendar events within a datetime range from the cache."""
        # Filter events that fall within the requested range
        filtered_events = [
            event for event in self._events_cache
            if event.dt_start < end_date and event.dt_end > start_date
        ]
        return filtered_events

    async def async_create_event(self, **kwargs) -> None:
        """Create a new event."""
        self.send_event("create_event", kwargs)

    async def async_update_event(self, uid: str, **kwargs) -> None:
        """Update an existing event."""
        self.send_event("update_event", {"uid": uid, **kwargs})

    async def async_delete_event(self, uid: str, **kwargs) -> None:
        """Delete an event."""
        self.send_event("delete_event", {"uid": uid, **kwargs})

    @property
    def supported_features(self) -> int:
        """Return the list of supported features."""
        # CalendarEntity does not use CalendarEntityFeature directly.
        # Features are implicitly supported by implementing the methods.
        # For now, we'll just return 0 as it's not a standard property for CalendarEntity.
        return 0