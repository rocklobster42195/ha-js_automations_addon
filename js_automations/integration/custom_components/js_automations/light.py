from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.light import (
    LightEntity,
    LightEntityFeature,
    ColorMode,
    ATTR_BRIGHTNESS,
    ATTR_RGB_COLOR,
    ATTR_EFFECT,
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
    def async_add_light(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsLight(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_light", async_add_light)
    )

class JSAutomationsLight(LightEntity, RestoreEntity):
    """Representation of a JS Automations Light."""

    def __init__(self, data):
        self.entity_id = data["entity_id"]
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._attr_is_on = False
        self._attr_supported_color_modes = {ColorMode.ONOFF}
        self._attr_color_mode = ColorMode.ONOFF
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_is_on = last_state.state == "on"
            if "brightness" in last_state.attributes:
                self._attr_brightness = last_state.attributes["brightness"]
            if "rgb_color" in last_state.attributes:
                self._attr_rgb_color = last_state.attributes["rgb_color"]
            if "effect" in last_state.attributes:
                self._attr_effect = last_state.attributes["effect"]

    def update_data(self, data):
        """Update entity state and attributes."""
        self._attr_name = data.get(CONF_NAME, self._attr_name)
        self._attr_icon = data.get(CONF_ICON, self._attr_icon)
        self._attr_available = data.get(CONF_AVAILABLE, self._attr_available)
        
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
                if k not in ["brightness", "rgb_color", "effect", "effect_list", "supported_color_modes"]}
            
            if "brightness" in attrs: self._attr_brightness = int(attrs["brightness"])
            if "rgb_color" in attrs: self._attr_rgb_color = tuple(attrs["rgb_color"])
            if "effect" in attrs: self._attr_effect = attrs["effect"]
            if "effect_list" in attrs: self._attr_effect_list = attrs["effect_list"]
            
            # Determine supported features and color modes based on attributes
            supported_features = 0
            modes = {ColorMode.ONOFF}

            if "effect_list" in attrs:
                supported_features |= LightEntityFeature.EFFECT
            
            if "rgb_color" in attrs:
                modes = {ColorMode.RGB}
                self._attr_color_mode = ColorMode.RGB
            elif "brightness" in attrs:
                modes = {ColorMode.BRIGHTNESS}
                self._attr_color_mode = ColorMode.BRIGHTNESS
            else:
                self._attr_color_mode = ColorMode.ONOFF
            
            # Allow override via attributes if needed
            if "supported_color_modes" in attrs:
                modes = set(attrs["supported_color_modes"])

            self._attr_supported_features = supported_features
            self._attr_supported_color_modes = modes

        if self.hass:
            self.async_write_ha_state()

    async def async_turn_on(self, **kwargs):
        """Turn the entity on."""
        data = {
            "entity_id": self.entity_id, 
            "unique_id": self._attr_unique_id, 
            "action": "turn_on"
        }
        if ATTR_BRIGHTNESS in kwargs: data["brightness"] = kwargs[ATTR_BRIGHTNESS]
        if ATTR_RGB_COLOR in kwargs: data["rgb_color"] = kwargs[ATTR_RGB_COLOR]
        if ATTR_EFFECT in kwargs: data["effect"] = kwargs[ATTR_EFFECT]
            
        self.hass.bus.async_fire(f"{DOMAIN}_event", data)

    async def async_turn_off(self, **kwargs):
        """Turn the entity off."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {"entity_id": self.entity_id, "unique_id": self._attr_unique_id, "action": "turn_off"})