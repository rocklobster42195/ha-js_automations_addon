from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.const import (
    CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, 
    CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE, CONF_STATE
)
from . import DOMAIN

class JSAutomationsBaseEntity(RestoreEntity):
    """Base class for JS Automations entities to reduce boilerplate."""

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._attr_extra_state_attributes = {} # Initialize here to ensure it's always a dict
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass. Restore last state."""
        await super().async_added_to_hass() # Call parent's async_added_to_hass (RestoreEntity)
        last_state = await self.async_get_last_state()
        if last_state:
            # Construct a data dictionary from the last_state to pass to update_data.
            # This ensures that the _update_specific_state method in subclasses
            # is the single source of truth for applying state/attribute logic.
            restored_data = {
                CONF_UNIQUE_ID: self._attr_unique_id,
                CONF_STATE: last_state.state,
                CONF_ATTRIBUTES: dict(last_state.attributes), # Copy attributes to avoid modifying original
                # Also restore common properties if they were part of the last state attributes
                CONF_NAME: last_state.attributes.get(CONF_NAME, self._attr_name),
                CONF_ICON: last_state.attributes.get(CONF_ICON, self._attr_icon),
                CONF_AVAILABLE: last_state.attributes.get(CONF_AVAILABLE, True), # Default to True if not in last state
            }
            
            self.update_data(restored_data) # Apply restored state

    def update_data(self, data):
        """Update common entity state and attributes."""
        if CONF_NAME in data:
            self._attr_name = data[CONF_NAME]
        if CONF_ICON in data:
            self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data:
            self._attr_available = data[CONF_AVAILABLE]
        
        # Handle Attributes: Merge new attributes into existing ones
        # This ensures attributes not explicitly sent in an update are preserved.
        if CONF_ATTRIBUTES in data:
            if not isinstance(self._attr_extra_state_attributes, dict):
                self._attr_extra_state_attributes = {} # Ensure it's a dict
            self._attr_extra_state_attributes.update(data[CONF_ATTRIBUTES])

        # Handle Device Info
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
        
        # Allow subclasses to handle specific state (e.g. is_on, native_value)
        self._update_specific_state(data)

        if self.hass:
            self.async_write_ha_state()

    def _update_specific_state(self, data):
        """Implemented by subclasses to update specific state."""
        pass

    def send_event(self, action, value=None):
        """Helper to fire an event to the bus."""
        payload = {
            "entity_id": self.entity_id,
            "unique_id": self._attr_unique_id,
            "action": action
        }
        if value is not None:
            payload["value"] = value
            
        self.hass.bus.async_fire(f"{DOMAIN}_event", payload)