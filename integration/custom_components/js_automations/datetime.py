from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.datetime import DateTimeEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE

from datetime import datetime, timezone
import logging

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the datetime platform."""

    @callback
    def async_add_datetime(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsDateTime(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_datetime", async_add_datetime)
    )

class JSAutomationsDateTime(JSAutomationsBaseEntity, DateTimeEntity):
    """Representation of a JS Automations DateTime entity."""

    def __init__(self, data):
        """Initialize the datetime entity."""
        self._attr_native_value = None
        super().__init__(data)

    def _update_specific_state(self, data):
        """Update datetime specific state."""
        if CONF_STATE in data and data[CONF_STATE] is not None:
            try:
                # Ensure timezone awareness for datetime objects
                self._attr_native_value = datetime.fromisoformat(str(data[CONF_STATE])).replace(tzinfo=timezone.utc)
            except ValueError:
                _LOGGER.warning(f"Invalid datetime format received for {self.entity_id}: {data[CONF_STATE]}")
                self._attr_native_value = None
        else:
            self._attr_native_value = None

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "min" in attrs:
                try: self._attr_native_min = datetime.fromisoformat(attrs["min"]).replace(tzinfo=timezone.utc)
                except ValueError: _LOGGER.warning(f"Invalid min datetime format for {self.entity_id}: {attrs['min']}")
            if "max" in attrs:
                try: self._attr_native_max = datetime.fromisoformat(attrs["max"]).replace(tzinfo=timezone.utc)
                except ValueError: _LOGGER.warning(f"Invalid max datetime format for {self.entity_id}: {attrs['max']}")

    async def async_set_value(self, value: datetime) -> None:
        """Set new datetime."""
        self.send_event("set_value", value.isoformat())