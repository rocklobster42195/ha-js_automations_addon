# Beregnung Multi-Zone & Programme: Grill / Discovery Notes

Date: 2026-08-13 · Goal: figure out how to extend scripts/beregnung.ts from one valve to three zones, whether "Programme" (named watering sequences) make sense, and whether a preliminary "Programm" card is worth building now

## Summary / key decisions

**Current state:** only 1 zone physically installed today (2 more planned). This is architecture/vision work for where `scripts/beregnung.ts` is headed, not an immediate build — most of it depends on hardware (zones 2/3, a soil-moisture sensor) that doesn't exist yet.

**1. Multi-zone core (buildable once zones 2/3 exist):**

- Each zone = a separate physical valve entity, with its own **watering duration** and its own **pre-watering duration** (both per-zone configurable, like today's `number.beregnung_dauer`).
- **Soaking** stays a single global pause shared by the whole run (not per-zone — keeps interleave timing unambiguous).
- Zones run **sequentially** (one valve at a time — water pressure), but **phases are synchronized across zones**: all zones pre-water first (in sequence), then one shared soak pause, then all zones water (in sequence) — the "cycle and soak" pattern real sprinkler controllers use, since zone 1 passively soaks while zones 2/3 are still being pre-watered.
- No separate "Programm" concept — collapsed into per-zone config. Each zone directly owns its own **active weekdays** (day only, not clock time — the existing "finish before sunrise" trigger mechanism is unchanged and non-negotiable). Trade-off: no built-in way to toggle a _group_ of zones together (e.g. a future "vacation mode") — not needed now, but re-adding a grouping layer later is a bigger change than building it in from the start would have been.

**2. UI — a new "Beregnung" `@card` (dedicated Lovelace card, not raw entities):**

- **Status tab**: current state, global stop, rain-sensitivity selector, quick "start all active zones."
- **One tab per installed zone**: name, active weekdays, pre-watering duration, watering duration, real on/off switch, "water now" button. Tabs for zones 2/3 appear automatically once that hardware exists — no card rework needed. Exact layout is a starting proposal, not locked in.

**3. Dumb-Timer vs. Smart-Timer (per zone, future — depends on plant-type profiles + a Claude API integration):**

- **Dumb-Timer** = today's behavior: fixed configured duration.
- **Smart-Timer** = duration comes from a daily Claude API call (once per day, before the automatic cycle only — not on manual watering), given plant type + today's weather forecast, returning `{duration_minutes, confidence, reasoning}`. Falls back to the fixed duration on any failure or out-of-range response — AI output must never directly, unclamped, control how long a valve stays open.
- Each zone gets a **plant type** (initial list: Rasen, Rhododendren, Beete, Kübelpflanzen), each plant type carries a profile `{durationMin, durationMax, moistureThreshold?}` used to clamp the AI's recommendation to sensible per-plant bounds (replacing a generic clamp).
- Status tab shows the current recommendation, its reasoning, last-fetched time, and a visible indicator whenever the fallback path is active.

**4. Safety veto layers, applying unconditionally regardless of Dumb/Smart mode (in priority order):**

1. Rain-forecast veto (`isRainExpected()` — already built and shipped).
2. Soil-moisture veto (future, once a sensor exists) — e.g. skip entirely for waterlogging-sensitive plants like Rhododendren, overriding even the AI/program duration. Read **once, before the cycle starts** (never during active watering, to avoid reacting to the sensor spike watering itself causes).

**5. Long-term vision — self-calibration:** once real moisture data exists, measure the actual moisture response some time after each watering and derive a **per-zone calibration multiplier** (e.g. 0.8×) applied on top of whichever duration source is active (Dumb or Smart) — accounts for per-zone flow rate/soil type that can't be known in advance. Exact learning algorithm intentionally left unspecified — this captures the _shape_ of the idea only.

**What's genuinely still open**, not just deferred-on-hardware:

- Whether per-program/per-zone duration _overrides_ beyond the plant profile are ever wanted (Q5c flag).
- What specifically the user wanted changed in the Q10 prompt/JSON draft — got redirected into the Dumb/Smart split before the actual answer landed.
- Actual numeric values for plant-type duration bounds and moisture thresholds (Q12) — shape only, no numbers yet.
- The residual-moisture edge case (Q13) and the exact calibration-learning algorithm (Q14) — real sensor data needed before these can be resolved sensibly.

## Q&A log

### Q1 — What is a "zone" concretely?

- Asked: Are the three zones three separate physical valves (like `CONFIG.valveEntity` ×3), each with its own duration, or a shared duration across all zones?
- Captured: **Each zone gets its own independent duration.** Confirms zones = separate physical valve entities, each individually configurable — not a single shared timing applied uniformly across all three.
- Flags: none.

### Q2 — Sequential or parallel zone execution

- Asked: Do the three zones run one after another, or all at once?
- Captured: **Sequential.** Matches existing single-valve-at-a-time design and typical residential water pressure constraints.
- Flags: none.

### Q3 — Phase sequencing across zones

- Asked: Does each zone run its own complete pre-watering→soaking→watering sequence before the next zone starts, or are phases synchronized across all zones (all zones pre-water, then all soak, then all water)?
- Captured: **Synchronized across zones.** This is the more sophisticated "cycle and soak" pattern real multi-zone sprinkler controllers use — while zone 2/3 are being pre-watered, zone 1 is already passively soaking, shortening total cycle time vs. running each zone's full independent sequence back to back.
- Flags: none.

### Q4 — Per-zone vs. global phase durations

- Asked: Should pre-watering duration also be per-zone (like watering, per Q1), with soaking staying a single global pause for the whole run?
- Captured: **Confirmed as proposed** — pre-watering is per-zone configurable (different soil per zone may need different pre-wetting), soaking stays one shared global CONFIG value applied once between the pre-watering round and the watering round (keeps the interleave timing unambiguous — no "whose soak timer counts" question).
- Flags: none.

### Q5 — What defines a "Programm"

- Asked: Is a program just a named zone subset, or does it also involve timing/conditions?
- Captured: User redirected — a program should incorporate **time and/or soil moisture (optionally)**, not just a zone subset. This ties directly to the pre-existing deferred TODO in beregnung.ts ("leak detection, soil moisture gating... not carried over").
- Flags: resolved by Q5b/Q5c below.

### Q5b — Soil moisture sensor availability

- Asked: Is a soil moisture sensor already installed/available in HA, or still a future idea?
- Captured: **Not yet available — a future idea.** Soil-moisture gating should be considered in the architecture (leave room for it) but is explicitly NOT implemented now, same treatment as rain-forecast gating got before `weather.reg77` existed.
- Flags: revisit once a real soil-moisture entity exists, same pattern as `isRainExpected()`'s fail-open design.

### Q5c — What "time" means for a program

- Asked: Does a program's time component mean a fixed day/time schedule (replacing or alongside the sunrise trigger), or something else?
- Captured: **Only the DAY matters, not a specific clock time.** User's words: "es geht dann nur um den Tag. Ich möchte immer vor Sonnenaufgang wässern" — the existing "finish before sunrise" timing mechanism stays exactly as-is and is non-negotiable; a program adds is a day-of-week filter (e.g. "this program is only active Tue/Fri") on top of the existing sunrise-anchored automatic trigger, not a replacement for it.
- **Synthesized definition of a "Programm" (combining Q5/Q5b/Q5c):** a named combination of (a) which zone subset runs, (b) which days of the week it's active, and (c) — later, once hardware exists — an optional soil-moisture gate. Duration/order per zone still comes from the zone config (per Q1/Q4), not overridden per-program (no evidence yet that per-program duration overrides are wanted — worth confirming explicitly if it matters).
- Flags: none of my Q5 multiple-choice options matched what the user actually wanted (zone-subset-only, custom order, or duration override) — the real axis was time/conditions, not zone-selection mechanics. Worth double-checking later whether per-program duration overrides are ever wanted, or whether the zone config is always authoritative.

### Q6 — Program configuration mechanism

- Asked: Should programs be configured via a dedicated Lovelace card, a JSON block in the script, or HA-native entities (matching today's zone-duration/rain-sensitivity pattern)?
- Captured: **Dedicated Lovelace card** — visual UI, no code editing needed to add/change programs. Matches the JSA platform's existing `@card` pattern (OpenLigaDB, Trash Reminder already do this).
- Flags: none — decided.

### Q7 — What "card as a preliminary step" means

- Asked: Does "introduce the card now as a preliminary step" mean a UI mockup before the 3-zone backend exists, backend-first, or both together?
- Captured: Context that reframes everything — **only 1 zone is physically installed today** (2 and 3 are future hardware, not yet real). User wants to see a visual preview of the eventual UI now, and floated their own idea: a **Status tab** + **per-zone tabs** where each zone's schedule/program is configured. Explicitly invited alternative suggestions ("nur eine Idee, Vorschläge willkommen").
- I proposed (accepted): **Status tab** (current state, global stop, rain-sensitivity selector, quick "start all active zones") + **one tab per installed zone** (name, active weekdays, pre-watering duration, watering duration, real on/off switch, "water now" button) — tabs for zones 2/3 simply appear once that hardware exists, no card rework needed.
- Flags: none for the overall shape — resolved by Q7b below on whether "Programm" survives as its own concept.

### Q7b — Does "Programm" survive as a separate concept, or collapse into per-zone config?

- Asked: Should "Programm" stay a distinct named layer above zones (e.g. for grouping/toggling multiple zones together), or collapse entirely into per-zone tabs (each zone directly owns its own weekdays, no separate Program abstraction)?
- Captured: **Collapses into zones.** No separate "Programm" concept — each zone tab directly owns its own active-weekdays + durations. Simpler, avoids maintaining two layers (zones AND programs) that would otherwise need to stay in sync. Note: this trades away the "toggle a named group of zones together" use case (e.g. a future "Urlaubsmodus" that disables multiple zones at once) — not raised as a current need, but worth remembering if it comes up later, since re-introducing a grouping layer afterward is a bigger change than designing for it now would have been.
- Flags: none — decided, with the above trade-off noted for future reference.

### NEW BRANCH — AI-powered watering recommendations ("smarte Bewässerung")

User introduced a significant new idea: per-zone **plant type** (e.g. Zone 1 is currently "Rasen"/lawn, reconfigurable to "Rhododendren" now that they're the ones physically connected to that valve) combined with a **Claude API query** for a weather-aware watering recommendation, including designing the prompt/JSON response shape, what shows on the Status tab, and a fallback strategy.

### Q8 — Does the AI recommendation replace or complement existing logic?

- Asked: Should the AI suggest the watering _duration_ (dynamically, replacing the fixed per-zone number), while the existing rain-forecast hard-veto (`isRainExpected()`) stays as a safety net regardless of what the AI says? And should the recommendation apply automatically or just be displayed for manual approval?
- Captured: **Automatically applied.** AI recommendation directly sets the watering duration used for the next automatic run. The existing `isRainExpected()` rain-check stays as an independent hard veto layer on top — AI decides "how much", the existing rain gate still decides "whether at all, if rain is actually coming". User's choice to automate (rather than require manual approval) is exactly why a fallback strategy matters — an automated system needs to degrade safely when the AI call fails.
- Flags: none — decided.

### Q9 — Plant types and query frequency

- Asked: Which plant types initially selectable per zone? How often does the AI get queried?
- Captured: Plant types = **Rasen, Rhododendren, Beete, Kübelpflanzen** (select entity per zone, same pattern as `select.beregnung_regenempfindlichkeit`). Query frequency = **once per day, before the automatic cycle only** — not on every manual watering press (matches how `isRainExpected()` is already scoped to the automatic path only, not `startManualWatering()`).
- Flags: none — decided.

### Q10 — Draft prompt/JSON/status/fallback design

- Asked: Reaction to a concrete draft: Claude prompt including plant type + today's weather, JSON response `{duration_minutes, confidence, reasoning}`, Status tab showing the recommendation + reasoning + last-fetched timestamp + fallback indicator, and a hard safety principle (AI output is never trusted unclamped — always fall back to the fixed zone duration on failure or an out-of-range value, since this directly controls a physical valve).
- Captured: **Roughly right, but with changes** — user hasn't yet specified exactly what to change (asked as a follow-up). Separately, user added: **soil moisture should be incorporated into the AI prompt later**, once the sensor (deferred per Q5b) actually exists — i.e., the eventual prompt should include real soil moisture readings alongside weather + plant type as additional context for the AI's recommendation.
- Flags: **What exactly should change in the draft?** -> pending, asked as follow-up below.

### Q10b — What changes to the draft

- Asked: (follow-up) What specifically should change in the Q10 draft?
- Captured: Introduces a **Dumb-Timer vs. Smart-Timer** mode split. User's exact framing: the future soil-moisture sensor "entscheidet dann, ob überhaupt gegossen werden sollte. 'Oh, Rhododendren haben ggf. Staunässe — gar nicht gießen.' Das würde dann sogar das Programm überschreiben." — soil moisture becomes a hard veto that overrides everything else (AI recommendation AND the fixed program duration), specifically flagged for waterlogging-sensitive plants like Rhododendren.
- **Dumb-Timer** = today's existing behavior: fixed per-zone duration from config, no AI call.
- **Smart-Timer** = AI recommendation (per Q8-Q10) sets the duration instead of the fixed config value.
- Flags: resolved by Q11 below (where the moisture veto sits relative to this mode split).

### Q11 — Does the soil-moisture veto apply regardless of Dumb/Smart mode?

- Asked: Should the future waterlogging veto always apply (like the existing rain-check), or only when Smart-Timer mode is active?
- Captured: **Always applies, regardless of mode** — treated as pure safety logic, same tier as the existing rain-forecast veto, not a "smart feature" that can be opted out of. Only the _duration calculation_ (fixed number vs. AI recommendation) is the actual Dumb/Smart distinction; the moisture veto and the rain veto both sit above that, applying unconditionally once the sensor exists.
- Flags: none — decided.

**Updated priority model for automatic watering (once soil moisture sensor exists):**

1. Rain-forecast veto (`isRainExpected()`, already built) — hard "skip entirely" gate, always applies.
2. Soil-moisture veto (future, not yet built) — hard "skip entirely" gate for waterlogging risk, always applies, overrides even the program/AI duration.
3. Duration source, per zone's Dumb/Smart setting: Dumb = fixed configured duration; Smart = AI (Claude) recommendation, itself falling back to the fixed duration on failure or an out-of-range response (per Q10's safety-clamping principle).

### Q12 — Purpose of a per-plant-type "optimal range"

- Asked: Should a per-plant-type optimal range serve as (a) a plant-specific duration clamp for the AI recommendation now, (b) a future soil-moisture threshold, or (c) both?
- Captured: **Both, as a single profile per plant type** — used now to clamp the Smart-Timer's AI-recommended duration to plant-appropriate bounds (replacing the generic 0–90 min bound from Q10 with per-plant bounds), and later extended with a moisture threshold once the sensor exists (same profile, not rebuilt separately).
- Flags: **Actual numeric values** (duration bounds + eventual moisture thresholds for Rasen/Rhododendren/Beete/Kübelpflanzen) not yet defined — deliberately deferred, this was about the _shape_ of the idea, not the specific numbers. Fill in when actually implementing.

**Updated data model note:** each plant type (Rasen, Rhododendren, Beete, Kübelpflanzen — per Q9) should carry a small profile: `{ durationMin, durationMax, moistureThreshold? }` — the duration bounds usable immediately as an AI-recommendation clamp, the moisture threshold added later once real sensor data exists.

### Q13 — Moisture check timing (avoid reading the watering-induced spike)

- Asked: User flagged that the soil-moisture sensor will spike during/right after watering — should the moisture veto be read once before the cycle starts (like the rain check), or monitored continuously with peak-filtering?
- Captured: **Once, before the cycle starts** — same pattern as `isRainExpected()`, called once at the top of `runWateringCycle()` before the valve opens. The sensor is never read _during_ the active watering phase, so the expected transient spike from watering itself simply never gets evaluated — no filtering logic needed.
- Flags: **Residual-moisture edge case, not yet resolved** — a moisture reading taken _before_ a cycle could still be elevated from the _previous_ day's watering if it hasn't fully settled yet, potentially causing a false "skip" the day after a normal watering. Not raised by the user, but a natural follow-on question once real sensor data exists — worth a minimum-time-since-last-watering consideration or just observing real sensor behavior before deciding if it's actually a problem in practice.

### Q14 — Self-calibration mechanism ("richtig schlau machen")

- Asked: User wants the ultimate goal to be self-calibrating — measure soil moisture some time after watering finishes and adjust future duration accordingly, since actual moisture increase per minute depends on per-zone flow rate and soil type (unknowns that can't be computed in advance). Should this show up as a per-zone calibration multiplier applied to the computed duration (works under both Dumb and Smart timer modes), or fed as historical context directly into the AI prompt (Smart-mode-only)?
- Captured: **Per-zone calibration multiplier**, applied on top of whichever duration source is active (fixed Dumb-Timer value or AI Smart-Timer recommendation) — e.g. a factor like 0.8 meaning "this zone needs 20% less than the plant-type default, probably faster-draining soil." Benefits both modes without needing to duplicate/override plant profiles per zone; the factor drifts/settles over time as more watering cycles are observed.
- Flags: **Exact learning algorithm not specified** (e.g. how much a single post-watering reading should move the factor, how many cycles before it's "trusted," how it interacts with the residual-moisture edge case from Q13) — deliberately out of scope for this brainstorm, this captures the _shape_ of the self-calibration idea, not the tuning algorithm. Depends entirely on the soil-moisture sensor existing first (per Q5b, not yet installed).

### Q15 — Implementation vehicle and rollout plan

- Asked: (not asked, user-initiated) — how should this actually get built and tested?
- Captured: **This becomes a new TypeScript script** — not grown in place inside `scripts/beregnung.ts`. User's rollout plan: (1) start in **DEV** with **one zone and a dummy/simulated valve entity** to test the mechanics without touching real hardware; (2) once that works, try the same **dummy-valve setup on production**; (3) only then switch to the **real valve on production**. Mirrors the same careful DEV-first, dummy-before-real approach used earlier tonight for the ref-count bug repro.
- Flags: **New script's name/filename not yet decided** — needs one before implementation starts (affects entity IDs, avoids colliding with `beregnung.ts`'s existing `switch.beregnung_ventil` etc. naming).

## Open flags (pending input)

- **Hard prerequisite, blocks most of this:** zones 2 and 3 aren't physically installed yet -> user, whenever the hardware goes in.
- **Hard prerequisite, blocks the moisture veto + self-calibration branches:** no soil-moisture sensor installed yet -> user, whenever it's bought/installed.
- What specifically should change in the Q10 prompt/JSON/status draft — got redirected into the Dumb/Smart-Timer split before landing on an actual answer -> ask again when picking this back up.
- Whether per-zone/per-program duration overrides beyond the plant-type profile are ever wanted, or the profile is always authoritative (Q5c) -> confirm when building.
- Actual numeric duration bounds + moisture thresholds per plant type (Rasen/Rhododendren/Beete/Kübelpflanzen) — shape decided (Q12), values not -> fill in at implementation time, probably needs some real-world observation first.
- Where to store the Anthropic API key for the Claude calls, and which script permission(s) it needs (`@permission network` at minimum, matching the `unifi_control.ts` pattern) — not discussed this session, a real implementation blocker once Smart-Timer is actually built.
- Residual-moisture-from-previous-day edge case (Q13) and the exact calibration-learning algorithm (Q14) — both need real sensor data in hand before they can be meaningfully resolved, not resolvable in the abstract.
