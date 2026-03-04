"""
JS Automations Bridge Integration
---------------------------------
This component acts as a bridge between the Node.js Add-on and the Home Assistant Core.
It allows the Add-on to manage persistent entities via the Entity Registry through services.
"""
import logging
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, split_entity_id, callback
from homeassistant.helpers import config_validation as cv, entity_registry as er, device_registry as dr
from homeassistant.helpers.dispatcher import async_dispatcher_send
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
CONF_AREA_ID = "area_id"
CONF_LABELS = "labels"
CONF_DEVICE_INFO = "device_info"
CONF_AVAILABLE = "available"

_LOGGER = logging.getLogger(__name__)

# As per concept, the bridge should be universal
PLATFORMS = ["sensor", "binary_sensor", "switch", "button", "number", "text", "select", "todo", "climate", "light", "cover", "fan", "media_player", "lock", "vacuum", "siren", "camera", "alarm_control_panel", "device_tracker", "weather", "date", "time", "datetime", "update", "event", "remote", "humidifier", "valve"]

# Signal for platform communication
SIGNAL_ADD_ENTITY = f"{DOMAIN}_add_entity"

# Data storage keys
DATA_ENTITIES = "entities"

# --- Service Schemas ---

# Schema for the create_entity service.
# This creates or updates an entity's registration AND sets its state.
CREATE_ENTITY_SCHEMA = vol.Schema({
    vol.Required("entity_id"): cv.entity_id,
    vol.Required(CONF_UNIQUE_ID): cv.string,
    vol.Optional(CONF_NAME): cv.string,
    vol.Optional(CONF_ICON): cv.string,
    vol.Optional(CONF_UNIT_OF_MEASUREMENT): cv.string,
    vol.Optional(CONF_DEVICE_CLASS): cv.string,
    vol.Optional(CONF_STATE): vol.Any(str, int, float, bool, None),
    vol.Optional(CONF_ATTRIBUTES, default={}): dict,
    vol.Optional(CONF_AREA_ID): cv.string,
    vol.Optional(CONF_LABELS): cv.ensure_list_csv(cv.string),
    vol.Optional(CONF_DEVICE_INFO): dict,
    vol.Optional(CONF_AVAILABLE): bool,
}, extra=vol.ALLOW_EXTRA)

# Schema for the update_entity service.
UPDATE_ENTITY_SCHEMA = vol.Schema({
    vol.Required(CONF_UNIQUE_ID): cv.string,
    vol.Optional(CONF_STATE): vol.Any(str, int, float, bool, None),
    vol.Optional(CONF_ATTRIBUTES, default={}): dict,
    # Allow updating registry properties
    vol.Optional(CONF_NAME): cv.string,
    vol.Optional(CONF_ICON): cv.string,
    vol.Optional(CONF_AREA_ID): cv.string,
    vol.Optional(CONF_LABELS): cv.ensure_list_csv(cv.string),
    vol.Optional(CONF_DEVICE_INFO): dict,
    vol.Optional(CONF_AVAILABLE): bool,
}, extra=vol.ALLOW_EXTRA)

# Schema for the remove_entity service.
REMOVE_ENTITY_SCHEMA = vol.Schema({
    vol.Required(CONF_UNIQUE_ID): cv.string,
})

