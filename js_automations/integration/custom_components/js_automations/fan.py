from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.fan import (
    FanEntity,
    FanEntityFeature,
    ATTR_PERCENTAGE,
    ATTR_PRESET_MODE,
    ATTR_OSCILLATING,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE, async_format_device_info
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
    @callback
    def async_add_fan(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsFan(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_fan", async_add_fan)
    )

class JSAutomationsFan(FanEntity, RestoreEntity):
    """Representation of a JS Automations Fan."""

    def __init__(self, data):
        self.entity_id = data["entity_id"]
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._attr_is_on = False
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_on = last_state.state == "on"
            if "percentage" in last_state.attributes:
                self._attr_percentage = last_state.attributes["percentage"]
            if "preset_mode" in last_state.attributes:
                self._attr_preset_mode = last_state.attributes["preset_mode"]
            if "oscillating" in last_state.attributes:
                self._attr_oscillating = last_state.attributes["oscillating"]

    def update_data(self, data):
        """Update entity state and attributes."""
        self._attr_name = data.get(CONF_NAME, self._attr_name)
        self._attr_icon = data.get(CONF_ICON, self._attr_icon)
        self._attr_available = data.get(CONF_AVAILABLE, self._attr_available)
        
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

        device_info = async_format_device_info(data)
        if device_info: self._attr_device_info = device_info
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() 
                if k not in ["percentage", "preset_mode", "preset_modes", "oscillating"]}
            
            if "percentage" in attrs: self._attr_percentage = int(attrs["percentage"])
            if "preset_mode" in attrs: self._attr_preset_mode = attrs["preset_mode"]
            if "preset_modes" in attrs: self._attr_preset_modes = attrs["preset_modes"]
            if "oscillating" in attrs: self._attr_oscillating = bool(attrs["oscillating"])
            
            # Determine supported features
            features = 0
            if "percentage" in attrs:
                features |= FanEntityFeature.SET_SPEED
            if "preset_modes" in attrs:
                features |= FanEntityFeature.PRESET_MODE
            if "oscillating" in attrs:
                features |= FanEntityFeature.OSCILLATE
            
            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self, percentage: int | None = None, preset_mode: str | None = None, **kwargs) -> None:
        """Turn the fan on."""
        data = {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_on"}
        if percentage is not None:
            data["percentage"] = percentage
        if preset_mode is not None:
            data["preset_mode"] = preset_mode
        self.hass.bus.async_fire(f"{DOMAIN}_event", data)

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the fan off."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_off"})

    async def async_set_percentage(self, percentage: int) -> None:
        """Set the speed of the fan."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "set_percentage", "percentage": percentage
        })

    async def async_set_preset_mode(self, preset_mode: str) -> None:
        """Set the preset mode of the fan."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "set_preset_mode", "preset_mode": preset_mode
        })

    async def async_oscillate(self, oscillating: bool) -> None:
        """Set oscillation."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "oscillate", "oscillating": oscillating
        })