from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.update import (
    UpdateEntity,
    UpdateEntityFeature,
    ATTR_INSTALLED_VERSION,
    ATTR_LATEST_VERSION,
    ATTR_RELEASE_URL,
    ATTR_RELEASE_SUMMARY,
    ATTR_AUTO_UPDATE,
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
    """Set up the update platform."""

    @callback
    def async_add_update(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsUpdate(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_update", async_add_update)
    )

class JSAutomationsUpdate(JSAutomationsBaseEntity, UpdateEntity):
    """Representation of a JS Automations Update entity."""

    def __init__(self, data):
        """Initialize the update entity."""
        self._attr_installed_version = None
        self._attr_latest_version = None
        self._attr_release_url = None
        self._attr_release_summary = None
        self._attr_auto_update = None
        self._attr_supported_features = UpdateEntityFeature.INSTALL
        super().__init__(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            attrs = last_state.attributes
            if ATTR_INSTALLED_VERSION in attrs: self._attr_installed_version = attrs[ATTR_INSTALLED_VERSION]
            if ATTR_LATEST_VERSION in attrs: self._attr_latest_version = attrs[ATTR_LATEST_VERSION]
            if ATTR_RELEASE_URL in attrs: self._attr_release_url = attrs[ATTR_RELEASE_URL]
            if ATTR_RELEASE_SUMMARY in attrs: self._attr_release_summary = attrs[ATTR_RELEASE_SUMMARY]
            if ATTR_AUTO_UPDATE in attrs: self._attr_auto_update = attrs[ATTR_AUTO_UPDATE]

    def _update_specific_state(self, data):
        """Update update specific state."""
        # The state of an update entity is usually 'on' (update available) or 'off' (no update)
        # or the installed version. We primarily use attributes for version info.
        if CONF_STATE in data:
            self._attr_installed_version = str(data[CONF_STATE])

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if ATTR_INSTALLED_VERSION in attrs: self._attr_installed_version = attrs[ATTR_INSTALLED_VERSION]
            if ATTR_LATEST_VERSION in attrs: self._attr_latest_version = attrs[ATTR_LATEST_VERSION]
            if ATTR_RELEASE_URL in attrs:
                self._attr_release_url = attrs[ATTR_RELEASE_URL]
                self._attr_supported_features |= UpdateEntityFeature.RELEASE_NOTES
            if ATTR_RELEASE_SUMMARY in attrs:
                self._attr_release_summary = attrs[ATTR_RELEASE_SUMMARY]
                self._attr_supported_features |= UpdateEntityFeature.RELEASE_NOTES
            if ATTR_AUTO_UPDATE in attrs:
                self._attr_auto_update = attrs[ATTR_AUTO_UPDATE]
                self._attr_supported_features |= UpdateEntityFeature.AUTO_UPDATE
            if "supported_features" in attrs:
                self._attr_supported_features = UpdateEntityFeature(attrs["supported_features"])

    async def async_install(self, version: str | None, backup: bool, **kwargs) -> None:
        """Install an update."""
        payload = {"backup": backup}
        if version:
            payload["version"] = version
        if kwargs:
            payload.update(kwargs)
        self.send_event("install", payload)