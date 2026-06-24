# `ha.history` Computed Helpers

**Status:** Draft  
**Release title:** History Repeating  
**Last updated:** 2026-06-24

---

## Motivation

HA offers computational helpers (trend, derivative, integration, statistics) as persistent entities that must be configured in the UI. For script authors, these require a context switch out of JSA, a helper entity that lives separately from the script, and no flexibility over time windows or parameters at runtime.

`ha.history.get()` and `ha.history.statistics()` already provide the raw data. This concept adds six pure-JS computation functions on top — no HA entities, no UI config, fully parameterizable at call time.

---

## Scope

Only **non-stateful, computational** helpers are in scope. They take entity history data as input and return a computed value. No HA entities are created. No state is persisted. Aggregation helpers (`minOf`, `maxOf`, `sumOf`) are explicitly excluded — they add no meaningful value over two lines of plain JS.

---

## API

All six functions live on the existing `ha.history` sub-namespace. They are `async` because they internally call `ha.history.get()`.

---

### `ha.history.trend()`

```ts
ha.history.trend(
  entityId: EntityID | string,
  options?: {
    period?: string | number   // time window — human string ('1h', '30m', '2d') or ms. Default: '1h'
    sensitivity?: number       // minimum slope magnitude to count as rising/falling. Default: 0.01
  }
): Promise<'rising' | 'falling' | 'stable'>
```

**Use case:** Decide whether to act based on direction, not value. "Is the temperature still rising, or has it peaked?" — a thermostat can hold off turning on the AC if the trend is already falling.

```js
// Only cool down if temperature is actively rising
const trend = await ha.history.trend('sensor.living_room_temperature', { period: '30m' });
if (trend === 'rising') {
  ha.entity('climate.living_room').set_temperature({ temperature: 21 });
}
```

**Implementation:**

1. Call `ha.history.get(entityId, { start: now - period })` with `minimalResponse: true`.
2. Filter entries to numeric states only, parse to `float`.
3. Apply **ordinary least squares linear regression** over `(timestamp, value)` pairs.
4. The slope (in units/ms) is compared against `sensitivity`. Positive → `'rising'`, negative → `'falling'`, within threshold → `'stable'`.

```
slope = (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²)
where x = timestamp offset in ms, y = numeric state value
```

---

### `ha.history.derivative()`

```ts
ha.history.derivative(
  entityId: EntityID | string,
  options?: {
    period?: string | number                    // time window. Default: '1h'
    unit?: 'second' | 'minute' | 'hour'        // rate denominator. Default: 'minute'
    method?: 'linear' | 'polynomial'           // fitting method. Default: 'linear'
    degree?: number                            // polynomial degree (method: 'polynomial' only). Default: 2
  }
): Promise<number>
```

**Use case:** Know the rate of change at this moment, not just the average over the window. Two scenarios need different methods:

- **Monotone curves** (battery drain, humidity, CO₂ buildup): `method: 'linear'` — OLS slope over all points, robust against measurement noise.
- **Non-linear curves** (heating, charging, temperature overshoot): `method: 'polynomial'` — fits a curve to the data and returns the instantaneous slope *at the last point*. A room heating up fast then slowing as it approaches target temperature is degree 2; a sauna with an initial spike and tail-off fits better at degree 3.

```js
// Linear: how fast is the battery draining? (monotone decline)
const rate = await ha.history.derivative('sensor.phone_battery', {
  period: '2h',
  unit: 'hour',
});
ha.log(`Battery draining at ${Math.abs(rate).toFixed(1)}%/h`);

// Polynomial: current heating rate of a non-linear warming curve
const rate = await ha.history.derivative('sensor.living_room_temperature', {
  period: '45m',
  unit: 'minute',
  method: 'polynomial',
  degree: 2,
});
const current = parseFloat(ha.getStateValue('sensor.living_room_temperature'));
const minutesLeft = rate > 0 ? (21 - current) / rate : Infinity;
ha.log(`Room reaches 21 °C in ~${Math.round(minutesLeft)} min`);
```

**Implementation — `method: 'linear'` (default):**

1. Call `ha.history.get(entityId, { start: now - period })`, filter to numeric entries.
2. Compute OLS slope over all `(timestamp, value)` pairs (same formula as `trend()`):
   ```
   slope = (n·Σxy − Σx·Σy) / (n·Σx² − (Σx)²)
   where x = timestamp offset in ms from first entry, y = numeric state value
   ```
