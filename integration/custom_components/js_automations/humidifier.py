from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.humidifier import (
    HumidifierEntity,
    HumidifierEntityFeature,
    ATTR_HUMIDITY,
    ATTR_MODE,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE, CONF_DEVICE_CLASS

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
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

class JSAutomationsHumidifier(HumidifierEntity, RestoreEntity):
    """Representation of a JS Automations Humidifier."""

    def __init__(self, data):
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
            if "humidity" in last_state.attributes:
                self._attr_target_humidity = last_state.attributes["humidity"]
            if "mode" in last_state.attributes:
                self._attr_mode = last_state.attributes["mode"]

    def update_data(self, data):
        """Update entity state and attributes."""
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data: self._attr_available = data[CONF_AVAILABLE]
        if CONF_DEVICE_CLASS in data: self._attr_device_class = data[CONF_DEVICE_CLASS]
        
        if CONF_STATE in data:
            self._attr_is_on = data[CONF_STATE] == "on" or data[CONF_STATE] is True

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
                if k not in ["humidity", "mode", "available_modes", "min_humidity", "max_humidity"]}
            
            if "humidity" in attrs: self._attr_target_humidity = int(attrs["humidity"])
            if "mode" in attrs: self._attr_mode = attrs["mode"]
            if "available_modes" in attrs: self._attr_available_modes = attrs["available_modes"]
            if "min_humidity" in attrs: self._attr_min_humidity = int(attrs["min_humidity"])
            if "max_humidity" in attrs: self._attr_max_humidity = int(attrs["max_humidity"])
            
            # Determine supported features
            features = 0
            if "available_modes" in attrs:
                features |= HumidifierEntityFeature.MODES
            
            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs) -> None:
        """Turn the entity on."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_on"})

    async def async_turn_off(self, **kwargs) -> None:
        """Turn the entity off."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_off"})

    async def async_set_humidity(self, humidity: int) -> None:
        """Set new target humidity."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "set_humidity", "humidity": humidity
        })

    async def async_set_mode(self, mode: str) -> None:
        """Set new mode."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "set_mode", "mode": mode
        })