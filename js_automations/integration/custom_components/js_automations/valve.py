from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.valve import (
    ValveEntity,
    ValveEntityFeature,
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
    """Set up the JS Automations valve platform."""
    connection = await async_setup_js_platform(
        hass, "valve", JSAutomationsValve, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsValve(JSAutomationsBaseEntity, ValveEntity):
    """Representation of a JS Automations Valve."""

    _optimistic: bool = False

    def _restore_state(self, last_state):
        """Zustand für Valve wiederherstellen."""
        super()._restore_state(last_state)
        self._attr_is_closed = last_state.state == "closed"
        if "current_position" in last_state.attributes:
            self._attr_current_valve_position = last_state.attributes["current_position"]

    def update_data(self, data):
        """Update Valve spezifische Daten."""
        super().update_data(data)
        
        self._attr_reports_position = data.get("reports_position", self._attr_reports_position)
        self._optimistic = data.get("optimistic", self._optimistic)
        
        if CONF_STATE in data:
            state = data[CONF_STATE]
            self._attr_is_opening = state == "opening"
            self._attr_is_closing = state == "closing"
            self._attr_is_closed = state == "closed" or state is False
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "current_position" in attrs: 
                self._attr_current_valve_position = int(attrs["current_position"])
            
            # Features berechnen
            features = ValveEntityFeature.OPEN | ValveEntityFeature.CLOSE | ValveEntityFeature.STOP
            if "current_position" in attrs:
                features |= ValveEntityFeature.SET_POSITION
            
            self._attr_supported_features = features

            # Cleanup der Extra Attributes
            managed_keys = ["current_position", "reports_position", "optimistic"]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

        if self.hass:
            self.async_write_ha_state()

    async def async_open_valve(self, **kwargs) -> None:
        """Open the valve."""
        if self._optimistic:
            self._attr_is_closed, self._attr_is_opening, self._attr_is_closing = False, False, False
            if self.reports_position: self._attr_current_valve_position = 100
            self.async_write_ha_state()
        self._fire_js_event("open_valve")

    async def async_close_valve(self, **kwargs) -> None:
        """Close the valve."""
        if self._optimistic:
            self._attr_is_closed, self._attr_is_opening, self._attr_is_closing = True, False, False
            if self.reports_position: self._attr_current_valve_position = 0
            self.async_write_ha_state()
        self._fire_js_event("close_valve")

    async def async_stop_valve(self, **kwargs) -> None:
        """Stop the valve."""
        if self._optimistic:
            self._attr_is_opening, self._attr_is_closing = False, False
            self.async_write_ha_state()
        self._fire_js_event("stop_valve")

    async def async_set_valve_position(self, position: int) -> None:
        """Set the valve position."""
        if self._optimistic:
            self._attr_current_valve_position = position
            self._attr_is_closed = (position == 0)
            self._attr_is_opening, self._attr_is_closing = False, False
            self.async_write_ha_state()
        self._fire_js_event("set_valve_position", {"position": position})