3. Scale slope to `unit` (slope is in units/ms → multiply by 1000 for /s, 60000 for /min, 3600000 for /h).

**Implementation — `method: 'polynomial'`:**

1. Call `ha.history.get(entityId, { start: now - period })`, filter to numeric entries. Normalize timestamps to `x ∈ [0, 1]` (avoids numerical instability with large epoch values).
2. Build the **Vandermonde matrix** `V` of size `n × (degree+1)`, where `V[i][j] = xᵢʲ`.
3. Solve the normal equations `(VᵀV) · c = Vᵀy` for coefficients `c` using Gaussian elimination. This fits the least-squares polynomial through all points.
4. Compute the **analytical derivative** of the polynomial at `x = 1` (the last/current point):
   ```
   p(x)  = c₀ + c₁x + c₂x² + c₃x³ + …
   p′(x) = c₁ + 2c₂x + 3c₃x² + …
   p′(1) = Σ j·cⱼ  for j = 1..degree
   ```
5. Re-scale from normalized `x` space back to real time, then scale to `unit`.

> `degree: 2` (parabola) covers most real-world heating and charging curves. `degree: 3` adds an inflection point for curves with an initial spike. Values above 3 risk overfitting noisy sensor data and are not recommended.

---

### `ha.history.integral()`

```ts
ha.history.integral(
  entityId: EntityID | string,
  options?: {
    period?: string | number   // time window. Default: '1h'
    unit?: 'second' | 'minute' | 'hour'  // time unit for the output denominator. Default: 'hour'
    method?: 'left' | 'right' | 'trapezoidal'  // Default: 'trapezoidal'
  }
): Promise<number>
```

**Use case:** Convert a rate sensor (W) into a cumulative value (Wh) over a custom time window. HA's own integration helper does this, but only for the entire entity lifetime, not for a specific window.

```js
// How many Wh did the washing machine use in the last cycle? (last 2 hours)
const wh = await ha.history.integral('sensor.washing_machine_power', {
  period: '2h',
  unit: 'hour',
});
ha.log(`Last wash cycle used ${wh.toFixed(0)} Wh`);
```

**Implementation:**

1. Call `ha.history.get(entityId, { start: now - period })`.
2. Filter to numeric entries, sort by time.
3. Apply the **trapezoidal rule** (default): for each pair of adjacent entries `(t1,v1)` and `(t2,v2)`, add `(v1 + v2) / 2 * (t2 - t1)` (in ms). Sum all trapezoids.
4. Divide by the unit divisor (ms → seconds: ÷1000, ms → minutes: ÷60000, ms → hours: ÷3600000).
5. `left` method uses `v1` for the interval; `right` uses `v2`.

---

### `ha.history.stats()`

```ts
ha.history.stats(
  entityId: EntityID | string,
  options?: {
    period?: string | number   // time window. Default: '24h'
  }
): Promise<{
  mean: number
  min: number
  max: number
  median: number
  stddev: number
  count: number
}>
```

**Use case:** Answer "what was the average temperature last night?" or "what was the peak power draw today?" without setting up a statistics helper entity in HA.

```js
// Daily report: temperature summary for the bedroom
const s = await ha.history.stats('sensor.bedroom_temperature', { period: '24h' });
ha.notify(
  `Bedroom last 24h: avg ${s.mean.toFixed(1)}°C, min ${s.min.toFixed(1)}°C, max ${s.max.toFixed(1)}°C`,
  { title: 'Daily Temperature Report' }
);
```

**Implementation:**

1. Call `ha.history.get(entityId, { start: now - period })`.
2. Filter to numeric entries, collect as `values[]`.
3. Compute:
   - `mean` = Σvalues / n
   - `min` / `max` = `Math.min/max(...values)`
   - `median` = sort, take middle (or average of two middle values)
   - `stddev` = `Math.sqrt(Σ(v - mean)² / n)`
   - `count` = n

> For long periods (weeks/months) consider using `ha.history.statistics()` with `period: 'day'` instead, as it uses HA's pre-aggregated recorder data and is significantly faster.

---

### `ha.history.timeSince()`

```ts
ha.history.timeSince(
  entityId: EntityID | string,
  state?: string   // if provided: ms since this specific state was last entered. Default: last state change of any kind.
): Promise<number>  // milliseconds
```

**Use case:** "How long has the front door been open?" or "How long since the last motion event?" Replaces the common pattern of reading `last_changed` manually and doing the math.

