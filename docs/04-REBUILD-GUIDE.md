# 04 — Rebuild Guide

Reconstructing the app from an empty folder, in the order that keeps something
runnable at every stage.

Each phase ends with a **checkpoint** — verify it before moving on. If you're an
AI agent working through this, treat the checkpoints as required.

---

## Before you start

**Read `01-PRODUCT-SPEC.md` first.** The ⚠ CRITICAL rules there (rest-timer
inheritance, drop-set storage, the e1RM switch point, the broken axis) are the
things most likely to come out wrong, and they're much cheaper to build in than
to retrofit.

**Development loop:**
```bash
python3 -m http.server 8080     # must be localhost, not file://
```

There's no build step. Edit, save, reload.

---

## Phase 1 — Skeleton

**Goal:** a themed empty page.

1. `index.html` — meta tags (`viewport-fit=cover`, no `maximum-scale`), a
   `#app` div, a `#sheetRoot` div, and the six script tags in order.
2. `css/theme.css` — the four `[data-theme]` blocks. Write all tokens now even
   though nothing uses them; retrofitting tokens is tedious.
3. `css/app.css` — the reset, the `.screen`/`.hd`/`.scroll`/`.cta` skeleton,
   `-webkit-font-smoothing: antialiased`.
4. `js/themes.js` — `THEMES` and `applyTheme()`.

**Checkpoint:** `applyTheme('t3b')` in the console visibly changes the
background. If not, the token wiring is wrong — fix it now.

---

## Phase 2 — The data layer

**Goal:** a complete, testable `Store` with no UI at all.

Build `js/store.js` in this order:

1. `defaults()` — the full state shape (see `02-ARCHITECTURE.md` §2).
2. `normalize()` — fill in missing fields. **Write this now**, not later.
3. `load()` / `save()` — one `localStorage` key, wrapped in try/catch (private
   mode throws).
4. CRUD: `addWorkout`, `addExercise`, `updateExercise`, `deleteWorkout`…
5. Logging: `logSet`, `addDropSegment`, `undoDropSegment`, `updateLogEntry`,
   `deleteLogEntry`, `clearLog`.
6. Derived helpers: `progress`, `totalReps`, `entryReps`, `exerciseDone`,
   `effectiveRest`.

**Two clamps matter:** integers for reps/sets/target, but **weights keep 0.01
precision** (`clampKg`) — gym plates come in 2.5kg steps and rounding 32.5 to 33
is a real bug.

**Checkpoint** — run in the console, no UI needed:
```js
var w = Store.addWorkout({name:'test', restEnabled:true, rest:120});
var e = Store.addExercise(w.id, {name:'bench', sets:3, target:8, weight:62.5});
Store.updateExercise(w.id, e.id, {draft: 8});
Store.logSet(w.id, e.id);
Store.exercise(w.id, e.id).log;          // → [{reps:8, weight:62.5, drops:[]}]
Store.effectiveRest(w, e);               // → {enabled:true, seconds:120, source:'workout'}
```

---

## Phase 3 — Render loop and first screen

**Goal:** the home screen renders and navigates.

1. `js/screens.js` — `home()` returning an HTML string.
2. `js/app.js` — `view` object, `render()`, `go()`, the delegated click
   listener, and an `actions` map with two or three entries.

Get the loop right before adding screens: **tap → action → mutate Store →
`render()` → `innerHTML =`**. Everything else is repetition of this pattern.

**Checkpoint:** create a workout via a sheet, see it appear in the list, reload
the page, and it's still there.

---

## Phase 4 — Sheets

**Goal:** all data entry works.

`js/ui.js`: `UI.open` (the generic shell), then `UI.text`, `UI.number`,
`UI.confirm`, `UI.workout`, `UI.exercise`.

Sheets render into `#sheetRoot`, **not** `#app`, so a re-render of the app
doesn't destroy an open dialog.

**Checkpoint:** create a workout and an exercise entirely through the UI.

---

## Phase 5 — The counter

**Goal:** the core interaction.

1. `screens.exercise()` — counter, weight strip, set log, remarks.
2. Actions: `tap`, `rep-inc`, `rep-dec`, `rep-zero`, `complete-set`,
   `weight-step`, `edit-weight`, `set-inc`, `set-dec`.
