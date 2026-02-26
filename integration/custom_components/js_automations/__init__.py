"""
JS Automations Bridge Integration
---------------------------------
This component acts as a bridge between the Node.js Add-on and the Home Assistant Core.
It allows the Add-on to manage persistent entities via the Entity Registry through services.
"""
import logging
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, split_entity_id
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
PLATFORMS = ["sensor", "binary_sensor", "switch", "button"]
DATA_ADD_ENTITIES = "add_entities"
DATA_ENTITIES = "entities"

# --- Service Schemas ---

# Schema for the create_entity service.
# This creates or updates an entity's registration AND sets its state.
CREATE_ENTITY_SCHEMA = vol.Schema({
    vol.Required("entity_id"): cv.string,
    vol.Required(CONF_UNIQUE_ID): cv.string,
    vol.Optional(CONF_NAME): cv.string,
    vol.Optional(CONF_ICON): cv.string,
    vol.Optional(CONF_UNIT_OF_MEASUREMENT): cv.string,
    vol.Optional(CONF_DEVICE_CLASS): cv.string,
    vol.Optional(CONF_STATE): vol.Any(str, int, float, bool, None),
    vol.Optional(CONF_ATTRIBUTES, default={}): dict,
})

# Schema for the update_entity service.
UPDATE_ENTITY_SCHEMA = vol.Schema({
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
    
    # Initialize global data store
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {DATA_ADD_ENTITIES: {}, DATA_ENTITIES: {}}

    # --- Service Handlers ---

    async def handle_create_entity(call: ServiceCall):
        """Service to create or update an entity in the Entity Registry and set state."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]
        entity_id_input = data["entity_id"]
        domain, object_id = split_entity_id(entity_id_input)

        entry = registry.async_get_or_create(
            domain=domain,
            platform=DOMAIN,
            unique_id=unique_id,
            suggested_object_id=object_id,
            original_name=data.get(CONF_NAME),
            original_icon=data.get(CONF_ICON),
            original_device_class=data.get(CONF_DEVICE_CLASS),
            unit_of_measurement=data.get(CONF_UNIT_OF_MEASUREMENT),
        )

        _LOGGER.debug(f"Registered/Updated entity: {entry.entity_id} (UID: {unique_id})")
        
        # Create or Update Python Entity
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            # Update existing
            entity = hass.data[DOMAIN][DATA_ENTITIES][unique_id]
            entity.update_data(data)
        else:
            # Create new
            if domain in hass.data[DOMAIN][DATA_ADD_ENTITIES]:
                add_entities = hass.data[DOMAIN][DATA_ADD_ENTITIES][domain]
                # We pass the class constructor via the platform, but here we just pass data
                # Actually, the platform should handle creation.
                # Let's assume the platform stored a factory or we just pass the data to the platform callback.
                # To keep it simple: The platform stores the `async_add_entities` callback.
                # We need to instantiate the correct class based on domain.
                # This logic is moved to the platform files, we just trigger it here?
                # No, we need to instantiate here or call a helper.
                # Better: We call a helper stored in DATA_ADD_ENTITIES.
                create_callback = hass.data[DOMAIN][DATA_ADD_ENTITIES][domain]
                create_callback(data)
            else:
                _LOGGER.warning(f"Platform {domain} not loaded yet. Cannot create entity {unique_id}")

    async def handle_update_entity(call: ServiceCall):
        """Service to set the state and attributes of a registered entity."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]
        domain = data[CONF_DOMAIN]

        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            entity = hass.data[DOMAIN][DATA_ENTITIES][unique_id]
            entity.update_data(data)
        else:
            _LOGGER.warning(f"Could not update state for unknown entity: domain='{domain}', uid='{unique_id}'")

    async def handle_remove_entity(call: ServiceCall):
        """Service to remove an entity from the Entity Registry."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]
        domain = data[CONF_DOMAIN]
        entity_id = registry.async_get_entity_id(domain, DOMAIN, unique_id)

        if entity_id:
            registry.async_remove(entity_id)
            # Also remove from our memory
            if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
                entity = hass.data[DOMAIN][DATA_ENTITIES].pop(unique_id)
                if entity.hass:
                    hass.async_create_task(entity.async_remove())
            _LOGGER.debug(f"Removed entity {entity_id} (UID: {unique_id})")
        else:
            _LOGGER.warning(f"Could not remove unknown entity: domain={domain}, uid={unique_id}")

    # --- Register Services ---
    hass.services.async_register(DOMAIN, "create_entity", handle_create_entity, schema=CREATE_ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "update_entity", handle_update_entity, schema=UPDATE_ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "remove_entity", handle_remove_entity, schema=REMOVE_ENTITY_SCHEMA)

    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up JS Automations from a config entry."""
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {DATA_ADD_ENTITIES: {}, DATA_ENTITIES: {}}
    # The services are registered in async_setup. We don't need to do anything here.
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    # Clean up services when the integration is unloaded.
    hass.services.async_remove(DOMAIN, "create_entity")
    hass.services.async_remove(DOMAIN, "update_entity")
    hass.services.async_remove(DOMAIN, "remove_entity")
    return True