```js
// Alert if front door has been open for more than 10 minutes
ha.on('binary_sensor.front_door', async () => {
  if (ha.getStateValue('binary_sensor.front_door') === true) {
    await sleep(10 * 60 * 1000);
    const ms = await ha.history.timeSince('binary_sensor.front_door', 'on');
    if (ms >= 10 * 60 * 1000) {
      ha.notify('Front door still open!', { title: 'Security' });
    }
  }
});
```

**Implementation:**

- **Without `state` argument:** Read `ha.getState(entityId).last_changed`, return `Date.now() - new Date(last_changed).getTime()`. No history call needed.
- **With `state` argument:** Call `ha.history.get(entityId, { start: now - 24h })`, walk entries in reverse to find the last entry where `state` first appears (i.e., transition *into* that state). Return `Date.now() - entryTimestamp`. If not found in 24h window, extend to 7 days.

---

### `ha.history.timeInState()`

```ts
ha.history.timeInState(
  entityId: EntityID | string,
  state: string,
  options?: {
    period?: string | number   // time window. Default: '24h'
    start?: Date
    end?: Date
  }
): Promise<number>  // milliseconds
```

**Use case:** "How many minutes was the heating on today?" or "What percentage of the day was the solar panel active?" Replaces the need for a HA utility meter or custom template sensor.

```js
// How long was heating on today? Express as percentage.
const ms = await ha.history.timeInState('climate.living_room', 'heat', { period: '24h' });
const pct = (ms / (24 * 60 * 60 * 1000) * 100).toFixed(1);
ha.log(`Heating was active ${pct}% of the last 24 hours`);
```

**Implementation:**

1. Call `ha.history.get(entityId, { start: now - period })`.
2. Iterate entries sequentially. For each entry where `state === target`, accumulate the duration until the next entry's timestamp (or `now` for the last entry).
3. Sum all matching durations.

Edge case: If the first entry in the window already has the target state, the duration from `start` to that entry's timestamp must be included (the entity was already in that state at the start of the window).

---

## Implementation Plan

### New file: `js_automations/core/ha-history-helpers.js`

Pure computation module. Exports the six functions. Each function receives the `ha` object as its first argument (injected at bind time — not exposed to the script author).

```js
// structure
export function trend(ha, entityId, options) { ... }
export function derivative(ha, entityId, options) { ... }
export function integral(ha, entityId, options) { ... }
export function stats(ha, entityId, options) { ... }
export function timeSince(ha, entityId, state) { ... }
export function timeInState(ha, entityId, state, options) { ... }
```

Shared utility inside the module:
- `parsePeriod(value)` — converts `'1h'`, `'30m'`, `'2d'` or a raw number (ms) to milliseconds.
- `toNumeric(entries)` — filters history entries to those with parseable float states.

### Binding in `js_automations/core/worker-wrapper.js`

Add `ha.history` sub-namespace where `get()` and `statistics()` already live. Bind the six helpers:

```js
import * as historyHelpers from './ha-history-helpers.js';

ha.history = {
  get: (entityId, options) => fetchHistory(entityId, options),
  statistics: (statId, options) => fetchStatistics(statId, options),
  trend: (entityId, options) => historyHelpers.trend(ha, entityId, options),
  derivative: (entityId, options) => historyHelpers.derivative(ha, entityId, options),
  integral: (entityId, options) => historyHelpers.integral(ha, entityId, options),
  stats: (entityId, options) => historyHelpers.stats(ha, entityId, options),
  timeSince: (entityId, state) => historyHelpers.timeSince(ha, entityId, state),
  timeInState: (entityId, state, options) => historyHelpers.timeInState(ha, entityId, state, options),
};
```

### Type definitions: `js_automations/core/types/ha-api.d.ts`

Extend the existing `ha.history` block with the six new method signatures (see API section above).

---

## Period String Format

All `period` options accept:
- A **human string**: `'30m'`, `'2h'`, `'1d'`, `'7d'`
- A **raw number** in milliseconds: `1800000`

Supported units in string format: `s` (seconds), `m` (minutes), `h` (hours), `d` (days).

---

## Out of Scope

- **Stateful helpers** (`timer`, `counter`, `input_boolean`, `input_select`): these need to live as HA entities to be visible in dashboards and other automations. Use `ha.register()` for that.
- **Aggregation** (`minOf`, `maxOf`, `sumOf`): adding negligible value over native JS (`Math.min(...ids.map(id => parseFloat(ha.getStateValue(id))))`).
- **Forecast / prediction**: out of scope for v1.
