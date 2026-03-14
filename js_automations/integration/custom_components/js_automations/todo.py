from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.components.todo import (
    TodoListEntity,
    TodoListEntityFeature,
    TodoItem,
    TodoItemStatus,
)
from . import (
    JSAutomationsBaseEntity,
    async_setup_js_platform,
    CONF_ATTRIBUTES,
)

async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the JS Automations todo platform."""
    connection = await async_setup_js_platform(
        hass, "todo", JSAutomationsTodo, async_add_entities
    )
    config_entry.async_on_unload(connection)

class JSAutomationsTodo(JSAutomationsBaseEntity, TodoListEntity):
    """Representation of a JS Automations Todo List."""

    _attr_supported_features = (
        TodoListEntityFeature.CREATE_TODO_ITEM
        | TodoListEntityFeature.UPDATE_TODO_ITEM
        | TodoListEntityFeature.DELETE_TODO_ITEM
    )
    _items: list[TodoItem] = []

    @property
    def todo_items(self) -> list[TodoItem] | None:
        return self._items

    def _restore_state(self, last_state):
        """Zustand für Todo-Items wiederherstellen."""
        super()._restore_state(last_state)
        if "items" in last_state.attributes:
            self._update_items_from_list(last_state.attributes["items"])

    def update_data(self, data):
        """Update Todo spezifische Daten."""
        super().update_data(data)
        if CONF_ATTRIBUTES in data:
            attrs = data[CONF_ATTRIBUTES]
            
            if "items" in attrs:
                self._update_items_from_list(attrs["items"])
                self._attr_extra_state_attributes.pop("items", None)
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
        self._items.append(item)
        self.async_write_ha_state()
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
        self._items = [item if it.uid == item.uid else it for it in self._items]
        self.async_write_ha_state()
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
        self._items = [it for it in self._items if it.uid not in uids]
        self.async_write_ha_state()
        self.hass.bus.async_fire(
            f"{DOMAIN}_event",
            {
                "entity_id": self.entity_id,
                "unique_id": self._attr_unique_id,
                "action": "delete_todo_items",
                "data": {"uids": uids}
            },
        )