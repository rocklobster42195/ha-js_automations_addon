"""
JS Automations Bridge Integration
---------------------------------
This component acts as a bridge between the Node.js Add-on and the Home Assistant Core.
It allows the Add-on to manage persistent entities via the Entity Registry through services.
"""
import logging
import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant import loader
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
    split_entity_id,
    callback,
)
from homeassistant.helpers import config_validation as cv, entity_registry as er, device_registry as dr
from homeassistant.helpers.dispatcher import async_dispatcher_send, async_dispatcher_connect
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.const import (
    CONF_NAME,
    CONF_ICON,
    CONF_UNIQUE_ID,
    CONF_STATE,
    CONF_UNIT_OF_MEASUREMENT,
    CONF_DEVICE_CLASS,
    ATTR_ENTITY_ID,
)
from .const import CONF_STATE_CLASS

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
    vol.Optional(CONF_STATE_CLASS): cv.string,
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
REMOVE_ENTITY_SCHEMA = vol.Schema(
    vol.All(
        {
            vol.Optional("entity_id"): cv.entity_id,
            vol.Optional(CONF_UNIQUE_ID): cv.string,
        },
        cv.has_at_least_one_key("entity_id", CONF_UNIQUE_ID),
    )
)

# Schema for the remove_device service.
REMOVE_DEVICE_SCHEMA = vol.Schema({
    vol.Required("identifiers"): vol.All(cv.ensure_list, [cv.string]),
})

@callback
def async_format_device_info(data: dict) -> dict:
    """Helper to format device info correctly for Home Assistant."""
    if CONF_DEVICE_INFO not in data:
        return None
        
    info = data[CONF_DEVICE_INFO].copy()
    if "identifiers" in info and isinstance(info["identifiers"], list):
        ids = set()
        for x in info["identifiers"]:
            if isinstance(x, list):
                # Converts [['domain', 'id']] to {('domain', 'id')}
                ids.add(tuple(x))
            else:
                # Fallback for simple string IDs
                ids.add((DOMAIN, str(x)))
        info["identifiers"] = ids
    return info


