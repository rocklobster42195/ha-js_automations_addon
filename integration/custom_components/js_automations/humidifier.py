from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.humidifier import (
    HumidifierEntity,
    HumidifierEntityFeature,
    ATTR_HUMIDITY,
    ATTR_MODE,
    ATTR_AVAILABLE_MODES,
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
    """Set up the humidifier platform."""

    @callback
    def async_add_humidifier(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsHumidifier(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_humidifier", async_add_humidifier)
    )

class JSAutomationsHumidifier(JSAutomationsBaseEntity, HumidifierEntity):
    """Representation of a JS Automations Humidifier."""

    def __init__(self, data):
        """Initialize the humidifier."""
        self._attr_is_on = False
        self._attr_supported_features = HumidifierEntityFeature.TURN_ON | HumidifierEntityFeature.TURN_OFF
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_on = last_state.state == "on"
            attrs = last_state.attributes
            if ATTR_HUMIDITY in attrs: self._attr_current_humidity = attrs[ATTR_HUMIDITY]
            if "target_humidity" in attrs: self._attr_target_humidity = attrs["target_humidity"]
            if ATTR_MODE in attrs: self._attr_mode = attrs[ATTR_MODE]
            if ATTR_AVAILABLE_MODES in attrs: self._attr_available_modes = attrs[ATTR_AVAILABLE_MODES]

    def _update_specific_state(self, data):
        """Update humidifier specific state."""
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if ATTR_HUMIDITY in attrs: self._attr_current_humidity = attrs[ATTR_HUMIDITY]
            if "target_humidity" in attrs:
                self._attr_target_humidity = attrs["target_humidity"]
                self._attr_supported_features |= HumidifierEntityFeature.SET_HUMIDITY
            if ATTR_MODE in attrs:
                self._attr_mode = attrs[ATTR_MODE]
                self._attr_supported_features |= HumidifierEntityFeature.MODES
            if ATTR_AVAILABLE_MODES in attrs:
                self._attr_available_modes = attrs[ATTR_AVAILABLE_MODES]
                self._attr_supported_features |= HumidifierEntityFeature.MODES
            if "supported_features" in attrs:
                self._attr_supported_features = HumidifierEntityFeature(attrs["supported_features"])

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the humidifier on."""
        self.send_event("turn_on", kwargs)

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the humidifier off."""
        self.send_event("turn_off", kwargs)

    async def async_set_humidity(self, humidity: int) -> None:
        """Set the target humidity."""
        self.send_event("set_humidity", {"humidity": humidity})

    async def async_set_mode(self, mode: str) -> None:
        """Set the mode."""
        self.send_event("set_mode", {"mode": mode})