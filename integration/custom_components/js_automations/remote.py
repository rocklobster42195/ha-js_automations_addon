from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.remote import (
    RemoteEntity,
    RemoteEntityFeature,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the remote platform."""

    @callback
    def async_add_remote(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsRemote(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_remote", async_add_remote)
    )

class JSAutomationsRemote(JSAutomationsBaseEntity, RemoteEntity):
    """Representation of a JS Automations Remote."""

    def __init__(self, data):
        """Initialize the remote."""
        self._attr_is_on = False
        self._attr_supported_features = (
            RemoteEntityFeature.TURN_ON | RemoteEntityFeature.TURN_OFF | RemoteEntityFeature.SEND_COMMAND
        )
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_on = last_state.state == "on"

    def _update_specific_state(self, data):
        """Update remote specific state."""
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "supported_features" in attrs:
                self._attr_supported_features = RemoteEntityFeature(attrs["supported_features"])

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the remote on."""
        self.send_event("turn_on", kwargs)

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the remote off."""
        self.send_event("turn_off", kwargs)

    async def async_send_command(
        self, command: list[str], *, num_repeats: int = 1, delay_secs: float = 0.4, **kwargs
    ) -> None:
        """Send a command to a device."""
        self.send_event(
            "send_command",
            {"command": command, "num_repeats": num_repeats, "delay_secs": delay_secs, **kwargs}
        )