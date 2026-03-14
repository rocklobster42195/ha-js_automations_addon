from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.lock import (
    LockEntity,
    LockEntityFeature,
)
from . import (
    JSAutomationsBaseEntity,
    async_setup_js_platform,
    CONF_ATTRIBUTES,
)
from homeassistant.const import CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the JS Automations lock platform."""
    connection = await async_setup_js_platform(
        hass, "lock", JSAutomationsLock, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsLock(JSAutomationsBaseEntity, LockEntity):
    """Representation of a JS Automations Lock."""

    def _restore_state(self, last_state):
        """Zustand für Lock wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_is_locked = last_state.state == "locked"
        attrs = last_state.attributes
        self._attr_code_format = attrs.get("code_format")
        self._attr_changed_by = attrs.get("changed_by")

    def update_data(self, data):
        """Update Lock spezifische Daten."""
        super().update_data(data)
        
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

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            
            if "code_format" in attrs: self._attr_code_format = attrs["code_format"]
            if "changed_by" in attrs: self._attr_changed_by = attrs["changed_by"]
            
            # Features berechnen
            features = 0
            if "supports_open" in attrs and attrs["supports_open"]:
                features |= LockEntityFeature.OPEN
            
            self._attr_supported_features = features

            # Cleanup der Extra Attributes
            managed_keys = ["code_format", "changed_by", "supports_open"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

        if self.hass:
            self.async_write_ha_state()

    async def async_lock(self, **kwargs) -> None:
        """Lock the device."""
        self._fire_js_event("lock", kwargs)

    async def async_unlock(self, **kwargs) -> None:
        """Unlock the device."""
        self._fire_js_event("unlock", kwargs)

    async def async_open(self, **kwargs) -> None:
        """Open the door latch."""
        self._fire_js_event("open", kwargs)