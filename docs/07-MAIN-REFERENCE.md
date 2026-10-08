# 07 — MAIN REFERENCE

**This is the authoritative document for this app.** It was written by reading
every line of the real source and driving the running app in a browser, then
correcting the earlier documentation against what the code actually does.

If this file and any of `01`–`06` disagree, **this file wins** — see §9,
*Corrections from the previous docs*, for the specific disagreements and why.

Written 19 Aug 2026. Verified against the code in
`~/Documents/Claude code/rep-counter 2/`.

> **Folder note:** this folder was called `rep-counter 2nd/rep-counter app 2/`
> (app nested one level down) until 19 Aug 2026, when it was flattened and
> renamed to `rep-counter 2/`. Older notes may still use the old path.

| | |
| --- | --- |
| **Read this if** | you are new, or you are about to change anything |
| **Then read** | `05-GOTCHAS-AND-TIPS.md` (traps), `06-PROJECT-CONTEXT.md` (deployment, removed features) |
| **Change log** | `../CHANGELOG.md` |
| **Working agreement** | `../CLAUDE.md` — the documentation protocol every session must follow |

---

## Contents

1. [What this app is](#1-what-this-app-is)
2. [How to run it](#2-how-to-run-it-verified)
3. [Architecture](#3-architecture)
4. [Data flow](#4-data-flow)
5. [File-by-file breakdown](#5-file-by-file-breakdown)
6. [Full variable & config reference](#6-full-variable--config-reference)
7. [The business rules that are easy to get wrong](#7-the-business-rules-that-are-easy-to-get-wrong)
8. [Real project history](#8-real-project-history-from-git)
9. [Corrections from the previous docs](#9-corrections-from-the-previous-docs)
10. [Known issues](#10-known-issues)
11. [How to verify a change](#11-how-to-verify-a-change)

---

## 1. What this app is

A phone-first gym rep counter, built as a static web app (an installable PWA).
You tap a big square once per rep, log sets with weights, run rest timers, and
it keeps a permanent training log with progress tables and estimated-1RM graphs.

Every architectural decision follows from these properties:

| Property | Value | Consequence |
| --- | --- | --- |
| Build step | **none** | Open `index.html` and it runs. No npm, no bundler, no transpiler, no `package.json`. |
| Dependencies | **zero** | No framework, no chart library. The SVG chart is ~90 hand-written lines. |
| Backend | **none** | No server, no accounts, no API, no analytics. |
| Storage | one `localStorage` key | All data is on the user's device, in one JSON blob. |
| Tests | **none exist** | There is no test suite to run. Verification is done by driving the app in a browser console — see §11. |
| JS dialect | **ES5 syntax** | No arrow functions, `let`/`const`, template literals, spread or optional chaining. See §10.1 for the caveat about runtime APIs. |
| Offline | full | A service worker caches all 16 files; works in airplane mode. |
| Size on disk | 252 KB shipped | The app payload the service worker caches (16 files); 56 KB of that is fonts + icons. `docs/` adds a further 128 KB and is never served to the app. |

**Source size (verified 25 Aug 2026):** 3,760 lines of JavaScript, 1,346 lines
of CSS, 5,276 lines including HTML/JSON/service worker.

---

## 2. How to run it (verified)

There is nothing to install and nothing to build.

```bash
cd "/Users/siddharth/Documents/Claude code/rep-counter 2"
python3 -m http.server 8080
```

Then open <http://localhost:8080> in a browser.

**Why `localhost` and not double-clicking `index.html`:** service workers only
register on `localhost` or HTTPS, and Safari blocks `localStorage` entirely on
`file://` URLs — so opening the file directly means nothing persists. The app
will partly work, but don't test that way.

To stop the server: `Ctrl-C` in that terminal window.

**Confirmed working on this machine (19 Aug 2026):** Python 3.9.6 serves it,
all eight screens render, zero JavaScript console errors, all documented maths
returns the documented values. Node.js is **not installed**, so there is no
`node --check` available — JavaScript is verified by loading it in a browser.

There is no build, no lint, and no test command. "Does it still work" means:
load it, drive it, read the console. §11 gives the exact checks.

---

## 3. Architecture

### 3.1 Six files, one global each, loaded in a fixed order

`index.html` loads six plain `<script>` tags. Each file is an IIFE that attaches
exactly one global, and depends only on the files before it.

```
js/store.js    → window.Store                  data + all business logic. NO DOM.
js/themes.js   → window.THEMES, window.RATINGS, window.applyTheme
js/timer.js    → window.Timer                  countdown/stopwatch engine
js/ui.js       → window.UI                     bottom-sheet dialogs + esc()
js/screens.js  → window.Screens                HTML strings. NO state changes.
js/app.js      → window.RepCounter             router + event dispatch + handlers
```

**The dependency direction is strictly one-way and matches the load order.**
`store.js` knows about nothing at all. `app.js` knows about everything. Nothing
ever reaches backwards. Reordering the script tags breaks the app.

**Why classic scripts, not ES modules:** `import` triggers CORS errors on
`file://`, so modules would force a server just to open the app. Globals are an
acceptable cost at six files.

**Why ES5 syntax:** old Android WebViews parse an entire file before executing
it, so one modern token anywhere produces a blank screen rather than a graceful
degradation. (Read §10.1 — the runtime-API floor is higher than the syntax floor.)

### 3.2 The render loop — the one thing to understand

```
user taps something
      ↓
ONE delegated click listener on #app          (app.js, bottom of file)
      ↓
ev.target.closest('[data-act]') → actions[name]
      ↓
handler mutates Store                          ← the ONLY place state changes
      ↓
render()
      ↓
Screens.foo(...) returns an HTML STRING        ← pure, no DOM, no mutation
      ↓
app.innerHTML = thatString                     ← the ENTIRE screen is replaced
```

No virtual DOM, no diffing, no reactivity. At this size (a few dozen elements)
replacing `innerHTML` is imperceptibly fast, and it removes a whole class of
state-desync bugs: **what you see is always a pure function of `Store`.**

**The two deliberate exceptions** bypass `render()` and patch individual nodes:

1. **The rep counter** (`tap`) updates only `[data-reps]` text nodes. A full
   re-render on every tap would be wasteful and would fight the tap animation.
2. **The timer**, via a `Timer.onChange` subscriber, updates
   `[data-timer-display]`, the start/pause label, the dial ring and the bar
   label. It fires ~5×/second; re-rendering would destroy the remarks
   textarea's focus and cursor position mid-word.

> **Rule: anything that ticks, or fires while the user is typing, must not call
> `render()`.** This is also why the remarks autosave only writes to `Store`.

> **Related rule: never sync state *from* `render()`.** An earlier bug had
> `syncIdleTimer()` called inside `render()`, so tapping a timer preset caused
> a render that immediately snapped the value back — the presets looked dead.
> It is now called once per navigation, from `go()`. Render must stay a pure
> read of state.

### 3.3 Event handling — one listener, `data-act`

There is exactly one click listener on `#app` in the whole app. Markup declares
intent; parameters ride along as data attributes:

```html
<button data-act="complete-set">COMPLETE SET</button>
<span data-act="del-workout" data-w="a1b2c3d4">✕</span>
```

**58 actions** are registered in the `actions` map in `app.js`.

`closest()` is load-bearing: it walks up from the tap target and stops at the
first `[data-act]`, so a nested action (a delete ✕ inside a card, a range button
inside the tap-to-expand chart card) fires its own handler rather than the
parent's.

> ⚠ **Never nest a `<button>` inside a `<button>`.** The HTML parser silently
> auto-closes the outer one and your DOM stops matching your source. Where a
> tappable thing must sit inside a tappable thing, use `<span data-act>` or
> `<div role="button" tabindex="0" data-act>`. Delegation works on any element.
> Verified: the app currently contains **zero** nested buttons.

### 3.4 Navigation

`view` in `app.js` is the entire router — a plain object, serialised into
`history.state` so hardware/swipe back works. There is no URL routing; the
address bar never changes. `popstate` closes any open sheet first, then restores
`view`.

**Eight screens:** `home`, `settings`, `workout`, `exercise`, `timer`,
`datalog`, `logworkout`, `daysheet`.

```
HOME (workouts tab) ──┬─→ WORKOUT ──┬─→ EXERCISE (the rep counter)
        │             │             └─→ TIMER
        │             └─→ (sheets: new/edit workout, rest timer)
        ├─→ SETTINGS
        └─→ DATA LOG (log tab) ─→ LOG WORKOUT ─→ DAY SHEET (spreadsheet)
```

### 3.5 Dialogs

All data entry happens in bottom sheets from `ui.js`. There are no inline forms
and no browser `prompt()`/`alert()` anywhere.

> ⚠ Sheets render into **`#sheetRoot`, not `#app`** — a sibling container.
> `#app.innerHTML` is replaced on every render, which would destroy an open
> dialog mid-typing. This also means the global delegated listener (bound to
> `#app`) does **not** see clicks inside sheets; sheets wire their own buttons.

---

## 4. Data flow

### 4.1 The state object

All persistent state is **one JSON object in one `localStorage` key**:
`repcounter.v1`.

The whole blob round-trips through `Store.exportJSON()` / `importJSON()` for
backup — see §7.9.

There is exactly one other key, added 19 Aug 2026: **`repcounter.view`**, holding
`{v: <the view object>, t: <ms timestamp>}`. It is UI position only — which
screen you were on — kept separate so it can never corrupt or bloat the training
log. Nothing else reads it but `restoreView()` at boot.

```js
{
  version: 3,                // schema version, not the storage key's "v1"
  theme: 't3a',
  rest: 90,                  // DEFAULT seconds, applied to NEW workouts only
  dropSets: true,            // global feature switches
  exerciseRemarks: true,
  workoutRemarks: false,

  activeWorkoutId: null,     // the session running right now, or null
  activeStartedAt: null,     // ms timestamp — PERSISTED, survives reload

  workouts: [ {              // the templates AND today's scratchpad
    id, name,
    restEnabled: false,      // workout-level rest timer
    rest: 90,
    rating: null,            // 1–10; cleared when a session ends
    remarks: '',
    exercises: [ {
      id, name,
      sets: 4,               // PLANNED set count
      target: 8,             // target reps — a label, never enforced
      weight: 60,
      restOverride: null,    // null = inherit | 0 = off | n = seconds
      remarks: '',
      draft: 0,              // reps counted but not yet logged
      draftDrops: [],        // banked segments of the in-progress set
      log: [ { reps, weight, drops: [{reps, weight}] } ]   // COMPLETED sets
    } ]
  } ],

  sessions: [ {              // permanent history, append-only
    id, wid, wname,
    date,                    // ISO string — when it ENDED
    startedAt,               // ISO string or null
    durationMs,              // number or null
    rating,                  // 1–10 or null
    remarks,
    entries: [ { eid, ename, set, weight, reps, drops: [...] } ]
  } ]
}
```

### 4.2 Three ideas that explain everything else

**1. `workouts` is both the template and the scratchpad; `sessions` is history.**
An exercise's `log` array holds only the *current, unsaved* session. When a
session ends, everything is copied into a new `sessions` entry and the `log`
arrays are emptied. So `workouts` never grows over time; `sessions` does.

**2. Set numbers are never stored.** A set's number is its array index + 1.
Delete set 2 and set 3 becomes set 2 automatically — no renumbering pass exists
anywhere and none is needed. Same for drop segments.

**3. A drop set is one set.** The main effort is the top-level `reps`/`weight`;
every subsequent lighter segment is an entry in `drops`. It stays **one** set in
every count and total, and must never inflate the set count.

### 4.3 The write path

```
action handler  →  Store.someMutator(...)  →  save()  →  localStorage.setItem
```

Every `Store` mutator calls `save()` itself. Callers never call `save()`.
`save()` is wrapped in `try/catch` because Safari private mode throws on write —
the session keeps working, it just won't persist.

### 4.4 The read path (boot)

```
localStorage.getItem('repcounter.v1')
      ↓
JSON.parse  →  Object.assign over defaults()   ← shallow: fills missing top-level keys
      ↓
normalize(state)                                ← repairs nested/missing fields
      ↓
module-level `state` variable, exposed as Store.state
```

`normalize()` runs on **every** load. It fills in any field an older version
didn't store, and actively deletes retired keys (e.g. the old `feeling` field
from a retired 7-tier rating scale) rather than leaving them to rot.

> ⚠ **When you add a persisted field, add it to `normalize()` in the same edit.**
> Everything downstream assumes fields exist.

### 4.5 A session, end to end

```
START WORKOUT
   └─ Store.startSession(wid)      activeWorkoutId = wid, activeStartedAt = Date.now()
        ↓
[ tap reps → draft ]  [ + DROP → draftDrops ]  [ COMPLETE SET → log[] ]
   └─ completing a set auto-starts the rest countdown IF effectiveRest().enabled
        ↓
END WORKOUT
   ├─ 1. ask for a 1–10 rating (optional; skipping stores null)
   ├─ 2. freeze every exercise's log into a new sessions[] entry
   └─ 3. wipe the workout: logs, drafts, rating and workout remarks cleared
```

Logging a set with no session running raises a prompt offering to start one
(`ensureSessionThen`). Navigating away mid-session raises a prompt offering
`END WORKOUT` or `KEEP RUNNING` (`leaveWorkoutGuard`).

---

## 5. File-by-file breakdown

Line counts verified 19 Aug 2026.

### `index.html` — 44 lines
The shell. Meta tags, the three stylesheets, the six script tags **in load
order**, and the service-worker registration. Registration is wrapped in
`.catch()` — if it fails the app simply behaves as online-only, which is exactly
what happens in environments that block service workers.

Notable: the viewport tag has **no `maximum-scale`** — that would block
pinch-zoom (an accessibility regression) and Android ignores it anyway. iOS
zoom-on-focus is prevented by keeping inputs ≥16px instead.

### `manifest.json` — 25 lines
PWA manifest: standalone display, portrait, `#0a0a0a` theme colour, two
`any maskable` icons. This is what makes Android install it as a real app.

### `sw.js` — 86 lines
The offline cache. **Cache-first with a quiet background refresh:** every launch
is served from Cache Storage instantly, and each file is re-fetched in the
background so the next launch picks up changes. You never wait on the network
and you are never more than one launch behind.

Caches 16 files (`SHELL`). Uses `cache.add` per file rather than `addAll`,
because `addAll` is atomic — one 404 would cache nothing and leave the app
half-installed.

> ⚠ **`CACHE_VERSION` must be bumped whenever any app file changes**, or every
> installed phone keeps serving the old build indefinitely and never recovers on
> its own. Currently `'repcounter-v9'`.

### `css/fonts.css` — 17 lines
Two self-hosted `@font-face` declarations, latin subset. Self-hosted rather than
Google Fonts specifically so the app works offline.

### `css/theme.css` — 162 lines
The four themes as CSS custom properties, plus the `@supports` oklch fallback
block. **No component rules live here** — only tokens.

### `css/app.css` — 1,167 lines
All layout and component styling, in 20 commented sections. Contains no colour
literals — every colour is a `var()` from `theme.css` (one exception: the
`var(--bg, #0a0a0a)` boot fallback, which paints before `applyTheme()` runs).

### `js/store.js` — 857 lines
**All persistent state and all business logic. Zero DOM access.** Start here to
understand the app. Contains CRUD, the session lifecycle, and every derived
helper (`e1rm`, `e1rmSeries`, `e1rmAxis`, `windowSeries`, `effectiveRest`,
`progress`, `daySheetRows`, `exerciseHistory`, `sessionStats`, …).

Because it never touches the DOM, all of its maths is verifiable from a console:
`Store.e1rm(60, 8)` → `76`.

### `js/themes.js` — 177 lines
Static config. The `THEMES` list for the settings picker (with hard-coded swatch
literals, because a settings row must preview a theme that isn't applied and so
can't read the live custom properties), `applyTheme()` which sets `data-theme` on
`<html>` and updates the `theme-color` meta tag, and the generated `RATINGS`
ramp with a full oklch→sRGB conversion in JS (four pins, red→green, with
per-tile text colour chosen by measured contrast — see §7.6).

### `js/timer.js` — 197 lines
One shared countdown/stopwatch instance for the whole app, so a rest timer
started mid-workout keeps running as you navigate. Two modes: `'rest'` (counts
down, alarms at zero) and `'stopwatch'` (counts up).

> ⚠ **Elapsed time is derived from `Date.now()`, never accumulated per tick.**
> Mobile browsers throttle timers in background tabs; a tick-accumulating
> implementation silently loses minutes exactly when the phone is locked — which
> is precisely when a gym rest timer is running.

Knows nothing about workouts or exercises. It's a dumb clock;
`Store.effectiveRest()` decides the duration and `app.js` calls
`Timer.startRest(seconds)`.

### `js/ui.js` — 287 lines
Every dialog, plus `UI.esc()`. Sheets: `open` (the generic shell), `text`,
`number`, `workout`, `exercise`, `confirm`. Helpers: `esc`, `buzz`, `switchPair`,
`wireStepper`, `stepperHtml`, `footer`, `wireFooter`, `close`, `isOpen`.

> ⚠ `UI.esc()` on **all** user-supplied text. The entire app is built by string
> concatenation, so an unescaped workout name is an XSS hole.

### `js/screens.js` — 864 lines
One function per screen, each returning a complete HTML string. **Every function
is pure** — no `Store` mutation, no DOM access, no listeners.

Exports 8 screens + `ratingTiles`. Internal builders: `tabBar`, `secHd`,
`progressRow`, `e1rmChart`, `rangeRow`, `timerBar`, `restPanel`, `themeRows`,
`shortDate`, `plural`, `logHeader`, `workoutRemarksSection`, `val`, `segLine`.

`e1rmChart()` builds the SVG by hand — no chart library. All colours come from
CSS classes (`.cg-line`, `.cg-dot`), so the chart themes itself for free.

### `js/app.js` — 1,345 lines
The wiring: `view` (the router), `go()`, `render()`, the single delegated click
listener, the `Timer.onChange` subscriber, the two remarks autosavers, the three
session prompts, and all 54 action handlers.

---

## 6. Full variable & config reference

### 6.1 Persisted state — top level

| Field | Type | Default | Range / values | What it controls |
| --- | --- | --- | --- | --- |
| `version` | number | `3` | — | Schema version. Set by `normalize()` on every load. Not the same as the `v1` in the storage key. |
| `theme` | string | `'t3a'` | `t3a` `t3b` `t7a` `t7b` | Active theme. Written to `<html data-theme>`. There is no first-run picker; it lives in Settings. |
| `rest` | number | `90` | 5–3600 **seconds** | The *default* rest length prefilled when creating a NEW workout. Changing it does **not** affect existing workouts. |
| `dropSets` | boolean | `true` | — | Global. When off, the `+ DROP` button is hidden entirely. There is no per-exercise toggle (one was built and removed). |
| `exerciseRemarks` | boolean | `true` | — | Shows the notepad at the bottom of the exercise screen. Turning it off only *hides* it — text is preserved. |
| `workoutRemarks` | boolean | `false` | — | Shows a notepad on the workout screen. Same hide-not-delete behaviour. |
| `restAlerts` | boolean | `true` | — | Fire a phone notification when a rest countdown ends, so the alert reaches the user with the app backgrounded (§7.8). Notification sound mixes with music rather than pausing it. |
| `activeWorkoutId` | string\|null | `null` | a workout id | The one session running right now. **Only one workout can be active at a time.** |
| `activeStartedAt` | number\|null | `null` | ms epoch | When it started. **Persisted, not in memory** — a phone lock, a backgrounded browser or a full reload must not lose the clock. |
| `workouts` | array | `[]` | — | Templates + today's scratchpad. Starts genuinely empty — no sample workouts. |
| `sessions` | array | `[]` | — | Finished workouts. Append-only; nothing ever edits or deletes a session. |

### 6.2 Persisted state — a workout

| Field | Type | Default | Range | Notes |
| --- | --- | --- | --- | --- |
| `id` | string | `uid()` | 8 chars | `Math.random().toString(36).slice(2,10)`. Not collision-proof; fine at this scale. |
| `name` | string | `'NEW WORKOUT'` | — | Trimmed and **forced UPPERCASE** on write. |
| `restEnabled` | boolean | `false` | — | Workout-wide rest timer. **Off by default.** |
| `rest` | number | inherits `state.rest` | 5–3600 s | Seconds, when `restEnabled`. |
| `rating` | number\|null | `null` | 1–10 | Only used transiently; cleared when the session ends (the value lives on in the session record). |
| `remarks` | string | `''` | — | Whole-workout notes. Cleared on `endSession`. |
| `exercises` | array | `[]` | — | |

### 6.3 Persisted state — an exercise

| Field | Type | Default | Range | Notes |
| --- | --- | --- | --- | --- |
| `id` | string | `uid()` | — | |
| `name` | string | `'NEW EXERCISE'` | — | Trimmed, forced UPPERCASE. |
| `sets` | number | from sheet (3) | 1–50 | **Planned** set count. Its lower bound is `max(1, log.length)` — you can't plan fewer sets than you've already logged. Logging past the plan silently raises it. |
| `target` | number | from sheet (10) | 1–500 | Target reps. **A label only** — never enforced, never compared against the counter. |
| `weight` | number | from sheet (20) | 0–1000 kg | **2 decimal places preserved.** See `clampKg` in §6.6. |
| `restOverride` | number\|null | `null` | `null` \| `0` \| 0–3600 | The rest hierarchy. `null` = inherit the workout; `0` = explicitly OFF for this exercise; `n` = n seconds. |
| `remarks` | string | `''` | — | Per-exercise notes. Survives `CLEAR TODAY'S SETS`. |
| `draft` | number | `0` | 0–999 | Reps counted but not yet logged — the live counter value. |
| `draftDrops` | array | `[]` | — | Banked segments of the set currently in progress. |
| `log` | array | `[]` | — | **Completed sets for the current, unsaved session only.** Emptied by `endSession`. |

### 6.4 Persisted state — a session (append-only history)

| Field | Type | Notes |
| --- | --- | --- |
| `id`, `wid`, `wname` | string | `wname` is a frozen copy — renaming the workout later does not rewrite history. |
| `date` | ISO string | When the session **ended**. Sorting everywhere uses this. |
| `startedAt` | ISO string\|null | |
| `durationMs` | number\|null | **`null` when the session was ended without a recorded start.** The UI shows `—`. Never fabricate a duration. |
| `rating` | number\|null | 1–10, or `null` if skipped. |
| `remarks` | string | Frozen copy of the workout's remarks. |
| `entries` | array | `{eid, ename, set, weight, reps, drops[]}` — one per logged set. `set` is the 1-based index at freeze time. |

### 6.5 Non-persisted runtime state

| Where | Name | Default | Meaning |
| --- | --- | --- | --- |
| `app.js` | `view` | `{name:'home'}` | The router. Keys: `name`, `wid`, `eid`, `exIdx`, `tableExpanded`, `graphExpanded`, `logRange`. Serialised into `history.state`, so it must stay JSON-safe. |
| `app.js` | `view.logRange` | `'all'` | Chart window: `'1m'`, `'3m'`, `'6m'`, `'all'`. |
| `app.js` | `view.exIdx` | `0` | Which exercise the data-log `‹ ›` arrows are on. |
| `app.js` | `edit` | `false` | List edit mode (reveals ✕ buttons). **Resets on every navigation** — deliberately not part of `view`. |
| `app.js` | `timerBack` | `{act:'home'}` | Where the timer screen's ← returns to. |
| `app.js` | `saveTimer`, `saveTimerW` | `null` | Debounce handles for the two notepads. |
| `app.js` | `RING` | `2π×46` | Dial circumference. Must match `r="46"` in `Screens.timer()`. |
| `timer.js` | `Timer.mode` | `'rest'` | `'rest'` or `'stopwatch'`. |
| `timer.js` | `Timer.duration` | `90000` **ms** | Countdown length. Note: **milliseconds**, while `Store.rest` is **seconds**. |
| `timer.js` | `Timer._acc` / `_start` | `0` | Banked ms from previous runs / `Date.now()` of the current run. |

### 6.6 Constants and tuning values

| Where | Name | Value | Meaning |
| --- | --- | --- | --- |
| `store.js` | `KEY` | `'repcounter.v1'` | The storage slot name. **Frozen forever** — changing it orphans every user's data. Schema changes go through `normalize()`. |
| `store.js` | `DEFAULT_REST` | `90` s | Factory default rest length. |
| `store.js` | `clamp(n,min,max)` | — | Rounds to an **integer**. Used for reps, sets, target, rating, seconds. |
| `store.js` | `clampKg(n,min,max)` | — | Rounds to **2 decimals**. Weights only. ⚠ Never use `clamp()` on a weight: gym plates come in 2.5 kg steps, and rounding 32.5→33 is data corruption. This shipped once as a real bug. |
| `sw.js` | `CACHE_VERSION` | `'repcounter-v9'` | ⚠ Bump on every app-file change. |
| `sw.js` | `SHELL` | 16 files | What gets cached for offline. |
| `timer.js` | tick interval | `200` ms | ~5 updates/second. |
| `app.js` | `VIEW_KEY` | `'repcounter.view'` | Second localStorage key. Mirrors the current screen so a reload reopens where you were. Deliberately outside Store's blob — throwaway UI position, not user data. |
| `app.js` | `VIEW_TTL` | `6` hours | How stale a saved screen may be and still be restored. Older than this reopens on HOME. |
| `timer.js` | alarm | `[180,90,180,90,260]` | Vibration pattern (ms), plus 3 square-wave beeps at 880 Hz. |
| `app.js` | remarks debounce | `500` ms | Autosave delay after typing stops. |
| `app.js` | `SAVED ✓` flash | `1600` ms | How long the confirmation shows. |
| `app.js` | tap animation | `90` ms | `.is-tapped` class duration on the counter. |
| `screens.js` | weight step | `±2.5` kg | The `−2.5`/`+2.5` buttons. |
| `screens.js` | timer presets | `30/60/90/120` s | |
| `screens.js` | chart `W`/`H` | `320` / `150` collapsed, `210` expanded | SVG viewBox units. |
| `screens.js` | dot threshold | `10` units | Below this point spacing, dot markers are dropped (the last point keeps its dot as a "you are here" anchor). |
| `ui.js` | stepper steps | `15` s (rest), `2.5` kg (weight) | |
| `css` | `#app` max-width | `480` px | Centred, so it looks deliberate on desktop. |
| `css` | input font-size | `.pad` 16px, `.field input` 22px | ≥16px or iOS Safari zooms on focus. |

### 6.7 Theme tokens (`css/theme.css`)

Every theme difference collapses into these custom properties. Switching themes
sets **one attribute** on `<html>`; nothing else changes.

| Token | Role |
| --- | --- |
| `--bg` | Page background |
| `--surface` / `--surface-2` | Cards, buttons, panels / raised surfaces, chips |
| `--text` / `--muted` | Primary / secondary text |
| `--accent` / `--accent-fg` | The one loud colour, and text drawn on it |
| `--invert-bg` / `--invert-fg` | High-contrast button (white on dark, black on light) |
| `--bw` / `--bc` | Card border width + colour — `0px` on dark themes, `3px` black on light |
| `--lead-w` | Accent left-bar on the "next up" card — `6px` dark, `0` light |
| `--hairline` | Divider lines |
| `--ring` | Timer dial ring |
| `--tap-shadow` | The counter's hard offset shadow |
| `--field-bg` / `--field-bw` | Input background / border width |
| `--dash-w` | Dashed border width for upcoming sets |
| `--scrim` | Modal backdrop |

**Two structural ideas make four themes from one stylesheet:**

1. Dark themes have no borders, light themes have 3px black ones — so
   `border: var(--bw) solid var(--bc)` renders correctly in both with no
   theme-specific rules.
2. In the mono themes `--accent` equals `--text`, so every accent cue still
   *works*, reading by weight and position rather than hue. No mono-specific
   code exists anywhere.

> If you ever need a theme-specific component rule, **a token is missing** —
> add the token instead.

### 6.8 Colour roles

| Role | Style | Examples |
| --- | --- | --- |
| Add something | accent, solid | `+ NEW WORKOUT`, `+ ADD EXERCISE` |
| Start a session | accent, solid | `START WORKOUT` |
| End / conclude something | **accent, outlined** (`.btn-outline`) | `END WORKOUT` |
| Primary flow action | invert | `COMPLETE SET`, `EXERCISE DONE` |
| Everything else | surface | `+ DROP`, `CLEAR SETS`, `CLEAR LOG`, `SAVE REMARKS` |

Accent additionally marks **live state** (the in-progress dot, the current set's
outline, rep counts, ON toggles, the active tab) and **destructive rows**
(`RESET ALL DATA`).

**`START` and `END WORKOUT` share one slot but never one weight.** Both are now
accent-coloured — they were solid `.btn-invert` white blocks until 19 Aug 2026,
changed on request because the white read as foreign against the black-and-red
theme. They are separated by **fill, not hue**:

- `START WORKOUT` — **solid** accent. The hero action of the screen.
- `END WORKOUT` — **outlined** accent (`.btn-outline`: transparent fill, 2px
  accent border, accent text).

That distinction is load-bearing, and it is the surviving half of the original
rule. Ending a session freezes it into the data log and **wipes the workout**.
It must not be tappable by muscle memory in the spot where `START` used to be,
and it must not read as another "add something" button like the solid red
`+ ADD EXERCISE` above it. Hollow reads as *concludes*; solid reads as *begins*.

⚠ `.btn-outline` fixes its border at **2px rather than `var(--bw)`** — on the
dark themes `--bw` is `0`, and the outline is the entire point of the button.
Everything else resolves through tokens; verified in all four themes (accent
red on `t3a`/`t3b`, white on `t7a`, black on `t7b`).

*(Documented exception: the timer screen's `START` button also uses
`btn-accent`.)*

---

## 7. The business rules that are easy to get wrong

All values in this section were **executed against the running app** and match.

### 7.1 Rest timer resolution — most specific wins

```
exercise.restOverride === null  → inherit the workout's setting
exercise.restOverride === 0     → explicitly OFF for this exercise
exercise.restOverride  >  0     → n seconds, overriding the workout
```

`Store.effectiveRest(workout, exercise)` returns
`{enabled, seconds, source}` where `source` is `'exercise'` or `'workout'`.

Completing a set auto-starts the countdown **only if** the resolved rest is
enabled. At zero: triple beep + vibration, and the timer bar turns accent with
`REST DONE — NEXT SET`.

### 7.2 Estimated 1RM — the switch point matters

| Reps | Formula | |
| --- | --- | --- |
| **1** | returns the weight unchanged | A single rep *is* the 1RM. Without this, Epley would inflate it (60×1 → 62). |
| **2–12** | Epley | `w × (1 + r/30)` |
| **> 12** | Wathan | `100w / (48.8 + 53.8·e^(−0.075r))` |

**12 reps uses Epley.** Verified: `e1rm(60,8) === 76`, `e1rm(60,12) === 84`,
`e1rm(60,1) === 60`, `e1rm(60,13) ≈ 86.8`.

The curves don't meet at the boundary (84.0 → 86.8 between 12 and 13 reps).
**That discontinuity is inherent to switching estimators and is not a bug.**

**One point per session** = the **highest** e1RM of all sets that day, including
drop segments. Not the first set, not the heaviest weight, not an average.

### 7.3 The broken Y axis

- A `0` tick sits at the origin, then a slashed break, then the real scale.
- The first tick after the break is the nearest multiple of 5 **at or below the
  lowest e1RM in the series**.
- If a later session is *worse* than the first, the base drops so the dip stays
  on the chart.

Verified: series `[26, 31]` → `ticks [25,30,35]`; `[44, 48]` → `[40,45,50]`;
`[40, 38]` → base drops to `35`, `ticks [35,40]`.

> ⚠ `e1rmAxis().ticks` contains **only the real scale** — the `0` label is drawn
> separately by `e1rmChart()` and is deliberately not a member of the array.

### 7.4 Drop sets

One set, multiple segments at descending weights. Stored as:

```js
{ reps: 8, weight: 62.5, drops: [ {reps:6, weight:45}, {reps:4, weight:30} ] }
```

Verified end to end: that shape produces `log.length === 1` (one set, not
three) and `Store.entryReps(entry) === 18`.

**Edge case, verified:** completing a set immediately after a drop with 0 reps
counted does **not** record a trailing 0-rep segment — it's silently discarded.
And the "log an empty set?" guard does not fire when drop segments are banked.

Display: dimmed sub-rows `DROP 1`, `DROP 2` under the parent set; rows labelled
`2·D1` in the spreadsheet.

### 7.5 Set log — three visual states

| State | Appearance |
| --- | --- |
| **Upcoming** | Full-strength text, dashed border. **Not greyed.** |
| **Current** | Accent border and label, live rep count, shows banked drops. |
| **Completed** | Greyed, opacity 0.5, `✎` icon. Tap to edit or delete. |

The "upcoming = full strength, completed = faded" direction is deliberate and
was explicitly specified — it's the opposite of the intuitive default.

### 7.6 Rating scale

1–10, asked **only at session end**, optional (skipping stores `null`).
One continuous oklch ramp pinned at three points, converted to sRGB hex in JS:

The ramp runs **red → orange → yellow → green**, so the tile reads as a verdict
before you read the digit. Authored in oklch, pinned at **five** points — a
straight 1→10 interpolation across that much hue slides through muddy olive in
the middle instead of a clean yellow, and the green end needs its own anchor or
8–10 read as lime rather than green.

| Pin | oklch (L C H) | Verified hex | |
| --- | --- | --- | --- |
| **1** | `0.585 0.222 27` | `#e22226` | bright red — the app's hazard red |
| **4** | `0.720 0.190 62` | `#f58200` | orange |
| **7** | `0.865 0.185 100` | `#f0d400` | yellow |
| **8** | `0.690 0.185 149` | `#21b956` | the handover into green |
| **10** | `0.520 0.130 150` | `#1d7d3e` | dark green |

Full verified ramp: `#e22226` `#ec4800` `#f26600` `#f58200` `#f89d00` `#f6b900`
`#f0d400` `#21b956` `#1f9a4a` `#1d7d3e`.

**Hue moves +12–13 per step up to rank 7, jumps +49 across 7→8, then stops**
(+1 total over 8→10). The yellow→green handover therefore happens in one
decisive step, and 8/9/10 are the same green getting steadily deeper. **Rank 9
is the exact midpoint of the 8 and 10 pins**, which is why it needs no pin.

> ⚠ **Lightness peaks at 7 — it does not climb the whole way.** The older docs
> record a monotonic-lightness rule from the previous maroon→gold ramp. That
> rule cannot survive a red→green scale: yellow is intrinsically the lightest
> hue on the path, so forcing 8–10 lighter still would only produce pale mint,
> never a vivid green. Lightness rises `0.585 → 0.865` (peak at 7), then
> descends `0.690 → 0.520` across the greens, so the scale deepens as it
> improves and 10 lands on a solid dark green rather than trailing off.

> ⚠ **The green end sits just inside the sRGB gamut, and chroma must fall as
> lightness falls.** sRGB simply holds less saturated green the darker you go:
> near H 149 the ceiling is ~`0.190` at `L 0.690`, but only ~`0.135` at
> `L 0.520`. Exceeding it doesn't error — the conversion clamps the red channel
> to 0, quietly flattening the colour and shifting its hue. Hence `C 0.185` at
> rank 8 but `0.130` at rank 10. **Raising chroma at the dark end gives you a
> duller green, not a deeper one — lightness is the lever there.** (Ranks 2–7
> do clamp slightly; that is inherited from the original ramp and is what gives
> the oranges their punch.)

**Every numeral is the same ink (`#0a0a0a`)** — a deliberate visual choice, and
the third text rule this ramp has had. The history matters, because the first
two both looked reasonable on paper:

| Rule | Why it went |
| --- | --- |
| "white below 5, black from 5 up" | Hard-coded to a rank; broke the moment the hues changed |
| Per-tile pick by measured contrast | Correct, but flipped ranks 1 and 10 to white while 2–9 stayed dark, splitting the strip into three visual groups |
| **Uniform ink** (current) | Reads as one continuous scale |

> ⚠ **Accepted accessibility shortfall.** Contrast of ink on each tile:
> rank 1 `4.22`, ranks 2–8 `5.2–13.3`, rank 9 `5.45`, **rank 10 `3.82`**.
> The numerals are **17px at weight 900** (`.rate-num` in `app.css`). WCAG's
> relaxed 3.0 bar for "large text" begins at 18.66px bold, so 17px just misses
> it and the applicable bar is 4.5 — **ranks 1 and 10 sit below it.** In
> practice they read fine (heavy condensed digits on a saturated field), but
> this is a known, accepted trade-off, not an oversight.
>
> **There is no longer an automatic fallback to white text.** If any tile is
> darkened further it simply gets harder to read. To clear 4.5 with ink, rank 1
> needs `L ≥ 0.605` (`#e92d2d`) and rank 10 needs `L ≥ 0.565` (`#298b49`) —
> both small enough that the colours barely change.
>
> **Coupling:** this depends on `.rate-num { font-size: 17px }` in
> `css/app.css`. Grow it past 18.66px and every tile passes comfortably; shrink
> it and ranks 1 and 10 get worse.

**Emitted as hex, not oklch**, because these land in inline `style` attributes
where `@supports` can't reach.

### 7.7 Session duration

A session ended without a recorded start gets `durationMs: null` and the UI
shows `—`. **Verified:** `formatDuration(null)` → `'—'`,
`formatDuration(47min)` → `'47m'`, `formatDuration(72min)` → `'1h 12m'`.

### 7.8 Backgrounding — what survives and what cannot

⚠ Two behaviours here exist *because* the browser stops running the app's
JavaScript the moment the user switches away. Both were reported as bugs.

**The rest-timer alarm.** `setInterval` is throttled hard when backgrounded
(Chrome: as little as once a minute) or suspended outright (iOS), so `tick()`
is not called at the moment a countdown reaches zero and the alarm never fires.

### ⚠ The approach that was tried and REJECTED — do not rebuild it

An earlier fix synthesised a WAV of silence-then-beep and played it through an
`<audio>` element for the whole rest period. **It worked** — verified: with the
JS main thread frozen for 2.55s the audio clock advanced 2.55s, so the beep
fires with the app dead.

**It was reverted anyway, and the reason is not negotiable.** A page playing
audio takes *audio focus*: on Android the OS pauses the user's music outright,
on iOS it ducks or pauses. That meant music stopping between every single set.
For a gym app that is far worse than a missed beep — the user's words: *"music
stopping in the middle of sets is a trade off no one is willing to make."*

⚠ **The general rule this leaves behind: never hold an audio session open
across a rest period.** `Timer.alarm()` creates the AudioContext at the moment
of the beep and not one instant earlier. Anything that opens it when a
countdown *starts* — including innocuous-looking "pre-scheduling" — takes audio
focus for the whole rest and reintroduces the same failure.

### What is there instead: notifications

⚠ **A notification sound MIXES with music.** The OS ducks the music for an
instant and plays the alert over it; nothing is paused, no audio focus is
taken. That single property is why this approach is acceptable where the audio
one wasn't.

Handled by the `Notify` object in `app.js`, with two delivery paths, both
feature-detected:

| # | Path | Fires with the app frozen/dead? |
| --- | --- | --- |
| 1 | **Notification Triggers** — `showNotification(..., {showTrigger: new TimestampTrigger(t)})`. The OS holds the schedule. | **Yes, exactly on time.** Chrome/Android, where experimental web platform features are enabled. |
| 2 | **Page timer** fallback — `setTimeout` → `reg.showNotification`. | Only when the browser next lets our JS run. Android: often close. iOS: late or never. |

- Permission is requested **once, inside the COMPLETE SET tap** (`Notify.ask`).
  Browsers reject a prompt that isn't tied to a real gesture, and that is also
  the only moment it makes sense to the user.
- `Notify.cancel()` is called from every manual timer control (`timer-reset`,
  `timer-mode`, `timer-preset`, custom duration, and pause via `timer-toggle`)
  and on `visibilitychange` when the user returns — otherwise the phone buzzes
  for a countdown that was already stopped.
- One `tag: 'rest-done'` means a new rest **replaces** the old alert rather than
  stacking notifications in the shade.
- `sw.js` handles `notificationclick`: focuses an existing window if one is
  alive, otherwise opens the app.

> **Expected outcome, stated honestly: Android should work, iOS probably won't.**
> iOS has no route to a scheduled local notification from a web page. That split
> was explicitly accepted rather than shipping a fix that fights the user's
> music on both platforms.
>
> ⚠ **NOT VERIFIED ON A REAL HANDSET.** The verification browser denies
> notification permission and blocks service-worker registration, so the paths
> were confirmed to be correctly wired and to fail safely — *not* observed
> delivering an actual notification.

**Vibration cannot be pre-scheduled** (`navigator.vibrate` fires immediately or
not at all), so in-app haptics remain foreground-only. The notification carries
its own vibration pattern, which the OS delivers.

**Losing your place.** A backgrounded page is often discarded to reclaim memory
and re-run from scratch on return. `view` lives in memory, so the app used to
always reopen on HOME mid-workout. It is now mirrored to `repcounter.view` on
every navigation and restored at boot, subject to three guards: not older than
`VIEW_TTL` (6h), not `home`, and the workout/exercise it names must still
exist. Any failure falls back to HOME.

*(The session clock itself was never affected — `activeStartedAt` has always
been persisted, and `Timer` derives elapsed time from `Date.now()` rather than
accumulating ticks.)*
---

### 7.9 Backup and restore

⚠ **This is the only protection against total data loss.** Everything lives in
one `localStorage` key, in one browser, on one device. Clearing site data,
switching phones, or the OS evicting storage destroys the entire history with no
recovery — and storage is per-origin, so `localhost` data never appears on the
deployed site.

`Settings → DATA` has three rows, ordered by frequency and by damage:

| Row | Does |
| --- | --- |
| `EXPORT BACKUP` | `Store.exportJSON()` → the whole state blob, pretty-printed, saved as `rep-counter-backup-YYYY-MM-DD.json` via a detached `<a download>`. |
| `IMPORT BACKUP` | Confirm → file picker → `Store.importJSON(text)`. |
| `RESET ALL DATA` | Unchanged. The only accent-coloured (danger) row of the three. |

**Import is destructive and there is deliberately no merge.** Merging two
divergent histories would silently duplicate sessions with no way to tell which
copy is correct. A restore is a restore.

**Validation, in order:** parse as JSON → must be a non-array object → must
carry `workouts` or `sessions` (otherwise any unrelated `.json` would import
"successfully" as an empty app) → then straight through the **same
`normalize()` every load uses.** That last point is the important one: an older
backup missing newer fields is repaired exactly as an old save would be, so
backups never need their own migration path. `importJSON` never throws; it
returns `{ok:false, error}` for the caller to display.

*Verified:* full round trip is byte-identical including 62.5 kg weight
precision; a v1-era backup missing `restOverride`, `draftDrops`, `drops` and
`restAlerts` was fully repaired on import; all four malformed inputs rejected
with data left intact.

## 8. Real project history (from git)

### ⚠ This section describes the OLD, abandoned repo. Read §8.1 first.

**As of 8 Oct 2026 this folder is its own git repository**, pushed to
`git@github.com:siddhaaaaaaaaaaarth/rep-counter.git` and deployed by GitHub
Pages — see **§8.1** below. Everything from here to the end of §8 is the
history of a *different* repo that is no longer used for anything.

**That old repository lives in the sibling folder
`~/Documents/Claude code/rep-counter/`** (note: the working folder itself moved
out of `Documents/` in Oct 2026 and is now `~/Claude code/rep-counter 2/`).
The history below is reconstructed from that sibling repo, which held
byte-identical app code as of 19 Aug 2026.

There are **three commits**, all authored by `siddharth <siddharth.j2128@gmail.com>`:

| # | Commit | Date | Subject | Files |
| --- | --- | --- | --- | --- |
| 1 | `875d182` | 2 Aug 2026 | Rep Counter: offline-capable gym rep counter PWA | **18 files added, 4,174 insertions.** The entire app arrived in one commit: `.nojekyll`, `README.md`, all 3 CSS files, both fonts, both icons, `index.html`, all 6 JS files, `manifest.json`, `sw.js`. |
| 2 | `f289287` | 5 Aug 2026 | Add documentation pack + detailed file-header comments | 12 files, +1,791/−42. Added `docs/00`–`05`; expanded header comments on all six JS modules (`app.js` +82, `screens.js` +80, `store.js` +115, `themes.js` +38, `timer.js` +46, `ui.js` +46). **No behaviour changed.** |
| 3 | `4960ba1` | 19 Aug 2026 | Add 06-PROJECT-CONTEXT.md: session handover notes | 3 files, +238/−5. Added `docs/06`, rewrote parts of `docs/00`. **No behaviour changed.** |

**What this history does and does not tell you:**

- **No file has ever been removed or renamed.** Every file added in commit 1
  still exists.
- **Only commits 1 and 2/3 touched code, and 2/3 were comments only.** So
  *every* behavioural change in this app predates version control — the roughly
  thirty rounds of iteration described in `06-PROJECT-CONTEXT.md` §3 (the emoji
  rating scale, the theme picker, the tab selector, the seeded sample workouts,
  the Google Fonts link…) all happened before commit 1 and left **no trace in
  git**. `06-PROJECT-CONTEXT.md` §3 is the only record of them and should be
  treated as primary source, not as a summary of something recoverable.
- Branch `main`, remote `origin` →
  `https://github.com/siddhaaaaaaaaaaarth/rep-counter-2.git`.
- **`git push` never succeeded from that repo.** The site was deployed by
  GitHub's web drag-and-drop uploader, so GitHub had its own unrelated commit
  history and a plain push was rejected as a non-fast-forward. Auth was never
  completed either — no key, no token. Full detail in
  `06-PROJECT-CONTEXT.md` §2. **That repo is now abandoned; none of this
  applies to current work.**

### 8.1 The current repository ⚠ this is the live one

Created 8 Oct 2026, deliberately as a **fresh repo with no shared history** —
the old repo's three commits are snapshots of an older build, and the old repo
and its live site were left untouched as a separate project.

| | |
| --- | --- |
| **Local** | `~/Claude code/rep-counter 2/` (moved out of `Documents/` Oct 2026) |
| **Remote** | `git@github.com:siddhaaaaaaaaaaarth/rep-counter.git` — **SSH, not HTTPS** |
| **Live site** | <https://siddhaaaaaaaaaaarth.github.io/rep-counter/> |
| **Pages source** | branch `main`, folder `/ (root)` |
| **First commit** | `1511484` — 30 files, 9,162 insertions, the complete state at `repcounter-v9` |

**Deploying is now `git push`.** Pages rebuilds from `main` within a minute or
two. No more drag-and-drop.

- **Auth is an ed25519 SSH key** at `~/.ssh/id_ed25519`, registered on the
  GitHub account. No passphrase — it is protected by the macOS account instead.
  `ssh -T git@github.com` confirms it.
- **Git identity is set LOCALLY in this repo only** (`siddharth
  <siddharth.j2128@gmail.com>`), not machine-wide. A clone elsewhere will not
  inherit it.
- **`.gitignore` excludes `.DS_Store`** — it was committed to the old repo by
  accident and caused permanent noise in `git status`.
- ⚠ **`CACHE_VERSION` still has to be bumped by hand** in the same change.
  Pushing does not do it for you, and without it every installed phone keeps
  serving the old build indefinitely. This is now the single easiest way to
  deploy something that appears to do nothing.
- ⚠ **A deployed change needs TWO app launches to appear on a phone.** The
  service worker is cache-first: the first launch after a deploy serves the
  cached build and fetches the new one in the background; the second shows it.
  That is not a failed deploy.

**The old project, for reference and left alone:** repo
`siddhaaaaaaaaaaarth/rep-counter-2`, still live at
<https://siddhaaaaaaaaaaarth.github.io/rep-counter-2/> serving `repcounter-v2`,
with its local folder at `~/Documents/Claude code/rep-counter/`. Different
origin, so its `localStorage` data is **not** visible to the new site.

---

## 9. Corrections from the previous docs

Every claim in `00`–`06` was checked against the source. The docs were largely
accurate — the app genuinely behaves as `01-PRODUCT-SPEC.md` describes, and
every ⚠ CRITICAL rule verified. The following are the real disagreements.

| # | Previous claim | Where | Actually | Impact |
| --- | --- | --- | --- | --- |
| 1 | "2,732 lines of JavaScript, 1,247 lines of CSS, across 12 files"; per-file counts `app.js 894`, `screens.js 745`, `store.js 623`, `themes.js 85`, `timer.js 150`, `ui.js 235` | `00` | Those are the **commit-1 counts**, before commit 2 added header comments. Real counts as of 19 Aug 2026 (pre-this-session): JS **3,055**, CSS **1,247**. After this session's comment additions: JS **3,148**, CSS **1,288**. | Cosmetic, but it made the docs look verified when they were a commit behind. |
| 2 | "**Nine screens**" | `01` §1 | **Eight.** `home`, `settings`, `workout`, `exercise`, `timer`, `datalog`, `logworkout`, `daysheet`. `render()` handles 8 screens (7 `case` branches plus `default`, which is home) and `Screens` exports 8 screen functions plus the `ratingTiles` builder. The doc's own diagram lists 8. | Minor, but it invites a hunt for a screen that doesn't exist. |
| 3 | "~52 actions are registered" | `02` §4, `app.js` header | **54**, one of which (`workout-rest`) is dead — see §10.2. So 53 reachable. | Minor. |
| 4 | "lowest 26 → `0, 25, 30, 35`" | `06` §7-adjacent / `01` §6 | `e1rmAxis()` returns `ticks` **without** a `0` — the 0 label is drawn separately in `e1rmChart()`. `04` states it correctly as `[25,30,35]`; `06`'s `[0,25,30,35]` would fail as a literal assertion. | Would make a copy-pasted verification check fail. |
| 5 | "lowest 26 → ticks `[25,30,35]`" given as a self-contained check | `04` §9 | True only if the series **maximum** also lands in 31–35. `[{e1rm:26}]` alone returns `[25,30]`. The check needs its max stated: `[{e1rm:26},{e1rm:31}]` → `[25,30,35]` (verified). | An incomplete verification recipe. |
| 6 | "The collapsed card renders the **same SVG** at a smaller height — a true proportional scale, not a separate simplified rendering" | `02` §6 | It's the same *function*, not the same SVG. `expanded` changes the height (150→210), bottom padding (24→30), dot radius (3→4), label density (5→8 picks), and whether per-point value labels are drawn at all. It is genuinely one code path — the maintenance point stands — but it is **not** a proportional scale. | Would mislead anyone reasoning about chart sizing. |
| 7 | "ES5 … verified by grep as part of the compatibility audit"; "old Android WebView support" | `00`, `02` §1 | The **syntax** claim is correct — a grep for `=>`, backticks, `let`/`const`, `?.`, `??`, `...` returns **zero** hits outside comments. But the code uses ES2015 **runtime APIs**: `Object.assign` (×2), `NodeList.prototype.forEach` (×1), `Node.isConnected` (×2). `store.js`'s `Object.assign` is **on the boot path**. | Substantive — see §10.1. The real floor is ~Chrome 45, not "ES5 everywhere". |
| 8 | "the rating ramp … converts oklch→hex in JavaScript, because those colours land in inline `style` attributes where `@supports` can't reach" — presented as the complete solution to the inline-style problem | `03` §6 | True for `RATINGS`, but the **theme swatches** in Settings do exactly what the doc warns against: `themes.js` stores `oklch(...)` string literals which `screens.js` writes straight into inline styles. Verified in the DOM: **5 of 8** swatch elements carry a raw `oklch()`. | Real, cosmetic — see §10.3. |
| 9 | "`UI.exercise` — name + sets + target + weight **+ drop sets**" | `ui.js` inline comment | There is no drop-set control in that sheet. Leftover from the removed per-exercise drop-set toggle. **Corrected in this session.** | Would send someone looking for a control that was deliberately removed. |
| 10 | "the local repo … has **2 commits**" | `06` §2 | **3** — commit 3 is the one that added `06` itself. Self-referentially stale. | Trivial. |
| 11 | "On install it copies all 16 files into Cache Storage" | `02` §7 | Correct count, but it *attempts* 16 individually and tolerates failures (deliberately not `addAll`). A partial cache is possible and silent. | Worth knowing when offline behaves oddly. |

| 12 | The rating ramp is deep maroon (1) → orange (5) → bright gold (10), pinned at three points, with lightness climbing the whole way and text flipping white→black at rank 5 | `01` §7, `03`-adjacent | **Superseded on 19 Aug 2026**, not an error in the original doc — the ramp was deliberately changed to bright red → orange → yellow → lush green, on four pins, with lightness peaking at 7 and text colour computed per tile by contrast. See §7.6 and `CHANGELOG.md`. `01` §7 was left unedited by standing agreement that `07` is the single place corrections are recorded. | `01` §7's colour table and its "lightness climbs at every step" line are now both wrong. Read §7.6 instead. |

**Claims that were checked and are correct** (recorded so nobody re-checks):
the whole of `01-PRODUCT-SPEC.md`'s ⚠ CRITICAL set — session lifecycle, drop-set
storage shape and the 0-rep edge case, the three set-log states, rest-timer
inheritance, the Epley/Wathan switch at 12, the broken-axis rule, the rating
ramp's three pinned stops and the white→black flip at 5; the fresh-install
defaults; the `data-act` delegation model; the two render-loop exceptions;
`#sheetRoot` isolation; the oklch `@supports` mechanism; the nested-button fix
(zero nested buttons in the live DOM); `-webkit-font-smoothing`; the `dvh`/`vh`
and `aspect-ratio` fallback pairs.

---

## 10. Known issues

Verified defects and gaps, in rough order of how much they matter. **None of
these are currently fixed** — they are documented, not repaired, because this
session's scope was documentation.

### 10.1 The ES5 promise is not the whole truth ⚠ highest impact

The syntax is genuinely ES5, but three ES2015 runtime APIs are used:

| API | Where | Browser floor |
| --- | --- | --- |
| `Object.assign` | `store.js:208` (**boot path**), `app.js:201` (every navigation) | Chrome 45 / Safari 9 |
| `NodeList.prototype.forEach` | `ui.js:136` (every stepper sheet) | Chrome 51 / Safari 10 |
| `Node.isConnected` | `app.js:284`, `app.js:310` (remarks `SAVED ✓` flash) | Chrome 51 / Safari 10 |

`store.js:208` is the serious one: it runs before anything renders, so on a
browser without `Object.assign` the app throws and shows a blank screen — the
exact failure mode the ES5 rule exists to prevent.

**If this ever matters,** replace it with a hand-rolled copy loop; the other two
are easy to avoid too (`for` loops). Until then, the honest statement is: **ES5
syntax, ~Chrome 45+ runtime.** (Also relevant, from the same family: `closest()`
Chrome 41+, `classList.toggle(name, force)`, `dataset`, `matches()`.)

### 10.2 `workout-rest` is dead code

`app.js` registers a `'workout-rest'` action (~35 lines) that nothing emits — a
grep for `data-act="workout-rest"` returns nothing. It served a REST TIMER chip
on the workout screen that was **removed at the user's request** (the big ON/OFF
panel on the timer screen replaced it). Everything it does is reachable through
`workout-settings`. Harmless; delete it only if you want the file shorter.

### 10.3 Theme swatches emit raw `oklch()` into inline styles

`themes.js` defines `HAZARD = 'oklch(0.58 0.24 27)'` and
`PAPER = 'oklch(0.97 0 0)'` as string literals, and `screens.js` writes them
into `style="background:…"`. The `@supports` fallback in `theme.css` cannot
reach an inline attribute, so on Chrome < 111 / Safari < 15.4 those swatches
paint as nothing — the Settings theme rows would show a blank strip instead of a
colour preview.

Verified in the live DOM: **5 of the 8** swatch `<i>` elements carry a raw
`oklch()` (the three `#0a0a0a` INK swatches are already hex and are fine).
Cosmetic only; the themes themselves fall back correctly.
**Fix if wanted:** `'#e60016'` for HAZARD, `'#f5f5f5'` for PAPER.

### 10.4 One sheet input is below the 16px iOS-zoom threshold

`UI.stepperHtml()` gets its ≥16px font-size from the `.field input` rule, so a
stepper only inherits it when it sits inside a `.field` wrapper. In
`restSheet()` (`app.js`) the seconds stepper is placed in a bare
`<div data-secs>` instead.

**Measured in the live app: `13.3333px`** — versus `22px` for the equivalent
input in the Settings default-rest sheet. So opening *Exercise → REST chip →
SET FOR THIS EXERCISE ONLY* and focusing the seconds field will make iOS Safari
zoom the page, which is exactly the behaviour §3 of `03-DESIGN-SYSTEM.md` says
was designed out.

**Fix:** wrap that stepper in `<div class="field">`, or add
`.stepper input { font-size: 22px; }` to `app.css`.

### 10.5 Service-worker registration could not be verified in this environment

`sw.js` serves correctly (HTTP 200, `Content-type: text/javascript`), but the
browser pane used for verification refuses to register it:
`Failed to register a ServiceWorker … An unknown error occurred when fetching
the script.` This is an environment restriction, not a code fault — and the
registration is properly guarded, so the app logged the failure and ran
perfectly as an online-only page.

**Consequence: offline behaviour was NOT re-verified in this session.** It was
verified previously (per `06-PROJECT-CONTEXT.md` §7) by stopping the server and
reloading. Anyone changing `sw.js` should re-run that test in a normal browser.

### 10.6 Pre-existing gaps (deliberate non-goals — do not "fix" unprompted)

From `06-PROJECT-CONTEXT.md` §6, re-confirmed against the code:

- ~~**No export/import.**~~ **FIXED 25 Aug 2026** — `Settings → DATA → EXPORT /
  IMPORT BACKUP`. See §7.9.
- **Data is per-origin.** Sessions logged at `localhost:8080` do not appear at
  the GitHub Pages URL. No migration path exists.
- **No session history editing.** `sessions` is append-only — nothing in the code
  edits or deletes a session record once frozen. (Session *notes* are now at
  least readable — see §7.9's sibling, `Store.sessionNotes` — but not editable.)
- No progressive-overload suggestions, rest-day tracking, bodyweight logging or
  plate calculator. Never requested.
- **Not device-tested.** Verified in a Chromium engine at mobile viewport only.
  The iOS/Android compatibility work was done analytically.
- `uid()` is `Math.random().toString(36).slice(2,10)` — not collision-proof.
  Irrelevant at personal scale; worth knowing before building anything on it.

---

## 11. How to verify a change

There is no test suite. This is the substitute, and it is fast.

**1. Serve it and open the console.** (§2.)

**2. Beat the caches first.** `python3 -m http.server` sends no `Cache-Control`,
so the browser serves stale JS and your edit appears to do nothing. Once a
service worker is registered that's a *second* cache layer.

```js
Promise.all(['index.html','css/app.css','js/app.js','js/screens.js','js/store.js']
  .map(function(p){ return fetch(p, {cache:'reload'}); }))
  .then(function(){ location.reload(); });
```

Full reset including the service worker and stored data:

```js
(async function(){
  var rs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(rs.map(function(r){ return r.unregister(); }));
  var ks = await caches.keys();
  await Promise.all(ks.map(function(k){ return caches.delete(k); }));
  localStorage.clear();
  location.reload();
})();
```

> **Before concluding "my change didn't work", confirm the browser actually has
> your change.** Check a known-changed string in the DOM. This has cost real
> time more than once.

**3. Drive the real code paths.** Every module is a global, so you can exercise
the app without tapping. Because actions run through one delegated listener,
`.click()` on an element fires the *real* handler, not a mock.

```js
RepCounter.go('workout', {wid: Store.workouts[0].id});
RepCounter.view();
document.querySelector('[data-act="complete-set"]').click();
```

**4. Run the regression checks.** All of these currently pass:

```js
// maths
Store.e1rm(60, 8);                                  // 76
Store.e1rm(60, 12);                                 // 84  (Epley, not 84.9 Wathan)
Store.e1rm(60, 1);                                  // 60  (not 62)
Store.e1rmAxis([{e1rm:26},{e1rm:31}]).ticks;        // [25,30,35]
Store.e1rmAxis([{e1rm:40},{e1rm:38}]).base;         // 35  (dip stays on chart)
Store.formatDuration(null);                         // '—'

// weight precision — an integer clamp here is data corruption
var w = Store.addWorkout({name:'t'});
var e = Store.addExercise(w.id, {name:'b', sets:3, target:8, weight:62.5});
Store.exercise(w.id, e.id).weight;                  // 62.5

// a drop set must stay ONE set
Store.updateExercise(w.id,e.id,{draft:8}); Store.addDropSegment(w.id,e.id);
Store.updateExercise(w.id,e.id,{weight:45,draft:6}); Store.logSet(w.id,e.id);
Store.exercise(w.id,e.id).log.length;               // 1
Store.entryReps(Store.exercise(w.id,e.id).log[0]);  // 14

// every screen renders, and nothing nests a button in a button
['home','settings','datalog','workout','exercise','timer','logworkout','daysheet']
  .forEach(function(n){ RepCounter.go(n, {wid:w.id, eid:e.id}); });
document.querySelectorAll('button button').length;  // 0
```

**5. Check the console is clean.** Zero errors. (One expected exception: a
service-worker registration failure in environments that block them — §10.5.)

**6. Test offline properly.** Don't trust devtools' "offline" checkbox —
**stop the server** and reload. That's the real condition an installed PWA
faces.

**7. If you changed any app file, bump `CACHE_VERSION` in `sw.js`.**

**8. Update the docs in the same turn.** See `../CLAUDE.md`.
