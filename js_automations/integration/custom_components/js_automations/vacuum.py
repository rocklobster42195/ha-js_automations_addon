from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.vacuum import (
    StateVacuumEntity,
    VacuumEntityFeature,
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
    """Set up the JS Automations vacuum platform."""
    connection = await async_setup_js_platform(
        hass, "vacuum", JSAutomationsVacuum, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsVacuum(JSAutomationsBaseEntity, StateVacuumEntity):
    """Representation of a JS Automations Vacuum."""

    def _restore_state(self, last_state):
        """Zustand für Vacuum wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_state = last_state.state
        attrs = last_state.attributes
        self._attr_battery_level = attrs.get("battery_level")
        self._attr_fan_speed = attrs.get("fan_speed")
        self._attr_fan_speed_list = attrs.get("fan_speed_list")

    def update_data(self, data):
        """Update Vacuum spezifische Daten."""
        super().update_data(data)

        if CONF_STATE in data:
            self._attr_state = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]

            # Native Properties (Reinigungsprogramme/Status)
            if "battery_level" in attrs: self._attr_battery_level = int(attrs["battery_level"])
            if "fan_speed" in attrs: self._attr_fan_speed = attrs["fan_speed"]
            if "fan_speed_list" in attrs: self._attr_fan_speed_list = attrs["fan_speed_list"]
            
            # Bereinigung der Extra Attributes
            managed_keys = ["battery_level", "fan_speed", "fan_speed_list"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

            # Features berechnen
            features = (
                VacuumEntityFeature.START
                | VacuumEntityFeature.STOP
                | VacuumEntityFeature.PAUSE
                | VacuumEntityFeature.RETURN_HOME
                | VacuumEntityFeature.STATE
                | VacuumEntityFeature.STATUS
                | VacuumEntityFeature.BATTERY
                | VacuumEntityFeature.CLEAN_SPOT
                | VacuumEntityFeature.LOCATE
                | VacuumEntityFeature.SEND_COMMAND
            )

            if self._attr_fan_speed_list:
                features |= VacuumEntityFeature.FAN_SPEED

            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_start(self) -> None: self._fire_js_event("start")
    async def async_stop(self, **kwargs) -> None: self._fire_js_event("stop")
    async def async_pause(self) -> None: self._fire_js_event("pause")
    async def async_return_to_base(self, **kwargs) -> None: self._fire_js_event("return_to_base")
    async def async_clean_spot(self, **kwargs) -> None: self._fire_js_event("clean_spot")
    async def async_locate(self, **kwargs) -> None: self._fire_js_event("locate")

    async def async_set_fan_speed(self, fan_speed: str, **kwargs) -> None:
        self._fire_js_event("set_fan_speed", {"fan_speed": fan_speed})

    async def async_send_command(self, command: str, params: dict | list | None = None, **kwargs) -> None:
        self._fire_js_event("send_command", {"command": command, "params": params})