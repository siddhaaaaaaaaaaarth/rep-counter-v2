# 01 — Product Specification

Everything the app does, described as behaviour. This is the **what**, not the
**how** — if you rebuilt the app in a different language from this document
alone, it should come out functionally identical.

Rules that are easy to get wrong are marked **⚠ CRITICAL**.

---

## 1. Screens and navigation

Nine screens. There is no URL routing — a single `view` object in `js/app.js`
holds the current screen name plus its parameters, and browser back/forward is
wired to it via the History API.

```
HOME (workouts tab) ──┬─→ WORKOUT ──┬─→ EXERCISE (the rep counter)
        │             │             └─→ TIMER
        │             └─→ (sheets: new/edit workout, rest timer)
        ├─→ SETTINGS
        └─→ DATA LOG (log tab) ─→ LOG WORKOUT ─→ DAY SHEET (spreadsheet)
```

A **bottom tab bar** on HOME and DATA LOG switches between those two roots. It
is a hairline rule with two plain text labels — accent colour for active, muted
for inactive. No filled buttons.

### HOME — "MY WORKOUTS"
- Lists all workouts: name, exercise count, and rest-timer setting if enabled.
- The workout you're partway through gets an accent left-bar and shows `n / m sets`.
- `EDIT` toggle reveals ✕ delete buttons; tapping a workout in edit mode opens
  its settings sheet instead of opening it.
- `+ NEW WORKOUT` sits directly beneath the last workout, **not** pinned to the
  bottom of the screen.
