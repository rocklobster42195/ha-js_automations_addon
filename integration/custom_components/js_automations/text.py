from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.text import TextEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_text(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsText(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_text", async_add_text)
    )

class JSAutomationsText(JSAutomationsBaseEntity, TextEntity):
    """Representation of a JS Automations Text Entity."""

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_native_value = last_state.state

    def _update_specific_state(self, data):
        """Update text specific state."""
        if CONF_STATE in data: self._attr_native_value = str(data[CONF_STATE]) if data[CONF_STATE] is not None else None
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "min" in attrs: self._attr_native_min = int(attrs["min"])
            if "max" in attrs: self._attr_native_max = int(attrs["max"])
            if "pattern" in attrs: self._attr_pattern = attrs["pattern"]
            if "mode" in attrs: self._attr_mode = attrs["mode"]

    async def async_set_value(self, value: str) -> None:
        """Set new value."""
        self.send_event("set_value", value)