async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the JS Automations component."""
    _LOGGER.info("Initializing JS Automations Bridge")
    registry = er.async_get(hass)

    # Initialize global data store
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {DATA_ENTITIES: {}}

    def get_entity_id_by_unique_id(unique_id):
        """Helper to look up entity_id by unique_id for this platform."""
        for entry in registry.entities.values():
            if entry.platform == DOMAIN and entry.unique_id == unique_id:
                return entry.entity_id
        return None

    # --- Service Handlers ---

    async def handle_create_entity(call: ServiceCall):
        """Service to create or update an entity's registration and set its initial state."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]
        domain, object_id = split_entity_id(data["entity_id"])

        # If entity object already exists, this is a configuration update, not a creation.
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            _LOGGER.debug(f"Entity {unique_id} already exists. Treating as a configuration update.")
            # Forward to the update handler to apply registry changes
            await handle_update_entity(call)
            return

        # Create or update the entry in the entity registry
        # Note: We separate area_id and labels to ensure compatibility with older HA versions
        # where async_get_or_create might not accept them directly.
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

        # Apply Registry updates (Area, Labels) separately
        update_kwargs = {}
        if CONF_AREA_ID in data:
            update_kwargs["area_id"] = data[CONF_AREA_ID]
        if CONF_LABELS in data:
            update_kwargs["labels"] = data[CONF_LABELS]
        
        if update_kwargs:
            try:
                registry.async_update_entity(entry.entity_id, **update_kwargs)
            except Exception as e:
                _LOGGER.warning(f"Could not update registry details (area/labels) for {entry.entity_id}: {e}")

        _LOGGER.debug(f"Registered/Updated entity in registry: {domain}.{object_id} (UID: {unique_id})")

        # Signal the corresponding platform to create the actual entity object.
        # The platform file (e.g., sensor.py) must listen for this signal.
        async_dispatcher_send(hass, f"{SIGNAL_ADD_ENTITY}_{domain}", data)

    async def handle_update_entity(call: ServiceCall):
        """Service to update the state, attributes, or config of a registered entity."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]

        # Allow pinging the service to check availability without logging warnings
        if unique_id == "___ping___":
            return

        # --- Update Entity Object (State/Attributes) ---
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            entity = hass.data[DOMAIN][DATA_ENTITIES][unique_id]
            # The entity object should have a method to process new data
            entity.update_data(data)
        else:
            _LOGGER.warning(f"Could not update state for unknown entity object: uid='{unique_id}'. The entity might not be loaded yet.")

        # --- Update Entity Registry (Name, Icon, Area, Labels) ---
        registry_update_data = {
            key: value for key, value in data.items()
            if key in (CONF_NAME, CONF_ICON, CONF_AREA_ID, CONF_LABELS)
        }
        if registry_update_data:
            entity_id = get_entity_id_by_unique_id(unique_id)
            if entity_id:
                update_payload = {}
                if CONF_NAME in registry_update_data:
                    update_payload["original_name"] = registry_update_data[CONF_NAME]
                if CONF_ICON in registry_update_data:
                    update_payload["original_icon"] = registry_update_data[CONF_ICON]
                if CONF_AREA_ID in registry_update_data:
                    update_payload["area_id"] = registry_update_data[CONF_AREA_ID]
                if CONF_LABELS in registry_update_data:
                    update_payload["labels"] = registry_update_data[CONF_LABELS]

                if update_payload:
                    registry.async_update_entity(entity_id, **update_payload)
                    _LOGGER.debug(f"Updated registry for {entity_id} with {update_payload}")
            else:
                _LOGGER.warning(f"Could not find entity in registry for update: uid='{unique_id}'")

    async def handle_remove_entity(call: ServiceCall):
        """Service to remove an entity from the Entity Registry and runtime."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]

        entity_id = get_entity_id_by_unique_id(unique_id)

        if entity_id:
            registry.async_remove(entity_id)
            _LOGGER.debug(f"Removed entity {entity_id} from registry (UID: {unique_id})")
        else:
            _LOGGER.warning(f"Could not find entity in registry to remove: uid={unique_id}")

        # Also remove from our runtime memory
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            entity = hass.data[DOMAIN][DATA_ENTITIES].pop(unique_id)
            if entity.hass:
                # This triggers the entity's async_will_remove_from_hass
                await entity.async_remove(force_remove=True)
            _LOGGER.debug(f"Removed entity object from runtime (UID: {unique_id})")

    # --- Register Services ---
    hass.services.async_register(DOMAIN, "create_entity", handle_create_entity, schema=CREATE_ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "update_entity", handle_update_entity, schema=UPDATE_ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "remove_entity", handle_remove_entity, schema=REMOVE_ENTITY_SCHEMA)

    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up JS Automations from a config entry."""
    # Forward setup to all platforms. They will set up their listeners.
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    return True

async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload a config entry."""
    # Unload platforms
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)

    if unload_ok:
        # Clean up services
        hass.services.async_remove(DOMAIN, "create_entity")
        hass.services.async_remove(DOMAIN, "update_entity")
        hass.services.async_remove(DOMAIN, "remove_entity")
        # Clean up data
        hass.data.pop(DOMAIN, None)

    return unload_ok