from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.time import TimeEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE

from datetime import time, timedelta
import logging

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the time platform."""

    @callback
    def async_add_time(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsTime(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_time", async_add_time)
    )

class JSAutomationsTime(JSAutomationsBaseEntity, TimeEntity):
    """Representation of a JS Automations Time entity."""

    def __init__(self, data):
        """Initialize the time entity."""
        self._attr_native_value = None
        super().__init__(data)

    def _update_specific_state(self, data):
        """Update time specific state."""
        if CONF_STATE in data and data[CONF_STATE] is not None:
            try:
                self._attr_native_value = time.fromisoformat(str(data[CONF_STATE]))
            except ValueError:
                _LOGGER.warning(f"Invalid time format received for {self.entity_id}: {data[CONF_STATE]}")
                self._attr_native_value = None
        else:
            self._attr_native_value = None

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "min" in attrs:
                try: self._attr_native_min = time.fromisoformat(attrs["min"])
                except ValueError: _LOGGER.warning(f"Invalid min time format for {self.entity_id}: {attrs['min']}")
            if "max" in attrs:
                try: self._attr_native_max = time.fromisoformat(attrs["max"])
                except ValueError: _LOGGER.warning(f"Invalid max time format for {self.entity_id}: {attrs['max']}")
            if "step" in attrs:
                try: self._attr_native_step = timedelta(seconds=int(attrs["step"]))
                except ValueError: _LOGGER.warning(f"Invalid step format for {self.entity_id}: {attrs['step']}")

    async def async_set_value(self, value: time) -> None:
        """Set new time."""
        self.send_event("set_value", value.isoformat())