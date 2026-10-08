# 02 — Architecture

How the code is organised, and why. This is the **how**.

---

## 1. The shape of the whole thing

Six JavaScript files, loaded in a fixed order by `<script>` tags. No modules, no
bundler. Each file wraps itself in an IIFE and attaches exactly one global.

```
js/store.js    → window.Store        data + business logic.  NO DOM.
js/themes.js   → window.THEMES,      static config: theme list, rating ramp.
                 window.RATINGS,
                 window.applyTheme
js/timer.js    → window.Timer        the countdown/stopwatch engine.
js/ui.js       → window.UI           bottom-sheet dialogs.
js/screens.js  → window.Screens      HTML generation.  NO state changes.
js/app.js      → window.RepCounter   router + event handling. Wires it together.
```

**Dependency direction is strictly one-way**, matching load order. `store.js`
knows about nothing. `app.js` knows about everything. Nothing ever reaches
backwards.

### Why classic scripts instead of ES modules

ES modules require a server (`file://` triggers CORS errors on `import`). Plain
`<script>` tags let the app run by double-clicking `index.html`, which matters
for a zero-dependency personal project. The cost — globals instead of imports —
is acceptable at six files.

### Why ES5

No arrow functions, `let`/`const`, template literals, spread, or optional
chaining anywhere in shipped code. This is deliberate: old Android WebViews
parse the whole file before running it, so a single modern token anywhere causes
a blank screen rather than a graceful degradation. Verified by grep as part of
the compatibility audit.

---

## 2. The data model

**All persistent state is one JSON object in one `localStorage` key**
(`repcounter.v1`). There is no other storage.

```js
{
  version: 3,
  theme: 't3a',
  rest: 90,                  // default seconds for NEW workouts
  dropSets: true,            // global feature switches
  exerciseRemarks: true,
  workoutRemarks: false,

  activeWorkoutId: null,     // the session currently running, if any
  activeStartedAt: null,     // ms timestamp — persisted so reloads don't lose it

  workouts: [ {
    id, name,
    restEnabled: false,      // workout-level rest timer
    rest: 90,
    rating: null,            // 1–10, cleared when a session ends
    remarks: '',
    exercises: [ {
      id, name,
      sets: 4,               // PLANNED set count
      target: 8,             // target reps (shown on the card, not the counter)
      weight: 60,
      restOverride: null,    // null=inherit | 0=off | n=seconds
      remarks: '',
      draft: 0,              // reps counted but not yet logged
      draftDrops: [],        // banked drop segments of the in-progress set
      log: [ { reps, weight, drops: [{reps, weight}] } ]   // COMPLETED sets
    } ]
  } ],

  sessions: [ {              // finished workouts, append-only
    id, wid, wname,
    date,                    // ISO string, end time
    startedAt,               // ISO string or null
    durationMs,              // number or null
    rating,                  // 1–10 or null
    remarks,
    entries: [ { eid, ename, set, weight, reps, drops:[...] } ]
  } ]
}
```

### Two ideas worth internalising

**1. `workouts` is the template *and* the scratchpad; `sessions` is history.**

An exercise's `log` array holds only the *current, unsaved* session. When a
session ends, everything is copied into a new `sessions` entry and the `log`
arrays are emptied. So `workouts` never grows over time; `sessions` does.

**2. Set numbers are never stored.**

A set's number is its index in the array + 1. Delete set 2 and set 3 becomes set
2 automatically, with no renumbering pass. Same for drop segments.

### Migration

`normalize()` runs on every load and fills in any field a previous version
didn't store. This is how the schema has evolved through several versions
without ever breaking a user's saved data. It also actively deletes retired
fields (e.g. the old `feeling` key from the seven-tier rating scale) rather than
leaving them to rot.

**When you add a field, add it to `normalize()` in the same commit.** Everything
else assumes fields exist.

---

## 3. The render loop

This is the single most important thing to understand about the codebase.

```
user taps something
      ↓
one delegated click listener on #app  (app.js)
      ↓
finds nearest [data-act] ancestor, looks up actions[name]
      ↓
handler mutates Store  (the only place state changes)
      ↓
render()
      ↓
Screens.foo(...) returns an HTML STRING
      ↓
app.innerHTML = thatString      ← the entire screen is replaced
```

**Every interaction re-renders the whole screen by replacing `innerHTML`.**
No virtual DOM, no diffing, no reactivity. At this app's size (a few dozen
elements) this is imperceptibly fast and removes an entire class of state-sync
bugs — what you see is always a pure function of `Store`.

### The two deliberate exceptions

Full re-render would be wrong in exactly two places, so these bypass it and
patch individual DOM nodes:

1. **The rep counter.** Tapping updates only `[data-reps]` text nodes. A full
   re-render on every tap would be wasteful and would fight the tap animation.
2. **The timer.** A `Timer.onChange` subscriber updates `[data-timer-display]`,
   the button label, the dial ring, and the bar's label. Re-rendering every
   200ms would destroy the remarks textarea's focus and cursor position
   mid-typing.

