"""
JS Automations Bridge Integration
---------------------------------
This component acts as a bridge between the Node.js Add-on and the Home Assistant Core.
It allows the Add-on to manage persistent entities via the Entity Registry through services.
"""
import logging
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv, entity_registry as er
from homeassistant.const import (
    CONF_NAME,
    CONF_ICON,
    CONF_UNIQUE_ID,
    CONF_STATE,
    CONF_UNIT_OF_MEASUREMENT,
    CONF_DEVICE_CLASS,
)

DOMAIN = "js_automations"
CONF_ATTRIBUTES = "attributes"
CONF_DOMAIN = "domain"
CONF_OBJECT_ID = "object_id"
_LOGGER = logging.getLogger(__name__)

# --- Service Schemas ---

# Schema for the register_entity service.
# This creates or updates an entity's registration, but does not set its state.
REGISTER_ENTITY_SCHEMA = vol.Schema({
    vol.Required(CONF_UNIQUE_ID): cv.string,
    vol.Required(CONF_DOMAIN): cv.string,
    vol.Required(CONF_OBJECT_ID): cv.string,
    vol.Optional(CONF_NAME): cv.string,
    vol.Optional(CONF_ICON): cv.string,
    vol.Optional(CONF_UNIT_OF_MEASUREMENT): cv.string,
    vol.Optional(CONF_DEVICE_CLASS): cv.string,
})

# Schema for the update_state service.
UPDATE_STATE_SCHEMA = vol.Schema({
    vol.Required(CONF_UNIQUE_ID): cv.string,
    vol.Required(CONF_DOMAIN): cv.string,
    vol.Optional(CONF_STATE): vol.Any(str, int, float, bool, None),
    vol.Optional(CONF_ATTRIBUTES, default={}): dict,
})

# Schema for the remove_entity service.
REMOVE_ENTITY_SCHEMA = vol.Schema({
    vol.Required(CONF_UNIQUE_ID): cv.string,
    vol.Required(CONF_DOMAIN): cv.string,
})

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the JS Automations component."""
    _LOGGER.info("Initializing JS Automations Bridge")
    registry = er.async_get(hass)

    # --- Service Handlers ---

    async def handle_register_entity(call: ServiceCall):
        """Service to create or update an entity in the Entity Registry."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]

        entry = registry.async_get_or_create(
            domain=data[CONF_DOMAIN],
            platform=DOMAIN,
            unique_id=unique_id,
            suggested_object_id=data[CONF_OBJECT_ID],
            original_name=data.get(CONF_NAME),
            original_icon=data.get(CONF_ICON),
            original_device_class=data.get(CONF_DEVICE_CLASS),
            unit_of_measurement=data.get(CONF_UNIT_OF_MEASUREMENT),
        )
        _LOGGER.debug(f"Registered/Updated entity: {entry.entity_id} (UID: {unique_id})")

    async def handle_update_state(call: ServiceCall):
        """Service to set the state and attributes of a registered entity."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]
        domain = data[CONF_DOMAIN]
        entity_id = registry.async_get_entity_id(domain, DOMAIN, unique_id)

        if entity_id:
            hass.states.async_set(entity_id, data.get(CONF_STATE), data.get(CONF_ATTRIBUTES, {}))
        else:
            _LOGGER.warning(f"Could not update state for unknown entity: domain={domain}, uid={unique_id}")

    async def handle_remove_entity(call: ServiceCall):
        """Service to remove an entity from the Entity Registry."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]
        domain = data[CONF_DOMAIN]
        entity_id = registry.async_get_entity_id(domain, DOMAIN, unique_id)

        if entity_id:
            registry.async_remove(entity_id)
            _LOGGER.debug(f"Removed entity {entity_id} (UID: {unique_id})")
        else:
            _LOGGER.warning(f"Could not remove unknown entity: domain={domain}, uid={unique_id}")

    # --- Register Services ---
    hass.services.async_register(DOMAIN, "register_entity", handle_register_entity, schema=REGISTER_ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "update_state", handle_update_state, schema=UPDATE_STATE_SCHEMA)
    hass.services.async_register(DOMAIN, "remove_entity", handle_remove_entity, schema=REMOVE_ENTITY_SCHEMA)

    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up JS Automations from a config entry."""
    # The services are registered in async_setup. We don't need to do anything here.
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    # Clean up services when the integration is unloaded.
    hass.services.async_remove(DOMAIN, "register_entity")
    hass.services.async_remove(DOMAIN, "update_state")
    hass.services.async_remove(DOMAIN, "remove_entity")
    return True