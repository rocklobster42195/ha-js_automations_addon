from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.lock import (
    LockEntity,
    LockEntityFeature,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import (
    CONF_UNIQUE_ID,
    CONF_STATE,
    STATE_LOCKED,
    STATE_UNLOCKED,
)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the lock platform."""

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

class JSAutomationsLock(JSAutomationsBaseEntity, LockEntity):
    """Representation of a JS Automations Lock."""

    def __init__(self, data):
        """Initialize the lock."""
        self._attr_is_locked = None
        self._attr_supported_features = LockEntityFeature.LOCK | LockEntityFeature.UNLOCK
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_locked = last_state.state == STATE_LOCKED

    def _update_specific_state(self, data):
        """Update lock specific state."""
        if CONF_STATE in data:
            state = data[CONF_STATE]
            self._attr_is_locking = state == "locking"
            self._attr_is_unlocking = state == "unlocking"
            self._attr_is_jammed = state == "jammed"
            if state == STATE_LOCKED:
                self._attr_is_locked = True
            elif state == STATE_UNLOCKED:
                self._attr_is_locked = False
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "supports_open" in attrs and attrs["supports_open"]:
                self._attr_supported_features |= LockEntityFeature.OPEN

    async def async_lock(self, **kwargs):
        self.send_event("lock")

    async def async_unlock(self, **kwargs):
        self.send_event("unlock")

    async def async_open(self, **kwargs):
        self.send_event("open")