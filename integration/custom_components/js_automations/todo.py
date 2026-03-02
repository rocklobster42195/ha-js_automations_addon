from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.todo import (
    TodoEntity,
    TodoItem,
    TodoItemStatus,
    TodoEntityFeature,
)
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES
from .entity_base import JSAutomationsBaseEntity
from homeassistant.const import CONF_UNIQUE_ID, CONF_STATE

from datetime import datetime, date
import logging

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the todo platform."""

    @callback
    def async_add_todo(data: dict):
        """Handle entity creation signal."""
        unique_id = data[CONF_UNIQUE_ID]
        if unique_id in hass.data[DOMAIN][DATA_ENTITIES]:
            return
        entity = JSAutomationsTodo(data)
        hass.data[DOMAIN][DATA_ENTITIES][unique_id] = entity
        async_add_entities([entity])

    config_entry.async_on_unload(
        async_dispatcher_connect(hass, f"{SIGNAL_ADD_ENTITY}_todo", async_add_todo)
    )

class JSAutomationsTodo(JSAutomationsBaseEntity, TodoEntity):
    """Representation of a JS Automations Todo list."""

    def __init__(self, data):
        """Initialize the todo entity."""
        self._attr_todo_items = [] # Stores the todo items pushed from Node.js
        self._attr_supported_features = (
            TodoEntityFeature.CREATE_TODO_ITEM
            | TodoEntityFeature.UPDATE_TODO_ITEM
            | TodoEntityFeature.DELETE_TODO_ITEM
        )
        super().__init__(data)

    def _parse_todo_items(self, item_data_list: list[dict]) -> list[TodoItem]:
        """Parse raw todo item data from Node.js into TodoItem objects."""
        items = []
        for item_data in item_data_list:
            try:
                due_date = None
                if item_data.get("due"):
                    try:
                        due_date = datetime.fromisoformat(item_data["due"])
                    except ValueError:
                        due_date = date.fromisoformat(item_data["due"])

                last_modified = None
                if item_data.get("last_modified"):
                    last_modified = datetime.fromisoformat(item_data["last_modified"])

                items.append(
                    TodoItem(
                        uid=item_data["uid"],
                        summary=item_data["summary"],
                        status=TodoItemStatus(item_data.get("status", TodoItemStatus.NEEDS_ACTION)),
                        description=item_data.get("description"),
                        due=due_date,
                        last_modified=last_modified,
                    )
                )
            except (ValueError, KeyError) as e:
                _LOGGER.warning(f"Invalid todo item data received for {self.entity_id}: {item_data} - {e}")
        return items

    def _update_specific_state(self, data):
        """Update todo specific state."""
        if CONF_STATE in data:
            self._attr_state = data[CONF_STATE]

        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            if "todo_items" in attrs: # Node.js pushes the full item list
                self._attr_todo_items = self._parse_todo_items(attrs["todo_items"])
            
            if "supported_features" in attrs:
                self._attr_supported_features = TodoEntityFeature(attrs["supported_features"])

    async def async_create_todo_item(self, item: TodoItem) -> None:
        """Create a new todo item."""
        # Convert TodoItem object to a dictionary for sending to Node.js
        self.send_event("create_todo_item", item.__dict__)

    async def async_update_todo_item(self, item: TodoItem) -> None:
        """Update an existing todo item."""
        # Convert TodoItem object to a dictionary for sending to Node.js
        self.send_event("update_todo_item", item.__dict__)

    async def async_delete_todo_item(self, uids: list[str]) -> None:
        """Delete todo items."""
        self.send_event("delete_todo_item", {"uids": uids})