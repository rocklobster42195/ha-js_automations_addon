## Closer To The Core

> Seven new ways to talk to Home Assistant — directly from your scripts.

---

### New API Methods

**`ha.onEvent(eventType, callback)` / `ha.fireEvent(type, data)`**
Subscribe to any HA event bus event — not just `state_changed`. React to automation triggers, NFC tags, custom integration events, or use `ha.fireEvent()` to signal between scripts.

**`ha.getStatistics(statId, options)`**
Query HA's long-term recorder statistics — the same data that powers the Energy Dashboard. Hourly, daily or 5-minute buckets with mean, min, max and sum.

**`ha.renderTemplate(template)`**
Evaluate a Jinja2 template string via HA's own template engine. Full access to `states()`, `distance()`, `relative_time()`, `area_entities()` and everything else HA templates support.

**`ha.getCalendarEvents(entityId, options)`**
Fetch upcoming events from any HA calendar entity — Google Calendar, CalDAV or local.

**`ha.getTodoItems(entityId)`**
Read items from any HA todo list entity. Filter by status, check due dates, drive automations from your shopping list.

**`ha.getLabels()` / `ha.getEntitiesWithLabel(label)`**
Query HA's label registry (2023.6+). Get all labels or resolve every entity carrying a specific label — by ID or display name.

**`ha.getFloors()` / `ha.getAreasInFloor(floor)`**
Access HA's floor registry (2024.2+). List floors and resolve which areas belong to them — by `floor_id` or display name.

---

### Also

- Full **IntelliSense** support for all new methods including typed return interfaces (`HAStatisticEntry`, `HACalendarEvent`, `HATodoItem`, `HALabel`, `HAFloor`, `HACustomEvent`)
- All new methods documented in the **API Reference**