That second point generalises: **anything that ticks or types must not trigger
a full render.** The remarks notepad autosaves on a debounce and only writes to
`Store` — it never calls `render()`.

### Screens are pure

Every function in `screens.js` takes data and returns a string. None of them
mutate `Store` or touch the DOM. This makes them trivially testable and means
you can reason about a screen by reading one function top to bottom.

---

## 4. Event handling — one listener, `data-act`

There is exactly **one** click listener in the entire app:

```js
app.addEventListener('click', function (ev) {
  var el = ev.target.closest('[data-act]');
  if (!el) return;
  var fn = actions[el.dataset.act];
  if (!fn) return;
  ev.preventDefault();
  ev.stopPropagation();
  /* ...flush any pending remarks text before re-render... */
  fn(el.dataset, ev);
});
```

Markup declares intent: `<button data-act="complete-set">`. Extra parameters
ride along as data attributes (`data-w`, `data-e`, `data-i`, `data-n`, `data-r`)
and arrive as the handler's first argument.

**Why this matters:** because `innerHTML` replaces elements constantly, per-
element listeners would need re-binding after every render. Delegation makes
that irrelevant — the listener is on the container, which never changes.

**The `closest()` behaviour is load-bearing.** A nested `[data-act]` element
inside another wins, because `closest()` walks up from the target and stops at
the first match. That's how a delete ✕ inside a card button, or a range button
inside the tap-to-expand chart card, fires its own action instead of the
parent's. ~52 actions are registered this way.

---

## 5. Module responsibilities

### `store.js` — the only place data changes
Every mutation goes through a `Store` method, and every method calls `save()`.
Contains all the derived-data helpers too (`e1rm`, `e1rmSeries`, `e1rmAxis`,
`effectiveRest`, `daySheetRows`, `progress`, `sessionStats`…).

**Never touches the DOM.** This is why the maths is easy to verify — you can
call `Store.e1rm(60, 8)` in a console and check it returns 76.

### `themes.js` — static configuration
Theme definitions with literal swatch colours (so a theme row can preview a
theme that isn't applied), `applyTheme()` which sets `data-theme` on `<html>`,
and the generated `RATINGS` ramp with its oklch→sRGB conversion.

### `timer.js` — one shared instance
Two modes (`rest` countdown, `stopwatch` count-up). **Elapsed time is derived
from `Date.now()`, never accumulated per tick** — a throttled background tab
doesn't lose time. Publishes changes to subscribers via `onChange`.

### `ui.js` — every dialog
All data entry happens in bottom sheets: `UI.text`, `UI.number`, `UI.workout`,
`UI.exercise`, `UI.confirm`, plus `UI.open` for custom ones. Sheets render into
a separate `#sheetRoot` container so they survive `#app` being re-rendered.

### `screens.js` — HTML strings
One function per screen plus small shared builders (`tabBar`, `secHd`,
`progressRow`, `ratingTiles`, `e1rmChart`). Everything user-supplied goes
through `esc()`.

### `app.js` — the wiring
`view` state, `go()` for navigation (with History API integration), `render()`,
the delegated listener, and the ~52 action handlers.

---

## 6. Rendering the chart without a library

`e1rmChart()` builds an SVG as a string. Roughly 90 lines, no dependency.

- A `viewBox` of `0 0 320 H` with the CSS height set inline. The collapsed card
  renders the *same* SVG at a smaller height — a true proportional scale, not a
  separate simplified rendering to keep in sync.
- All colours come from CSS custom properties via classes (`.cg-line`,
  `.cg-dot`), so the chart themes itself for free.
- The broken axis is drawn manually: gridlines for the real ticks, a separate
  `0` label at the origin, and two short diagonal slashes marking the break.

---

## 7. Offline (`sw.js`)

Cache-first with background refresh. On install it copies all 16 files into
Cache Storage; on fetch it answers from cache immediately and updates the entry
in the background.

**Why a service worker rather than relying on the HTTP cache:** the HTTP cache
is best-effort, revalidation-based, and evicted at the browser's discretion.
Navigation requests typically hit the network first, so an installed PWA with no
signal would fail to launch. Cache Storage is explicit and permanent.

⚠ **`CACHE_VERSION` must be bumped whenever any app file changes**, or installed
devices keep serving the old build forever. This is the single easiest way to
ship a change that appears to do nothing.

---

## 8. Conventions to follow when editing

| Rule | Reason |
| --- | --- |
| State changes only in `store.js` | One source of truth; screens stay pure. |
| Screens return strings, never mutate | Keeps rendering predictable. |
| New interactive element → give it `data-act` | Delegation handles the rest. |
| Escape user text with `UI.esc()` | Everything is built by string concatenation. |
| ES5 only | Old WebView support. |
| Never nest `<button>` inside `<button>` | The parser silently closes the outer one. See gotchas doc. |
| Add new fields to `normalize()` | Old saved data must keep loading. |
| Bump `CACHE_VERSION` on any file change | Otherwise phones serve stale builds. |
