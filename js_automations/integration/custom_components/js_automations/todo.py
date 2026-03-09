from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.todo import (
    TodoListEntity,
    TodoListEntityFeature,
    TodoItem,
    TodoItemStatus,
)
from homeassistant.helpers.restore_state import RestoreEntity
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from . import DOMAIN, SIGNAL_ADD_ENTITY, DATA_ENTITIES, CONF_ATTRIBUTES, CONF_DEVICE_INFO, CONF_AVAILABLE
from homeassistant.const import CONF_UNIQUE_ID, CONF_NAME, CONF_ICON

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the platform."""
    
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

class JSAutomationsTodo(TodoListEntity, RestoreEntity):
    """Representation of a JS Automations Todo List."""

    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
    )

    def __init__(self, data):
        self._attr_unique_id = data[CONF_UNIQUE_ID]
        self._attr_should_poll = False
        self._items: list[TodoItem] = []
        self.update_data(data)

    @property
    def todo_items(self) -> list[TodoItem] | None:
        """Get the todo items."""
        return self._items

    async def async_added_to_hass(self) -> None:
        """Run when entity about to be added to hass."""
        await super().async_added_to_hass()
        # Try to restore items from last state attributes if available
        last_state = await self.async_get_last_state()
        if last_state and "items" in last_state.attributes:
            self._update_items_from_list(last_state.attributes["items"])

    def update_data(self, data):
        """Update entity state and attributes."""
        if CONF_NAME in data: self._attr_name = data[CONF_NAME]
        if CONF_ICON in data: self._attr_icon = data[CONF_ICON]
        if CONF_AVAILABLE in data: self._attr_available = data[CONF_AVAILABLE]

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
            # Filter out items from extra_state_attributes to avoid duplication in state machine
            self._attr_extra_state_attributes = {k: v for k, v in attrs.items() if k != "items"}
            
            if "items" in attrs:
                self._update_items_from_list(attrs["items"])

        if self.hass:
            self.async_write_ha_state()

    def _update_items_from_list(self, raw_items: list[dict]):
        """Helper to parse items from a list of dicts."""
        new_items = []
        for item in raw_items:
            status_str = item.get("status", "needs_action")
            try:
                status = TodoItemStatus(status_str)
            except ValueError:
                status = TodoItemStatus.NEEDS_ACTION

            new_items.append(
                TodoItem(
                    uid=item.get("uid"),
                    summary=item.get("summary"),
                    status=status,
                    due=item.get("due"),
                    description=item.get("description"),
                )
            )
        self._items = new_items

    async def async_create_todo_item(self, item: TodoItem) -> None:
        """Add an item to the todo list."""
        self.hass.bus.async_fire(
            f"{DOMAIN}_event",
            {
                "entity_id": self.entity_id,
                "unique_id": self._attr_unique_id,
                "action": "create_todo_item",
                "data": {
                    "summary": item.summary,
                    "status": str(item.status),
                    "due": item.due,
                    "description": item.description,
                }
            },
        )

    async def async_update_todo_item(self, item: TodoItem) -> None:
        """Update a todo item."""
        self.hass.bus.async_fire(
            f"{DOMAIN}_event",
            {
                "entity_id": self.entity_id,
                "unique_id": self._attr_unique_id,
                "action": "update_todo_item",
                "data": {
                    "uid": item.uid,
                    "summary": item.summary,
                    "status": str(item.status),
                    "due": item.due,
                    "description": item.description,
                }
            },
        )

    async def async_delete_todo_items(self, uids: list[str]) -> None:
        """Delete todo items."""
        self.hass.bus.async_fire(
            f"{DOMAIN}_event",
            {
                "entity_id": self.entity_id,
                "unique_id": self._attr_unique_id,
                "action": "delete_todo_items",
                "data": {"uids": uids}
            },
        )