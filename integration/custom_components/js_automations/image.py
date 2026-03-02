from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.image import ImageEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE

import logging

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the image platform."""

    @callback
    def async_add_image(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsImage(hass, data) # Pass hass to entity for aiohttp_client
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_image", async_add_image)
    )

class JSAutomationsImage(JSAutomationsBaseEntity, ImageEntity):
    """Representation of a JS Automations Image entity."""

    def __init__(self, hass: HomeAssistant, data):
        """Initialize the image entity."""
        self._hass = hass # Store hass for aiohttp_client
        self._attr_image_url = None
        self._attr_content_type = "image/png" # Default, can be overridden
        super().__init__(data)

    def _update_specific_state(self, data):
        """Update image specific state."""
        # For image entities, CONF_STATE is typically not used for the image itself,
        # but could indicate availability or a version string.
        # We primarily rely on attributes for image data.
        if CONF_STATE in data:
            # Optionally use state for something like a version or timestamp
            # self._attr_state = data[CONF_STATE]
            pass

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "image_url" in attrs:
                self._attr_image_url = attrs["image_url"]
            if "content_type" in attrs:
                self._attr_content_type = attrs["content_type"]

    async def async_image(self) -> bytes | None:
        """Return a still image response from the image URL."""
        if not self._attr_image_url:
            _LOGGER.warning(f"No image_url provided for image entity {self.entity_id}")
            return None

        try:
            session = async_get_clientsession(self._hass)
            async with session.get(self._attr_image_url) as response:
                response.raise_for_status() # Raise an exception for bad status codes
                return await response.read()
        except Exception as e:
            _LOGGER.error(f"Error fetching image from {self._attr_image_url} for {self.entity_id}: {e}")
            return None

    # Image entities typically don't have actions like turn_on/off or trigger.
    # Their primary function is to provide an image.
    # If specific actions are needed (e.g., "refresh_image"), they would be custom services
    # or handled via send_event if HA core provides such methods.