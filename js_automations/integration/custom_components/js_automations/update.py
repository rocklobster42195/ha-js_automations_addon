from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.update import (
    UpdateEntity,
    UpdateEntityFeature,
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
    """Set up the JS Automations update platform."""
    connection = await async_setup_js_platform(
        hass, "update", JSAutomationsUpdate, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsUpdate(JSAutomationsBaseEntity, UpdateEntity):
    """Representation of a JS Automations Update Entity."""

    def _restore_state(self, last_state):
        """Restore state for Update Entity."""
        super()._restore_state(last_state)
        self._attr_installed_version = last_state.state
        attrs = last_state.attributes
        self._attr_latest_version = attrs.get("latest_version")
        self._attr_release_summary = attrs.get("release_summary")
        self._attr_release_url = attrs.get("release_url")
        self._attr_title = attrs.get("title")

    def update_data(self, data):
        """Update Update specific data."""
        super().update_data(data)

        # The state of an update entity is its installed version.
        if CONF_STATE in data:
            self._attr_installed_version = str(data[CONF_STATE]) if data[CONF_STATE] is not None else None

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]

            if "installed_version" in attrs: 
                self._attr_installed_version = str(attrs["installed_version"]) if attrs["installed_version"] is not None else None
            if "latest_version" in attrs: 
                self._attr_latest_version = str(attrs["latest_version"]) if attrs["latest_version"] is not None else None
            if "release_summary" in attrs: 
                self._attr_release_summary = attrs["release_summary"]
            if "release_url" in attrs: 
                self._attr_release_url = attrs["release_url"]
            if "title" in attrs: 
                self._attr_title = attrs["title"]
            if "in_progress" in attrs: 
                self._attr_in_progress = attrs["in_progress"]

            # Determine supported features
            features = UpdateEntityFeature.INSTALL
            if "release_summary" in attrs or "release_url" in attrs:
                features |= UpdateEntityFeature.RELEASE_NOTES
            if "in_progress" in attrs:
                features |= UpdateEntityFeature.PROGRESS
            
            self._attr_supported_features = features

            # Cleanup der Extra Attributes
            managed_keys = [
                "installed_version", "latest_version", "release_summary", 
                "release_url", "title", "in_progress"
            ]
            for key in managed_keys:
                self._attr_extra_state_attributes.pop(key, None)

        if self.hass:
            self.async_write_ha_state()

    async def async_install(self, version: str | None, backup: bool, **kwargs) -> None:
        """Install an update."""
        self._fire_js_event("install", {
            "version": version,
            "backup": backup
        })