class JSAutomationsBaseEntity(RestoreEntity):
    """Abstrakte Basisklasse für alle JS Automations Entitäten."""

    _attr_has_entity_name = False
    _attr_should_poll = False

    def __init__(self, data: dict) -> None:
        """Initialisierung mit dem initialen Datenpaket."""
        self.entity_id = data["entity_id"]
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_extra_state_attributes = {}
        
        # Initiales Daten-Processing
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Wird aufgerufen, wenn die Entität zu HA hinzugefügt wird."""
        await super().async_added_to_hass()
        
        # State Restore Logik (Standard für alle)
        if (last_state := await self.async_get_last_state()) is not None:
            self._restore_state(last_state)

    def _restore_state(self, last_state):
        """Kann von Subklassen überschrieben werden (z.B. für numerisches Casting)."""
        self._attr_available = True # Gehe davon aus, dass sie nach Restore da ist

    def update_data(self, data: dict) -> None:
        """Zentrale Methode zum Verarbeiten von Updates via Service."""
        # Registry-nahe Attribute
        if CONF_NAME in data:
            self._attr_name = data[CONF_NAME]
        if CONF_ICON in data:
            self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data:
            self._attr_available = data[CONF_AVAILABLE]

        # Plattform-Attribute
        if CONF_UNIT_OF_MEASUREMENT in data:
            self._attr_native_unit_of_measurement = data[CONF_UNIT_OF_MEASUREMENT]
        if CONF_DEVICE_CLASS in data:
            self._attr_device_class = data[CONF_DEVICE_CLASS]
        if CONF_STATE_CLASS in data:
            self._attr_state_class = data[CONF_STATE_CLASS]

        # Device Linking
        if device_info := async_format_device_info(data):
            self._attr_device_info = device_info

        # Extra Attribute filtern (nur was nicht nativ existiert)
        if CONF_ATTRIBUTES in data:
            self._attr_extra_state_attributes.update(data[CONF_ATTRIBUTES])

        if self.hass:
            self.async_write_ha_state()

    def _fire_js_event(self, action: str, data: dict = None) -> None:
        """Feuert ein Event auf dem HA Bus für das Add-on."""
        event_data = {
            "domain": self.platform.domain,
            "action": action,
            ATTR_ENTITY_ID: self.entity_id,
            CONF_UNIQUE_ID: self.unique_id,
        }
        if data:
            event_data.update(data)
            
        self.hass.bus.async_fire(f"{DOMAIN}_event", event_data)


async def async_setup_js_platform(hass, domain, entity_class, async_add_entities):
    """Zentraler Helper für das Setup aller Plattformen."""
    
    @callback
    def async_add_js_entity(data: dict):
        """Erstellt das Objekt und registriert es im globalen Store."""
        unique_id = data[CONF_UNIQUE_ID]
        
        # Verhindert Duplikate im Runtime Memory
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            _LOGGER.debug("Entity %s already loaded, skipping creation.", unique_id)
            return
            
        try:
            entity = entity_class(data)
            hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
            async_add_entities([entity])
        except Exception as e:
            _LOGGER.error("Failed to create %s entity %s: %s", domain, unique_id, e)

    # Cleanup beim Entladen sicherstellen
    # Hinweis: Da wir hier keine ConfigEntry haben, müssen wir das Signal-Handle manuell verwalten 
    # oder die Plattform-Datei übernimmt das (wie bisher).
    return async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_{domain}", async_add_js_entity)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    """Set up the JS Automations component."""
    _LOGGER.info("Initializing JS Automations Bridge")
    entity_registry = er.async_get(hass)
    device_registry = dr.async_get(hass)

    # Initialize global data store
    if DOMAIN not in hass.data:
        hass.data[DOMAIN] = {DATA_ENTITIES: {}}

    return True

async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up JS Automations from a config entry."""
    entity_registry = er.async_get(hass)
    device_registry = dr.async_get(hass)

    def get_entity_id_by_unique_id(unique_id):
        """Helper to look up entity_id by unique_id for this platform."""
        if not unique_id:
            return None
        for reg_entry in entity_registry.entities.values():
            if reg_entry.platform == DOMAIN and reg_entry.unique_id == unique_id:
                return reg_entry.entity_id
        return None

    # --- Service Handlers (Inside setup_entry for correct lifecycle) ---
    
    async def handle_create_entity(call: ServiceCall):
        """Service to create or update an entity's registration and set its initial state."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]
        domain, object_id = split_entity_id(data["entity_id"])

        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            _LOGGER.debug(f"Entity {unique_id} already exists. Treating as a configuration update.")
            await handle_update_entity(call)
            return

        # Registration
        reg_entry = entity_registry.async_get_or_create(
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
                entity_registry.async_update_entity(reg_entry.entity_id, **update_kwargs)
            except Exception as e:
                _LOGGER.warning(f"Could not update registry details (area/labels) for {reg_entry.entity_id}: {e}")

        _LOGGER.debug(f"Registered/Updated entity in registry: {domain}.{object_id} (UID: {unique_id})")

        # Signal the corresponding platform to create the actual entity object.
        # The platform file (e.g., sensor.py) must listen for this signal.
        async_dispatcher_send(hass, f"{SIGNAL_ADD_ENTITY}_{domain}", data)

    async def handle_update_entity(call: ServiceCall):
        """Service to update the state, attributes, or config of a registered entity."""
        data = call.data
        unique_id = data[CONF_UNIQUE_ID]

        if unique_id == "___ping___":
            return

        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            entity = hass.data[DOMAIN][DATA_ENTITIES][unique_id]
            entity.update_data(data) # MS11 BaseEntity Logic
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
                    entity_registry.async_update_entity(entity_id, **update_payload)
                    _LOGGER.debug(f"Updated registry for {entity_id} with {update_payload}")
            else:
                _LOGGER.warning(f"Could not find entity in registry for update: uid='{unique_id}'")

    async def handle_remove_entity(call: ServiceCall):
        """Service to remove an entity from the Entity Registry and runtime."""
        data = call.data
        unique_id = data.get(CONF_UNIQUE_ID)
        entity_id = data.get("entity_id")

        # If only unique_id is provided, find the entity_id
        if unique_id and not entity_id:
            entity_id = get_entity_id_by_unique_id(unique_id)

        if not entity_id:
            _LOGGER.warning(f"Could not find entity to remove with identifiers: {data}")
            return

        # Before removing from registry, get entry to find unique_id for runtime cleanup
        registry_entry = entity_registry.async_get(entity_id)
        if registry_entry and not unique_id:
            unique_id = registry_entry.unique_id

        # Remove from HA registry
        entity_registry.async_remove(entity_id)
        _LOGGER.debug(f"Removed entity {entity_id} from registry")

        # Also remove from our runtime memory, if it was loaded and we found its unique_id
        if unique_id and unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            entity = hass.data[DOMAIN][DATA_ENTITIES].pop(unique_id)
            if entity.hass:
                # This triggers the entity's async_will_remove_from_hass
                await entity.async_remove(force_remove=True)
            _LOGGER.debug(f"Removed entity object from runtime (UID: {unique_id})")

    async def handle_remove_device(call: ServiceCall):
        """Service to remove a device from the Device Registry."""
        data = call.data
        identifiers = {(DOMAIN, identifier) for identifier in data["identifiers"]}
        
        device_entry = device_registry.async_get_device(identifiers=identifiers)
        if device_entry:
            device_registry.async_remove_device(device_entry.id)
            _LOGGER.debug(f"Removed device with identifiers {identifiers} from registry.")
        else:
            _LOGGER.warning(f"Could not find device in registry to remove: identifiers={identifiers}")

    async def handle_get_info(call: ServiceCall) -> ServiceResponse:
        """Service to return version information for the add-on."""
        integration = await loader.async_get_integration(hass, DOMAIN)
        return {"version": integration.version}

    # Register Services
    hass.services.async_register(DOMAIN, "create_entity", handle_create_entity, schema=CREATE_ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "update_entity", handle_update_entity, schema=UPDATE_ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "remove_entity", handle_remove_entity, schema=REMOVE_ENTITY_SCHEMA)
    hass.services.async_register(DOMAIN, "remove_device", handle_remove_device, schema=REMOVE_DEVICE_SCHEMA)
    hass.services.async_register(
        DOMAIN, "get_info", handle_get_info, supports_response=SupportsResponse.ONLY
    )

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
        hass.services.async_remove(DOMAIN, "remove_device")
        # Clean up data
        hass.data.pop(DOMAIN, None)

    return unload_ok