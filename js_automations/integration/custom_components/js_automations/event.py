from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.event import (
    EventEntity,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE, async_format_device_info
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE, CONF_DEVICE_CLASS

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
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

class JSAutomationsEvent(EventEntity, RestoreEntity):
    """Representation of a JS Automations Event Entity."""

    def __init__(self, data):
        self.entity_id = data["entity_id"]
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._attr_event_types = []
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()

    def update_data(self, data):
        """Update entity state and attributes."""
        self._attr_name = data.get(CONF_NAME, self._attr_name)
        self._attr_icon = data.get(CONF_ICON, self._attr_icon)
        self._attr_available = data.get(CONF_AVAILABLE, self._attr_available)
        self._attr_device_class = data.get(CONF_DEVICE_CLASS, self._attr_device_class)

        device_info = async_format_device_info(data)
        if device_info: self._attr_device_info = device_info

        # Handle attributes and event triggering
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES].copy()
            
            # Update event_types if provided (definition)
            if "event_types" in attrs:
                self._attr_event_types = attrs.pop("event_types")
            
            # If state is provided, it means we want to fire an event
            if CONF_STATE in data and data[CONF_STATE]:
                event_type = str(data[CONF_STATE])
                # Only trigger if it's a valid event type
                if event_type in self._attr_event_types:
                    # Use remaining attributes as event data
                    self._trigger_event(event_type, attrs)
            else:
                # If no state is provided, treat remaining attributes as entity attributes
                self._attr_extra_state_attributes = attrs

        if self.hass:
            self.async_write_ha_state()