3. **`tap` must not call `render()`.** Update `[data-reps]` text nodes directly.

Implement the three set-log states now (upcoming / current / completed) — they
drive a lot of CSS.

**Checkpoint:** tap 8 times, hit COMPLETE SET, see set 1 appear greyed with the
current-set row moving to set 2.

---

## Phase 6 — Timer

`js/timer.js` as a single shared instance. Derive elapsed from `Date.now()`.
Subscribers via `onChange`; `app.js` patches DOM nodes rather than re-rendering.

Then the rest-timer hierarchy (`effectiveRest`), the timer screen, and the big
ON/OFF panel.

**Checkpoint:** start a countdown, navigate to another screen and back — it's
still running and shows the right remaining time.

---

## Phase 7 — Sessions

**Goal:** the lifecycle from `01-PRODUCT-SPEC.md` §2.

1. `startSession` (stamp `activeStartedAt`), `endSession` (freeze → `sessions`,
   wipe the workout).
2. `START`/`END WORKOUT` buttons.
3. The three prompts: start-on-log, leave-guard, end-of-session rating.

**Checkpoint:** log sets → END → rate → the workout is empty and a session
exists with the right duration. Then: start a session, reload the page mid-
session, end it — the duration must still be correct.

---

## Phase 8 — Data log

1. `dataLog()` — workout list with session counts.
2. `logWorkout()` — all three views stacked, `‹ ›` driving table and graph
   together.
3. `daySheet()` — the spreadsheet grid.
4. Store helpers: `sessionsFor`, `exerciseHistory`, `daySheetRows`,
   `loggedExercises`, `sessionStats`.

---

## Phase 9 — The e1RM graph

The fiddliest part. Build in this order:

1. `Store.e1rm(weight, reps)` — Epley ≤12, Wathan >12.
   **Verify: `e1rm(60,8) === 76`, `e1rm(60,12) === 84` (Epley, not 84.9).**
2. `Store.e1rmSeries` — one point per session, the *max* e1RM that day,
   including drop segments, chronological.
3. `Store.e1rmAxis` — the broken axis.
   **Verify: lowest 26 → ticks `[25,30,35]`; lowest 44 → `[40,45,50]`; series
   `[40,38]` → base drops to 35.**
4. `Screens.e1rmChart` — the SVG.
5. Density handling and the range selector.

Use `dy="0.32em"` for vertically centred SVG text, **not**
`dominant-baseline: middle` — Safari has long-standing bugs with that attribute.

---

## Phase 10 — Offline + install

1. `manifest.json` with maskable icons.
2. `css/fonts.css` + self-hosted `.woff2` files.
3. `sw.js` and its registration in `index.html`.
4. The `@supports not (color: oklch(...))` fallback block.

**Checkpoint — the real test:** load the page, **stop the server entirely**,
then reload. The app must still launch and be fully usable. If it shows an error
page, the service worker isn't caching correctly.

---

## Phase 11 — Compatibility pass

Audit before shipping:

```bash
# modern syntax in shipped code (must be comments only)
grep -n "=>\|\`\|[^a-z]let \|[^a-z]const \|?\.\|??\|\.\.\." js/*.js

# CSS features needing fallbacks
grep -on "color-mix\|:has(\|aspect-ratio\|dvh\|oklch" css/*.css
```

Every hit needs either a fallback or a justification. Known-needed fallbacks:
`100dvh` → `100vh` first; `aspect-ratio` → explicit `height`; `oklch` →
`@supports` block.

---

## Common rebuild mistakes

| Mistake | Symptom |
| --- | --- |
| Full re-render on every rep tap | Counter feels laggy; tap animation stutters |
| Timer re-rendering the screen | Remarks textarea loses focus while typing |
| Storing set numbers | Deleting a set leaves gaps like 1, 2, 4 |
| Rounding weights to integers | 62.5kg becomes 63kg |
| Wathan at exactly 12 reps | Off-by-one against the spec |
| Sheets rendered into `#app` | Dialogs vanish when anything re-renders |
| Forgetting `normalize()` | Old saved data crashes the app after a schema change |
| Nesting `<button>` in `<button>` | Layout silently breaks — see gotchas doc |
