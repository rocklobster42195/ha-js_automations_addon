"""
JS Automations Bridge Integration
---------------------------------
This component acts as a bridge between the Node.js Add-on and the Home Assistant Core.
It allows the Add-on to register persistent entities via the Entity Registry.
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
    CONF_ENTITY_ID,
    CONF_UNIT_OF_MEASUREMENT,
    CONF_DEVICE_CLASS,
)

DOMAIN = "js_automations"
CONF_ATTRIBUTES = "attributes"
_LOGGER = logging.getLogger(__name__)

# Schema for the create_entity service
CREATE_ENTITY_SCHEMA = vol.Schema({
    vol.Required(CONF_ENTITY_ID): cv.string,
    vol.Required(CONF_UNIQUE_ID): cv.string,
    vol.Optional(CONF_STATE): vol.Any(cv.string, int, float, bool, None),
    vol.Optional(CONF_NAME): cv.string,
    vol.Optional(CONF_ICON): cv.string,
    vol.Optional(CONF_ATTRIBUTES, default={}): dict,
    vol.Optional(CONF_UNIT_OF_MEASUREMENT): cv.string,
    vol.Optional(CONF_DEVICE_CLASS): cv.string,
})

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the JS Automations component."""
    _LOGGER.info("Initializing JS Automations Bridge")

    async def handle_create_entity(call: ServiceCall):
        """
        Service to create or update a persistent entity.
        This registers the entity in the Entity Registry and sets its state.
        """
        data = call.data
        entity_id = data[CONF_ENTITY_ID]
        unique_id = data[CONF_UNIQUE_ID]
        state = data.get(CONF_STATE)
        attributes = data.get(CONF_ATTRIBUTES, {}).copy()
        
        # Extract domain from entity_id (e.g. "sensor.test" -> "sensor")
        domain = entity_id.split(".")[0]

        # 1. Register in Entity Registry (Persistence)
        registry = er.async_get(hass)
        entry = registry.async_get_or_create(
            domain=domain,
            platform=DOMAIN,
            unique_id=unique_id,
            suggested_object_id=entity_id.split(".")[1],
            original_name=data.get(CONF_NAME),
            original_icon=data.get(CONF_ICON),
            original_device_class=data.get(CONF_DEVICE_CLASS),
            unit_of_measurement=data.get(CONF_UNIT_OF_MEASUREMENT),
        )

        # 2. Set State in State Machine (Runtime)
        # We use the entity_id from the registry to ensure consistency
        # (in case the user renamed the entity_id in the HA UI)
        hass.states.async_set(entry.entity_id, state, attributes)
        
        _LOGGER.debug(f"Registered/Updated entity: {entry.entity_id} (UID: {unique_id})")

    # Register the service
    hass.services.async_register(DOMAIN, "create_entity", handle_create_entity, schema=CREATE_ENTITY_SCHEMA)

    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up JS Automations from a config entry."""
    # Services are registered in async_setup, so we just return True here.
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    return True