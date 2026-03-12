from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.update import (
    UpdateEntity,
    UpdateEntityFeature,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE, async_format_device_info
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON, CONF_STATE, CONF_DEVICE_CLASS

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
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

class JSAutomationsUpdate(UpdateEntity, RestoreEntity):
    """Representation of a JS Automations Update Entity."""

    def __init__(self, data):
        self.entity_id = data["entity_id"]
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self.update_data(data)

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        last_state = await self.async_get_last_state()
        if last_state:
            self._attr_installed_version = last_state.state
            if "latest_version" in last_state.attributes:
                self._attr_latest_version = last_state.attributes["latest_version"]
            if "release_summary" in last_state.attributes:
                self._attr_release_summary = last_state.attributes["release_summary"]
            if "release_url" in last_state.attributes:
                self._attr_release_url = last_state.attributes["release_url"]
            if "title" in last_state.attributes:
                self._attr_title = last_state.attributes["title"]

    def update_data(self, data):
        """Update entity state and attributes."""
        self._attr_name = data.get(CONF_NAME, self._attr_name)
        self._attr_icon = data.get(CONF_ICON, self._attr_icon)
        self._attr_available = data.get(CONF_AVAILABLE, self._attr_available)
        self._attr_device_class = data.get(CONF_DEVICE_CLASS, self._attr_device_class)

        # The state of an update entity is its installed version.
        if CONF_STATE in data:
            self._attr_installed_version = str(data[CONF_STATE]) if data[CONF_STATE] is not None else None

        device_info = async_format_device_info(data)
        if device_info: self._attr_device_info = device_info
        
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() 
                if k not in ["installed_version", "latest_version", "release_summary", "release_url", "title", "in_progress"]}
            
            if "installed_version" in attrs: self._attr_installed_version = str(attrs["installed_version"]) if attrs["installed_version"] is not None else None
            if "latest_version" in attrs: self._attr_latest_version = str(attrs["latest_version"]) if attrs["latest_version"] is not None else None
            if "release_summary" in attrs: self._attr_release_summary = attrs["release_summary"]
            if "release_url" in attrs: self._attr_release_url = attrs["release_url"]
            if "title" in attrs: self._attr_title = attrs["title"]
            if "in_progress" in attrs: self._attr_in_progress = attrs["in_progress"]

            # Determine supported features
            features = UpdateEntityFeature.INSTALL
            if "release_summary" in attrs or "release_url" in attrs:
                features |= UpdateEntityFeature.RELEASE_NOTES
            if "in_progress" in attrs:
                features |= UpdateEntityFeature.PROGRESS
            
            self._attr_supported_features = features

        if self.hass:
            self.async_write_ha_state()

    async def async_install(self, version: str | None, backup: bool, **kwargs) -> None:
        """Install an update."""
        self.hass.bus.async_fire(f"{DOMAIN}_event", {
            "entity_id": self.entity_id, 
            "unique_id": self._attr_unique_id, 
            "action": "install",
            "version": version,
            "backup": backup
        })