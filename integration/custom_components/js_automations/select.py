from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.select import SelectEntity
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
    def async_add_select(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsSelect(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_select", async_add_select)
    )

class JSAutomationsSelect(JSAutomationsBaseEntity, SelectEntity):
    """Representation of a JS Automations Select Entity."""

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_current_option = last_state.state

    def _update_specific_state(self, data):
        """Update select specific state."""
        if CONF_STATE in data: self._attr_current_option = str(data[CONF_STATE]) if data[CONF_STATE] is not None else None
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "options" in attrs: self._attr_options = attrs["options"]

    async def async_select_option(self, option: str) -> None:
        """Change the selected option."""
        self.send_event("select_option", option)