from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.lock import (
    LockEntity,
    LockEntityFeature,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_lock(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsLock(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_lock", async_add_lock)
    )

class JSAutomationsLock(LockEntity, RestoreEntity):
    """Representation of a JS Automations Lock."""

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._attr_is_locked = False
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_locked = last_state.state == "locked"

    def update_data(self, data):
        """Update entity state and attributes."""
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data: self._attr_available = data[CONF_AVAILABLE]
        
        if CONF_STATE in data:
            state = data[CONF_STATE]
            self._attr_is_locked = False
            self._attr_is_locking = False
            self._attr_is_unlocking = False
            self._attr_is_jammed = False
            
            if state == "locked":
                self._attr_is_locked = True
            elif state == "unlocked":
                self._attr_is_locked = False
            elif state == "locking":
                self._attr_is_locking = True
            elif state == "unlocking":
                self._attr_is_unlocking = True
            elif state == "jammed":
                self._attr_is_jammed = True
            elif isinstance(state, bool):
                self._attr_is_locked = state

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
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() 
                if k not in ["code_format", "changed_by", "supports_open"]}
            
            if "code_format" in attrs: self._attr_code_format = attrs["code_format"]
            if "changed_by" in attrs: self._attr_changed_by = attrs["changed_by"]
            
            # Determine supported features
            features = 0
            if "supports_open" in attrs and attrs["supports_open"]:
                features |= LockEntityFeature.OPEN
            
            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_lock(self, **kwargs) -> None:
        """Lock the device."""
        data = {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "lock"}
        if "code" in kwargs: data["code"] = kwargs["code"]
        self.hass.bus.async_fire(f"{DOMAIN}_event", data)

    async def async_unlock(self, **kwargs) -> None:
        """Unlock the device."""
        data = {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "unlock"}
        if "code" in kwargs: data["code"] = kwargs["code"]
        self.hass.bus.async_fire(f"{DOMAIN}_event", data)

    async def async_open(self, **kwargs) -> None:
        """Open the door latch."""
        data = {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "open"}
        if "code" in kwargs: data["code"] = kwargs["code"]
        self.hass.bus.async_fire(f"{DOMAIN}_event", data)