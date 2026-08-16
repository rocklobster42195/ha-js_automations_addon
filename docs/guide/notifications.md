# Notifications (`ha.notify` & `ha.ask`)

Send notifications through any configured HA notify service. `ha.notify()` is fire-and-forget; `ha.ask()` sends an **actionable** notification and returns a Promise that resolves with whichever button the user tapped — or a default value once it times out.

> **Requires the Home Assistant Companion App** (iOS/Android) for actionable buttons and most `data` extras. These do not work through the web browser dashboard.

## Simple notifications

```javascript
ha.notify('Motion detected!', {
  title: 'Security',
  target: 'notify.mobile_app_my_phone',
});
```

Omit `target` to broadcast to every configured notifier (`notify.notify`).

## Persistent notifications

Set `persistent: true` to show it in Home Assistant's own sidebar/web UI instead of (or in addition to) a push notification:

```javascript
ha.notify('Backup completed successfully', {
  title: 'System',
  persistent: true,
});
```

`target` is ignored when `persistent` is set.

## Actionable notifications (`ha.ask`)

```javascript
const answer = await ha.ask('Garage door is open. Close it?', {
  title: 'Garage Alert',
  target: 'notify.mobile_app_my_phone',
  timeout: 60000,
  defaultAction: 'SNOOZE',
  actions: [
    { action: 'CLOSE', title: 'Close now' },
    { action: 'SNOOZE', title: 'Remind in 30 min' },
    { action: 'IGNORE', title: 'Ignore' },
  ],
});

if (answer === 'CLOSE') ha.entity('cover.garage_door').close_cover();
if (answer === 'SNOOZE' || answer === null) setTimeout(checkGarage, 30 * 60 * 1000);
```

`answer` resolves to the tapped action's string, or to `defaultAction` (default: `null`) once `timeout` elapses without a response.

**Tips:**

- **Snooze / re-notify loop:** set `defaultAction: 'SNOOZE'` and call the same function again from a `setTimeout` for an automatic reminder.
- **Target one device:** pass `target: 'mobile_app_my_phone'` so only one person is asked.
- **Concurrent asks are safe:** each call gets its own internal correlation id, so responses never get mixed up between overlapping `ha.ask()` calls.
- **Keep action titles short:** iOS truncates notification button titles at roughly 20 characters.

## Sending in the user's language

Combine with `ha.localize()` for bilingual notifications:

```javascript
const message = ha.localize({
  en: 'The washing machine is finished.',
  de: 'Die Waschmaschine ist fertig.',
});
ha.notify(message);
```

See the [API Reference](../API_REFERENCE.md#91-sending-notifications-hanotify) for the full option list of both functions.
