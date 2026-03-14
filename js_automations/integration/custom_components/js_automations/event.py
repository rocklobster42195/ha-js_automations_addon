from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.event import (
    EventEntity,
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
    """Set up the JS Automations event platform."""
    connection = await async_setup_js_platform(
        hass, "event", JSAutomationsEvent, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsEvent(JSAutomationsBaseEntity, EventEntity):
    """Representation of a JS Automations Event Entity."""

    _attr_event_types: list[str] = []

    def update_data(self, data):
        """Update Event spezifische Daten und Trigger-Logik."""
        super().update_data(data)

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES].copy()
            
            # Definition der Typen
            if "event_types" in attrs:
                self._attr_event_types = attrs.pop("event_types")
                # Verhindere, dass die Typenliste in den Attributen angezeigt wird
                self._attr_extra_state_attributes.pop("event_types", None)

            # Trigger Logik
            if CONF_STATE in data and data[CONF_STATE]:
                event_type = str(data[CONF_STATE])
                if event_type in (self._attr_event_types or []):
                    # Wir triggern das Event mit den verbleibenden Attributen als Payload
                    self._trigger_event(event_type, attrs)