- **With zero workouts the screen shows nothing at all** except the title, gear
  icon, the button, and the tab bar. No empty-state message. (Explicitly
  requested; don't "helpfully" add one back.)

### WORKOUT — the exercise list
- Header shows name, exercise count, set progress, and `● In progress` in accent
  when a session is running.
- Each exercise card: name, `n sets × n reps · n kg`, a `✎` if it has remarks,
  and a `REST ON`/`REST OFF` chip.
- `+ ADD EXERCISE` in accent (red) sits under the list.
- Bottom button is `START WORKOUT` / `END WORKOUT` in the high-contrast invert
  colour — deliberately *not* accent, so the button that ends and wipes a
  session isn't the same colour as the one that adds an exercise.

### EXERCISE — the rep counter
The densest screen. Top to bottom:
1. Header: back, exercise name, `− SET 2 OF 4 +` (the ± change the planned set count), clock icon.
2. **Rest timer bar** — always visible, shows the applicable rest setting.
3. **The counter**: a large accent square, rotated `-2deg` with a hard offset
   shadow. Tap anywhere on it to +1 rep. Below it `−1 / CLEAR / +1`.
4. **Weight strip**: `−2.5` | big current weight | `+2.5`. Tapping the number
   opens a numeric sheet. Half-plate precision is preserved (32.5, 62.5).
5. **SET LOG** — three visual states, see §4.
6. **REMARKS** notepad (if enabled in settings).
7. Bottom: `COMPLETE SET`, plus `+ DROP` alongside it if drop sets are on.

### TIMER
Rest-timer/stopwatch modes, a circular dial with a draining progress ring,
presets `30/60/90/120` + custom, and a large `REST TIMER OFF/ON` switch that
controls whichever rest setting applies in the context you opened it from.

### SETTINGS
Theme picker (4 compact rows), `DROP SETS` on/off, `EXERCISE REMARKS` on/off,
`WORKOUT REMARKS` on/off, default rest length, and `RESET ALL DATA` (accent-
coloured as a danger cue).

### DATA LOG / LOG WORKOUT / DAY SHEET
See §6.

---

## 2. Session lifecycle ⚠ CRITICAL

This is the core concept. Everything in the data log depends on it.

A **session** is one instance of doing a workout. It has a start time, an end
time, a rating, and a frozen copy of everything logged.

```
START WORKOUT ──→ [log sets, take rests] ──→ END WORKOUT
                                                  │
                                        ┌─────────┴──────────┐
                                        │ 1. ask 1–10 rating │
                                        │ 2. freeze into log │
                                        │ 3. wipe workout    │
                                        └────────────────────┘
```

**Rules:**

1. **Only one workout can be active at a time** (`state.activeWorkoutId`).
2. **Start time is persisted**, not held in memory — a phone locking, the
   browser backgrounding, or a full page reload must not lose the clock.
3. **Logging without starting** → a popup: *"START THIS WORKOUT? … Start it now
   so this set gets saved to the data log when you finish."* Confirming starts
   the session **and** logs the set in one action.
4. **Leaving mid-session** (back button) → a popup with two options:
   - `END WORKOUT` → goes through the rating flow, saves, wipes.
   - `KEEP RUNNING` → navigates away but leaves the session live and all
     numbers intact.
5. **The rating is only ever asked at the end of a session** — never displayed
   as a permanent section on the workout screen. It's optional; skipping stores
   `null`.
6. **Ending wipes the workout** — all logged sets, drafts, the rating, and the
   workout-level remarks are cleared so the next session starts clean. The
   frozen copy lives on in the session record.
7. **A session ended without a recorded start gets `durationMs: null`**, and the
   UI shows `—`. Never fabricate a duration.

---

## 3. Drop sets ⚠ CRITICAL

**On by default for every exercise.** A single global switch in Settings hides
the feature entirely if unwanted. There is no per-exercise toggle.

A drop set is **one set** containing multiple segments at descending weights.
The critical modelling decision: it stays *one* set in every count and total —
it does not inflate the set count.

**Flow while counting:**
1. Count reps at the working weight.
2. `+ DROP` banks that segment and immediately opens the weight sheet so you can
   drop the load. Counter resets to 0.
3. Count the next segment. Repeat freely.
4. `COMPLETE SET` files the whole thing as one set.
5. `UNDO DROP` un-banks the last segment (restoring its reps and weight).

**Storage shape:**
```js
{ reps: 8, weight: 60, drops: [ {reps: 6, weight: 45}, {reps: 4, weight: 30} ] }
```
The main set is the top-level `reps`/`weight`; every subsequent segment is an
entry in `drops`.

**Edge case:** completing a set immediately after a drop, with 0 reps counted,
must **not** record a 0-rep trailing segment — it's silently discarded. And the
"log an empty set?" guard must not fire when drop segments are already banked.

**Display:** drop segments appear as dimmed sub-rows labelled `DROP 1`, `DROP 2`
under their parent set, and as their own rows labelled `2·D1` in the spreadsheet.

---

## 4. Set log — three visual states ⚠ CRITICAL

Within an exercise, each planned set is in exactly one state:

| State | Appearance |
| --- | --- |
| **Upcoming** | Full-strength text (`--text`), dashed border. Not greyed. |
| **Current** | Accent-coloured border and label, live rep count, shows banked drop segments. |
| **Completed** | Greyed and faded (opacity 0.5), with a `✎` icon. Tap to edit reps/weight/drops or delete. |

The "upcoming = full strength, completed = faded" direction is deliberate and
was explicitly specified — it's the opposite of the intuitive default.

Deleting a logged set renumbers the ones below it (set number is derived from
array index, never stored).

---

## 5. Rest timers ⚠ CRITICAL

Three levels; **most specific wins**.

| Level | Where set | Default |
| --- | --- | --- |
| **Exercise** | `REST` chip on an exercise card, or the timer-bar label | inherit workout |
| **Workout** | Big ON/OFF switch on the timer screen, or the create-workout sheet | **off** |
| **Manual** | The timer screen itself (presets/custom/stopwatch) | — |

Implemented as `exercise.restOverride`:

```
null → inherit the workout's setting
0    → explicitly OFF for this exercise (overrides an ON workout)
n    → n seconds for this exercise (overrides the workout)
```

`Store.effectiveRest(workout, exercise)` resolves this and returns
`{enabled, seconds, source}` where `source` is `'exercise'` or `'workout'`.

**Behaviour:**
- Completing a set auto-starts the countdown **only if** the resolved rest is
  enabled.
- At zero: a triple beep (WebAudio) plus vibration (Android), and the timer bar
  turns accent-coloured with `REST DONE — NEXT SET`.
- The exercise chip reads `REST ON` in accent when a countdown applies (adding
  `· 45S` when it's an override), or `REST OFF` in grey when nothing will fire.
- **One shared Timer instance** — it keeps running as you navigate between
  screens.

---

## 6. The data log — three representations

Tapping a workout in the data log opens **one page containing all three views
stacked**. There is no view-switcher tab bar. `‹ ›` arrows at the top move
between exercises and drive both the table and the graph together, so the whole
page always describes a single exercise — the first one on arrival.

### View 1 — by exercise (table)
`DATE | SET | WEIGHT | REPS`, newest first. Collapsed shows **only the most
recent day**; tapping expands to the full history.

### View 2 — by day (spreadsheet)
A `FULL LOG` card opens a scrollable grid:
`DATE | EXERCISE | SET | WEIGHT | REPS | RATING | TIME`
One row per set, newest first. `RATING` is that session's 1–10 score; `TIME` is
the session duration (`47m`, `1h 12m`, or `—`).

### View 3 — estimated 1RM graph
**X = sessions in chronological order. Y = estimated 1RM in kg.**

**The formulas** ⚠ CRITICAL — the switch point matters:

| Reps | Formula | |
| --- | --- | --- |
| **≤ 12** | Epley | `w × (1 + r/30)` |
| **> 12** | Wathan | `100w / (48.8 + 53.8·e^(−0.075r))` |

12 reps uses **Epley**. The two curves don't meet at the boundary (60kg×12 =
84.0 Epley; 60kg×13 = 86.8 Wathan) — that discontinuity is inherent to switching
estimators and is not a bug.

**One point per session** = the **highest** e1RM of all sets that day, including
drop segments. Not the first set, not the heaviest weight, not an average.

**The Y axis is deliberately broken** ⚠ CRITICAL:
- A `0` tick sits at the origin, then a slashed break, then the real scale.
- The first tick after the break is **the nearest multiple of 5 at or below the
  lowest e1RM in the series**.
- Examples: lowest 26 → `0, 25, 30, 35`. Lowest 44 → `0, 40, 45, 50`.
- If a later session is *worse* than the first (40 then 38), the base drops to
  35 so the dip stays on the chart.

**Density handling:**
- *Collapsed* shows the whole series. Once points sit closer than ~10px the dot
  markers are dropped and the line carries the trend (standard sparkline
  behaviour) — but the most recent point keeps its dot as a "you are here"
  anchor.
- *Expanded* adds per-point value labels, every session's date label, and a
  `1M / 3M / 6M / ALL` range selector that rescales the Y axis to the window.
  Range is anchored to the **most recent session**, not today, so a training
  layoff never produces an empty chart.

---

## 7. Rating scale

1–10, replacing an earlier seven-tier emoji scale. Asked only at session end.

The colour ramp is a single continuous gradient, pinned at three points:

| Rank | Colour | |
| --- | --- | --- |
| 1 | `oklch(0.300 0.120 22)` | deep maroon-red |
| 5 | `oklch(0.620 0.180 60)` | orange |
| 10 | `oklch(0.860 0.190 92)` | bright gold |

Lightness climbs at every step so no tile is darker than the one before.
Text flips white → black at rank 5, where the tile becomes light enough that
white would fail. **Values are emitted as sRGB hex, not oklch** — they land in
inline `style` attributes where an unsupported colour can't fall back.

---

## 8. Remarks

Two independent notepads, each with its own switch in Settings → NOTES:

| Switch | Default | Location |
| --- | --- | --- |
| `EXERCISE REMARKS` | **on** | bottom of each exercise screen |
| `WORKOUT REMARKS` | **off** | workout screen, under the rating section |

Both autosave ~500ms after typing stops, with an explicit `SAVE REMARKS` button
that flushes immediately and flashes `SAVED ✓`. Turning a switch off only
*hides* the notepad — text is preserved and reappears when switched back on.
Both survive `CLEAR TODAY'S SETS`.

---

## 9. Defaults on a fresh install

```
workouts:        [] (completely empty — no samples)
sessions:        []
theme:           't3a' (dark & red)
rest default:    90 seconds
dropSets:        true
exerciseRemarks: true
workoutRemarks:  false
```

Nothing is written to `localStorage` until the user actually does something.
