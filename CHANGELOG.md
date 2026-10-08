# CHANGELOG

Every change to this app, newest first. **Adding an entry here is part of making
a change, not a follow-up task** — see `CLAUDE.md`.

Format for each entry:

```
## YYYY-MM-DD — Short title
**What changed** · **Why** · **New variables/behaviour a supervisor should know**
· **Files touched** · **CACHE_VERSION bumped?** · **How it was verified**
```

---

## 2026-08-25 — Backup/restore, session notes made readable, exercise reordering

Three features chosen off the improvement list: #2 export/import, #1 session
notes, #4 reorder exercises.

### 1. Export / import backup — the biggest gap in the app closed

Everything lived in one `localStorage` key, in one browser, on one device, with
no recovery from a cleared browser or a new phone.

- `Settings → DATA` now has `EXPORT BACKUP` and `IMPORT BACKUP` above
  `RESET ALL DATA` — ordered by frequency and by damage; only RESET stays
  accent/danger.
- `Store.exportJSON()` pretty-prints the whole state blob;
  `Store.exportFilename()` gives `rep-counter-backup-YYYY-MM-DD.json`.
  Delivered via a detached `<a download>`, which never enters the document.
- `Store.importJSON(text)` validates then **routes through the same
  `normalize()` every page load uses** — so an old backup missing newer fields
  is repaired exactly as an old save would be, and backups never need their own
  migration path. Never throws; returns `{ok:false, error}`.

⚠ **Import is destructive and there is deliberately NO merge.** Merging two
divergent histories would silently duplicate sessions with no way to tell which
copy is right. Confirmed before the file picker opens.

### 2. Session notes are readable at last

`session.remarks` was **write-only**: `endSession()` froze the workout's notes
into the session record and no screen ever rendered them. The user could type
"shoulder felt off today", save it, and never see it again.

- New `Store.sessionNotes(wid)` → `[{id, date, remarks, rating}]`, newest first,
  sessions with empty notes filtered out.
- New `SESSION NOTES` card at the bottom of the data-log workout screen.
  **Renders nothing at all when no session has a note** — no empty state, per
  the standing less-UI preference.
- Not filtered by the `‹ ›` exercise selector, unlike the table and graph: a
  session note is about the whole session.
- `.note-body` uses `white-space: pre-wrap` to keep the user's line breaks, and
  is deliberately NOT uppercased/condensed like the rest of the app's display
  type — these are the user's own sentences and must read as prose.

### 3. Reorder exercises

New exercises always landed at the bottom; the only way to reorder was delete
and re-add, which **threw away that exercise's remarks and rest override**.

- New `Store.moveExercise(wid, eid, delta)`. Order remains plain array order —
  no `position` field, for the same reason set numbers aren't stored: a derived
  order can't disagree with itself. Returns `false` at the list ends so callers
  needn't bounds-check.
- `↑ ↓` controls appear on each card in EDIT mode, dimmed (not removed) at the
  ends so the row's controls don't shift as you reorder.
- Styled `.ord-btn` on `--surface-2`, not accent: reordering is reversible,
  deleting isn't, and only the destructive control gets the loud colour.

⚠ **The arrows are `<span data-act>`, never `<button>`** — the card itself is a
`<button>` and the parser silently auto-closes an outer button at the first
nested one. Same trap as `05-GOTCHAS` §1.1. Asserted in testing: zero nested
buttons, all arrows are SPANs.

**New/changed API** `Store.moveExercise`, `Store.sessionNotes`,
`Store.exportJSON`, `Store.exportFilename`, `Store.importJSON`. Actions:
`move-exercise`, `export-data`, `import-data` (**54 → 58**). No new persisted
fields, so **no `normalize()` change was required**.

**Files touched** `js/store.js`, `js/screens.js`, `js/app.js`, `css/app.css`,
`sw.js`, `docs/07-MAIN-REFERENCE.md` (§3.3, §4.1, new §7.9, §6.6, §10.6),
`CHANGELOG.md`.

**CACHE_VERSION bumped?** **Yes — `repcounter-v8` → `repcounter-v9`.**

**How it was verified**

- **Reorder:** `ABC → ACB → CAB` through the real store; both ends clamp
  (`false`, order unchanged); an exercise's `remarks` and `restOverride:45`
  both **survived a move** — the thing the delete/re-add workaround destroyed.
  Clicked the real `↓` control through the delegated handler and confirmed the
  stored order changed.
- **Notes:** only noted sessions listed (1 of 4); rendered in the DOM with the
  user's newline preserved (`white-space: pre-wrap` confirmed computed); a
  workout with no notes renders **zero** `.note-row` elements.
- **Backup round trip:** exported 11.5 KB, `resetAll()`, re-imported →
  `roundTripIdentical: true`, including **62.5 kg weight precision** and theme.
- **Old-backup migration:** imported a v1-era blob missing `restOverride`,
  `draftDrops`, log-entry `drops` and `restAlerts` → all repaired by
  `normalize()`, version bumped to 3, 62.5 kg preserved.
- **Malformed input:** non-JSON, a bare array, unrelated JSON, and an empty
  string all rejected with distinct messages; **existing data intact after all
  four failures**.
- Screenshotted both new UIs at 375×812.
- Regression: 8 screens render, zero app console errors, **zero nested
  buttons**, `e1rm(60,8)=76` / `(60,12)=84` / `(60,1)=60`, axis `[25,30,35]`,
  rating ramp unchanged. ES5 clean, no colour literals added to `app.css`.

⚠ **Not verified:** the actual file *download* and *file-picker* steps — the
verification browser sandboxes both. The data layer either side of them is
fully tested; the two DOM calls (`a.click()`, `input.click()`) are not.

---

## 2026-08-19 — REVERTED the audio-track alarm; replaced with notifications

### The revert, and why

The previous entry's silence-then-beep audio track **worked** but was rejected
by the user and removed the same day. Holding an audio session open for the
whole rest period takes *audio focus*: Android pauses the user's music outright,
iOS ducks or pauses it. Music stopping between every set is worse than a missed
beep for a gym app.

> *"music stopping in the middle of sets is a trade off no one is willing to
> make to use an app. Not even I would and I'm literally making the app."*

**Removed entirely:** `Timer._wavAlarm`, `startTrack`, `trackPlaying`,
`stopTrack`, `scheduleAlarm`, `cancelScheduledAlarm`, `STALE_ALARM_MS`, the
`_track`/`_trackUrl`/`_scheduled`/`_alarmed` fields, the `backgroundAlarm`
setting (store + settings row + action), and the audio-context nudge on
`visibilitychange`. `Timer.alarm()` and `tick()` are back to their original
form.

⚠ **THE RULE THIS LEAVES BEHIND — do not violate it.** The AudioContext is
created at the moment of the beep and **not one instant earlier**. Anything
that opens it when a countdown *starts* — including innocuous-looking
"pre-scheduling" — takes audio focus for the whole rest and reintroduces the
music bug. Verified by assertion: `Timer._ctx` is still `false` after
`startRest()`.

### What replaced it: rest-end notifications

Chosen after consulting the user on the options.

⚠ **The whole reason this is acceptable: a notification sound MIXES with
music.** The OS ducks the music for an instant and plays the alert over it.
Nothing is paused and no audio focus is taken.

New `Notify` object in `app.js`, two feature-detected delivery paths:

1. **Notification Triggers** (`showTrigger` + `TimestampTrigger`) — the OS holds
   the schedule, so it fires **exactly on time even if the page has been frozen
   or discarded**. Chrome/Android, where experimental web platform features are
   enabled.
2. **Page-timer fallback** — `setTimeout` → `reg.showNotification`. Fires
   whenever the browser next runs our JS. Android: often close to on time.
   iOS: late or never.

- **New persisted field `restAlerts`** (boolean, default `true`), with
  `Settings → TIMER → REST END NOTIFICATION`. Added to `defaults()`,
  `normalize()`, getter, `setRestAlerts()`.
- Permission requested **once, inside the COMPLETE SET tap** — browsers reject
  prompts not tied to a gesture, and it is the only moment it makes sense.
- `Notify.cancel()` from every manual timer control and on return to the app,
  or the phone buzzes for a countdown already stopped.
- Single `tag: 'rest-done'` so a new rest replaces the old alert.
- **`sw.js` gained a `notificationclick` handler** — focuses an existing window,
  or opens one.

**Expected outcome, stated plainly: Android should work, iOS probably won't.**
iOS has no route to a scheduled local notification from a web page. The user
explicitly accepted a one-platform fix over a fix that fights music on both.

**On forking the codebase:** the user offered to keep separate Android and iOS
copies. Declined in favour of one feature-detected codebase — two folders means
every change made twice and the wrong one uploaded eventually, the same failure
mode as the three-copies problem in `06-PROJECT-CONTEXT.md` §1.

**Files touched** `js/timer.js` (reverted), `js/store.js`, `js/screens.js`,
`js/app.js`, `sw.js`, `docs/07-MAIN-REFERENCE.md` (§6.1, §6.6, §7.8 rewritten),
`CHANGELOG.md`.

**CACHE_VERSION bumped?** **Yes — `repcounter-v6` → `v7` (revert) → `v8`.**

**How it was verified**

- **The critical assertion:** `Timer._ctx` is `false` before *and after*
  `startRest()`. No audio session is opened when a rest begins, so music is
  untouched. This is the regression test for the rejected approach.
- Full residue grep: zero references to `backgroundAlarm`, `startTrack`,
  `_wavAlarm`, `scheduleAlarm` remain anywhere in `js/`.
- Drove the real path — tapped 8 reps, `COMPLETE SET` → set logged, draft
  cleared, timer running `00:05`, **no audio context created**.
- Manual controls exercised (`timer-reset`, `timer-preset`, `timer-toggle`,
  custom duration) — no errors, clock behaves.
- Settings row renders and reads `REST END NOTIFICATION / ON`.
- **Migration:** deleted `restAlerts` from a saved blob, reloaded →
  `normalize()` restored it to `true`, 7 workouts intact, session still active.
- Regression: 8 screens render, zero app console errors, zero nested buttons,
  `e1rm(60,8)=76` / `(60,12)=84` / `(60,1)=60`, rating ramp unchanged.
  ES5 syntax clean.

⚠ **NOT VERIFIED ON A REAL HANDSET, AND CANNOT BE FROM HERE.** The verification
browser reports `Notification.permission === 'denied'`, `showTrigger`
unavailable, and refuses service-worker registration. What was confirmed is
that the paths are correctly wired and **fail safely** when unavailable — not
that a notification is delivered. **This needs one real gym session on the
user's Android phone to confirm.**

---

## 2026-08-19 — Background rest alarm that actually rings (the real fix)

The previous entry's alarm fix was insufficient and the user pushed back — a
rest timer that doesn't ring when the phone is locked is the feature failing,
not an edge case. This replaces the mechanism.

**The insight**

Every previous attempt needed *our code* to run at the moment the countdown hit
zero — either `setInterval` (throttled/suspended when backgrounded) or the
WebAudio clock (dies when the OS suspends the audio context). Both lose on iOS.

**So the alarm now needs no code running at all when it fires.**
`Timer._wavAlarm(ms)` synthesises a WAV in memory — `ms` of true silence
followed by the triple beep — and `startTrack()` hands it to an `<audio>`
element and presses play. From that instant the alarm is the browser's media
pipeline's problem. **Background media playback is the one thing every mobile
OS keeps running when it suspends everything else.**

Three layers now, tried in order: the audio track → WebAudio scheduling →
in-tick beep. `start()` falls through automatically if `play()` is refused.

**New persisted field:** `backgroundAlarm` (boolean, default **true**), with
`Settings → TIMER → ALARM WHEN PHONE IS LOCKED`. Added to `defaults()`,
`normalize()`, a getter and `setBackgroundAlarm()`.

⚠ **`Timer.backgroundAlarm` is a MIRROR of the stored flag, not the source.**
`timer.js` sits below `store.js` in load order and must not reach back for it,
so `app.js` syncs it at boot and inside the toggle action. **Change one without
the other and they drift.**

⚠ **The trade-off, stated plainly:** a page playing audio may pause or duck
whatever else the phone is playing for the length of the rest. That could fight
a gym playlist. The setting exists precisely so the user can choose; off falls
back to a foreground-only alarm.

⚠ **NOT VERIFIED ON A REAL HANDSET.** The mechanism is proven correct in a
Chromium engine (below), but how iOS specifically arbitrates between this track
and background music has not been tested on a device. This needs a real
gym-phone test before it can be called finished.

**Memory:** 8000 Hz / 8-bit / mono = 8 KB per second of countdown; a 90s rest is
~720 KB, built and revoked per set. The sample rate is deliberately low and
documented as such — raising it multiplies memory for a square wave.

**Files touched** `js/timer.js` (track builder + wiring), `js/store.js` (new
field), `js/screens.js` (settings row), `js/app.js` (toggle + boot mirror),
`sw.js`, `docs/07-MAIN-REFERENCE.md` (§6.1, §6.6, §7.8 rewritten),
`CHANGELOG.md`.

**CACHE_VERSION bumped?** **Yes — `repcounter-v5` → `repcounter-v6`.**

**How it was verified**

- **The decisive test — audio survives frozen JS.** Started an 8s rest, then
  blocked the main thread with a busy loop for **2.55s** (harder than
  backgrounding: no timers, no events at all). The audio element's clock
  advanced by **exactly 2.55s**. The beep does not depend on our JavaScript.
- **WAV is structurally valid:** header reads `RIFF`/`WAVE`, 8000 Hz, 8-bit,
  1 channel; byte length exactly matches the computed `44 + ceil(3.8 × 8000)`;
  sample in the silent region is `128` (PCM zero) and in the beep region `48`
  (square wave trough).
- **Plays end to end:** 3s countdown → track `currentTime` 1.02/3.80 mid-run →
  `ended`, `_alarmed` true, timer `finished`, display `00:00`.
- **OFF path:** setting off → no track created, WebAudio schedule used instead.
  ON path → track created, and **no duplicate** WebAudio schedule.
- **Teardown:** `pause()` leaves no playing track and no leaked object URL.
- **Migration:** deleted `backgroundAlarm` from a saved blob to simulate a
  pre-upgrade install, reloaded → `normalize()` restored it to `true`, all 5
  workouts intact.
- Regression: 8 screens render, zero app console errors, zero nested buttons,
  `e1rm(60,8)=76` / `(60,12)=84` / `(60,1)=60`, rating ramp unchanged. ES5 clean.

---

## 2026-08-19 — Two backgrounding bugs: silent/late rest alarm, and losing your place

Both reported from real gym use: leaving the app mid-rest to text or scroll.

### Bug 1 — the rest timer doesn't ring, then rings late on return

**Cause.** The alarm lived entirely inside `Timer.tick()`, which runs off
`setInterval`. A backgrounded browser throttles that hard (Chrome: as little as
once a minute) or suspends it outright (iOS), so `tick()` is simply not called
at the moment the countdown reaches zero. On return the interval resumes,
`tick()` sees `value() <= 0`, and fires the alarm *then* — which is exactly the
"shows 00:00 and rings when I come back" symptom.

**Fix, two parts:**

1. **The beep is now queued in advance on the audio clock.** `startRest()` →
   `start()` → `scheduleAlarm(ms)` builds the three oscillators immediately with
   absolute start times. The browser's audio thread runs independently of our
   JavaScript, so the beep can land **on time with the app backgrounded**.
   Cancelled by `pause()`, `reset()` and `setDuration()`.
2. **Stale alarms are suppressed.** `tick()` now measures how far past zero the
   countdown actually is. Within `STALE_ALARM_MS` (1500ms) it beeps as before;
   beyond it, it marks the timer finished **silently**. Ringing about a rest
   that ended four minutes ago is noise, not information.

⚠ **This is a mitigation, not a complete fix, and the limit is the platform.**
Once the OS suspends the audio context — which iOS does aggressively, and always
on lock — no sound is possible at all from a web page. Nothing short of a native
app or Web Push can wake a suspended page. In that case the timer is now
deliberately silent and the bar reads `REST DONE — NEXT SET` on return.
**Vibration can never be pre-scheduled** (`navigator.vibrate` is immediate-only),
so haptics remain foreground-only.

### Bug 2 — the app reopens on HOME mid-workout

**Cause.** `view` (the router) lived only in memory and in `history.state`. A
backgrounded page is routinely discarded to reclaim memory and re-run from
scratch, and a fresh load has neither — so boot always called `go('home')`.

**Fix.** The current screen is mirrored to a **new second localStorage key,
`repcounter.view`** (`{v: view, t: timestamp}`) on every navigation, and
restored at boot. Three guards, any of which falls back to HOME: older than
`VIEW_TTL` (6 hours), the view is `home`, or the workout/exercise it names no
longer exists.

**New variables a supervisor should know**

| Where | Name | Value | Meaning |
| --- | --- | --- | --- |
| `timer.js` | `STALE_ALARM_MS` | `1500` ms | Grace window for sounding the alarm |
| `timer.js` | `_scheduled`, `_alarmed` | — | Queued oscillators; whether this countdown already sounded |
| `app.js` | `VIEW_KEY` | `'repcounter.view'` | **The app's second storage key** |
| `app.js` | `VIEW_TTL` | 6 hours | Staleness limit for restoring a screen |

⚠ **`repcounter.view` is the first time this app has used more than one
localStorage key.** It is deliberately kept outside Store's blob: it is
throwaway UI position, not user data, and must never be able to corrupt or bloat
the training log. `Store.resetAll()` does not touch it — it does not need to,
because `restoreView()` validates every id against Store before using it.

**Also added:** a `visibilitychange` listener in `app.js` that calls
`Timer.emit()` (never `render()` — the user may be mid-word in a remarks box) so
the clock repaints immediately on return instead of showing a stale time until
the next tick, and nudges the audio context back awake.

**Files touched** `js/timer.js`, `js/app.js`, `sw.js`,
`docs/07-MAIN-REFERENCE.md` (§4.1 storage, §6.6 constants, new §7.8),
`CHANGELOG.md`.

**CACHE_VERSION bumped?** **Yes — `repcounter-v4` → `repcounter-v5`.**

**How it was verified**

Behaviour was simulated directly rather than inspected, by forcing the exact
states a backgrounded phone produces:

- **Stale alarm:** stubbed `Timer.alarm`, started a 60s rest, then set the clock
  45s past zero (as if the app had been away) and ticked → **0 beeps**, and
  `finished === true` so the bar still shows REST DONE.
- **Live alarm:** same stub, countdown tipped just past zero → **exactly 1
  beep**. The grace window works in both directions.
- **Pre-scheduling:** `Timer._scheduled` is populated as soon as `startRest()`
  runs, confirming the audio is queued ahead of time rather than at zero.
- **View restore:** navigated to the exercise screen mid-session, called
  `location.reload()` (what the OS does), and the app **reopened on BENCH PRESS**
  with the session still active and the logged set intact.
- **Guard — deleted target:** stored a view pointing at non-existent ids,
  reloaded → landed on HOME, no error.
- **Guard — stale:** back-dated a saved view to 7 hours old, reloaded → landed
  on HOME.
- Regression after all of it: 8 screens render, zero app console errors, zero
  nested buttons, `e1rm(60,8)=76` / `(60,12)=84` / `(60,1)=60`, timer still
  starts and displays `01:30`. ES5 syntax clean.

---

## 2026-08-19 — "CLEAR SETS" rename; session button rethemed off white

**What changed**

1. **`CLEAR TODAY'S SETS` → `CLEAR SETS`** on the workout screen. Its
   confirmation dialog title was renamed to match (`CLEAR SETS?`); the body text
   still spells out what it does, so nothing became ambiguous.
2. **`START` / `END WORKOUT` no longer use the solid white `.btn-invert`.**
   Requested — the white block read as foreign against the black-and-red theme.
   - `START WORKOUT` → `.btn-accent` (solid red)
   - `END WORKOUT` → **new `.btn-outline`** (transparent fill, 2px accent
     border, accent text)

**New CSS class:** `.btn-outline` in `css/app.css`. Transparent background,
`color: var(--accent)`, `border: 2px solid var(--accent)`. ⚠ The border width is
**hard-coded 2px rather than `var(--bw)`** — on the dark themes `--bw` is `0`
and the outline is the whole point of the button. No colour literals; verified
it resolves correctly in all four themes.

**Why solid vs outlined rather than both solid**

This preserves the surviving half of a documented design rule. Ending a session
freezes it into the data log and **wipes the workout** — it is the most
consequential button in the app, and it occupies the exact screen position that
`START` did a moment earlier. Making both solid red would let you end a session
by muscle memory, and would make `END` look like the solid red `+ ADD EXERCISE`
directly above it. Fill, not hue, now carries that distinction: hollow reads as
*concludes*, solid reads as *begins*.

**Still white:** `COMPLETE SET` and `EXERCISE DONE` on the exercise screen keep
`.btn-invert`. That was outside the request — flagged to the user rather than
changed unilaterally, since `COMPLETE SET` is the most-tapped button in the app.

**Files touched** `js/screens.js` (label + classes), `js/app.js` (dialog title),
`css/app.css` (`.btn-outline`), `sw.js`, `docs/07-MAIN-REFERENCE.md` (§6.8
colour roles, §6.6 constants), `CHANGELOG.md`.

**CACHE_VERSION bumped?** **Yes — `repcounter-v3` → `repcounter-v4`.**

**How it was verified**

Hard-reloaded past the HTTP cache, seeded a two-exercise session, and inspected
the live DOM:

- `CLEAR SETS` button label reads back as `"CLEAR SETS"`.
- `END WORKOUT`: class `btn btn-outline`, computed `color` and `border-color`
  both `oklch(0.58 0.24 27)`, `background rgba(0,0,0,0)`, border `2px`.
- `START WORKOUT`: class `btn btn-accent`, computed background
  `oklch(0.58 0.24 27)`, text white.
- **All four themes checked on the live END button:** `t3a`/`t3b` accent red,
  `t7a` white (`oklch(0.97 0 0)`), `t7b` black (`rgb(10,10,10)`) — border stays
  2px in every one.
- `grep` for colour literals in `app.css` still returns only the documented
  `var(--bg, #0a0a0a)` boot fallback.
- Screenshotted both states at 375×812: solid red START, outlined red END.

---

## 2026-08-19 — Rating numerals: all tiles use the same ink text

**What changed**

Every rating tile now draws its numeral in ink (`#0a0a0a`). Previously ranks 1
and 10 — the two darkest tiles — rendered in white, which made the strip read as
three visual groups instead of one scale. Tile background colours are
**unchanged**.

Removed the `luminance()` and `textOn()` helpers added earlier today; `fg` is now
simply `INK` for all ten.

**New behaviour a supervisor should know — this one has a real trade-off**

**Ranks 1 and 10 now fall below WCAG AA.** Measured contrast of ink on each tile:

| Rank | Tile | Contrast |
| --- | --- | --- |
| 1 | `#e22226` | **4.22** ← below 4.5 |
| 2–8 | | 5.2 – 13.3 |
| 9 | `#1f9a4a` | 5.45 |
| 10 | `#1d7d3e` | **3.82** ← below 4.5 |

The numerals are 17px at weight 900. WCAG's relaxed 3.0 bar for "large text"
starts at 18.66px bold, so 17px just misses it and the applicable bar is 4.5.
They remain legible in practice — heavy condensed digits on a saturated field —
but this is an **accepted shortfall, chosen for visual consistency**, not an
oversight. The user was shown both options and picked uniformity.

**The safety net is gone.** With the per-tile picker removed, darkening any tile
no longer auto-flips its text to white — it just gets harder to read. Recorded
in the code and in `07` §7.6: to clear 4.5 with ink, rank 1 needs `L ≥ 0.605`
(`#e92d2d`) and rank 10 needs `L ≥ 0.565` (`#298b49`).

**New coupling to document:** the decision depends on
`.rate-num { font-size: 17px }` in `css/app.css`. If that shrinks, ranks 1 and
10 get worse; if it grows past 18.66px, everything passes comfortably. Noted in
both files.

**Files touched** `js/themes.js`, `docs/07-MAIN-REFERENCE.md` (§7.6),
`CHANGELOG.md`.

**CACHE_VERSION bumped?** **No — still `repcounter-v3`.** Set earlier today and
not yet deployed; live still serves `repcounter-v2`. ⚠ If v3 has already been
uploaded, bump to v4 before uploading this.

**How it was verified**

- `RATINGS.every(fg === '#0a0a0a')` → true; all ten backgrounds unchanged.
- Read back the **computed** colour of all ten rendered tiles in the live sheet:
  `rgb(10,10,10)` on every one.
- Confirmed `.rate-num` computes to `17px`, which is what puts this under the
  4.5 bar rather than 3.0.
- Screenshotted the live rating sheet at 375×812 — strip reads as one object.
- `endSession(wid, 1)` → stores `rating: 1`.
- Regression: 8 screens render, zero app console errors, zero nested buttons,
  `e1rm(60,8)=76` / `(60,12)=84` / `(60,1)=60`. ES5 syntax clean, no dead code
  left behind.

---

## 2026-08-19 — Rating ramp: greens now deepen, 10 is dark green

**What changed**

Third and final tuning pass on the ramp today. The greens now *deepen* as the
score improves rather than staying at one brightness.

| Rank | Before | After | |
| --- | --- | --- | --- |
| 8 | `#98da3c` | **`#21b956`** | now exactly what rank 10 was before |
| 9 | `#66ca4b` | **`#1f9a4a`** | the midpoint of 8 and 10 |
| 10 | `#21b956` | **`#1d7d3e`** | dark green |

Pins moved: rank 8 `L 0.815 C 0.195 H 130` → `L 0.690 C 0.185 H 149`; rank 10
`L 0.690 C 0.185 H 149` → `L 0.520 C 0.130 H 150`. Ranks 1–7 unchanged and
byte-identical. Rank 9 needs no pin — it is the exact interpolated midpoint.

**New behaviour a supervisor should know**

1. **Rank 10 now takes WHITE text; 8 and 9 take ink.** Nothing was hard-coded
   to make that happen — the per-tile contrast picker added earlier today
   handles it automatically. This is the first time that mechanism has actually
   been load-bearing, and it is why a dark tile could be introduced at all
   without anyone hand-maintaining a text-colour table.
2. **Chroma has to drop as the greens darken — this is a gamut limit, not a
   style choice.** sRGB holds less saturated green the darker you go: near
   H 149 the chroma ceiling is ~`0.190` at `L 0.690` but only ~`0.135` at
   `L 0.520`. Exceeding it silently clamps the red channel to 0, flattening the
   colour and shifting its hue. Candidates at `C 0.15`–`0.17` were measured and
   rejected for exactly this. **If rank 10 ever needs to look deeper, lower the
   lightness — do not raise the chroma.**
3. Hue now jumps +49 across 7→8 and is then effectively flat (+1 across 8→10).
   The scale reads yellow → green in one step, then green getting darker.

**No data-shape change.** `rating` is still an integer 1–10 or `null`. Existing
sessions keep their scores.

**Files touched** `js/themes.js` (pins + comments),
`docs/07-MAIN-REFERENCE.md` (§7.6), `CHANGELOG.md`.

**CACHE_VERSION bumped?** **No — still `repcounter-v3`, deliberately.** v3 was
set earlier today and **has not been deployed**; the live site still serves
`repcounter-v2`, so v3 already invalidates it. ⚠ If v3 has already been
uploaded, bump to v4 before uploading this.

**How it was verified**

Hard-reloaded past the HTTP cache, then driven through the real end-of-workout
flow:

- Ramp emitted: `#e22226 #ec4800 #f26600 #f58200 #f89d00 #f6b900 #f0d400
  #21b956 #1f9a4a #1d7d3e`. Rank 8 confirmed byte-identical to the previous
  rank 10 (`#21b956`), as requested.
- **Contrast on all ten: 4.68 / 5.18 / 6.29 / 7.61 / 9.25 / 11.18 / 13.31 /
  7.67 / 5.45 / 5.18.** Minimum 4.68 — all clear WCAG AA (4.5).
- Text-colour pattern `W K K K K K K K K W` — white only at ranks 1 and 10,
  chosen by measurement, not by rule.
- Green pins confirmed in gamut before committing; `C 0.15`/`0.16`/`0.17` at
  `L 0.52` all clipped and were discarded.
- Screenshotted the live rating sheet at 375×812: red → yellow → green,
  deepening to a dark green at 10 with legible white text.
- Tapping 10 tints the label `rgb(29,125,62)`; `endSession(wid, 10)` stores
  `rating: 10`.
- Regression: 8 screens render, zero app console errors, zero nested buttons,
  `e1rm(60,8)=76` / `(60,12)=84` / `(60,1)=60`. ES5 syntax clean.

---

## 2026-08-19 — Rating ramp: greener 8–9, deeper 10

**What changed**

Follow-up tuning to the ramp landed earlier today. Ranks 8 and 9 were still
reading as yellow-olive rather than green, and 10 sat a touch light for the
bottom of a gradient.

| Rank | Before | After | |
| --- | --- | --- | --- |
| 8 | `#c0d200` | **`#98da3c`** | yellow-olive → green-leaning lime |
| 9 | `#85d030` | **`#66ca4b`** | lime → proper green |
| 10 | `#1fca57` | **`#21b956`** | slightly deeper, so the ramp lands rather than stops |

Implemented by adding a **fifth pin at rank 8** (`L 0.815 C 0.195 H 130`) and
darkening the rank-10 pin (`L 0.735 → 0.690`, `C 0.205 → 0.185`, `H 148 → 149`).
Ranks 1–7 are byte-identical to before.

**Why a pin rather than moving the endpoint:** hue now advances +12–13 per step
to rank 7, jumps +30 across 7→8, then +10 per step. That single decisive step
is what performs the yellow→green handover; without it the same endpoints just
smear three olive tiles across 8, 9 and 10.

**New behaviour a supervisor should know**

Nothing functional — colours only. Two things recorded in the code and `07`
§7.6 that matter if anyone tunes this again:

1. **Chroma at rank 10 is capped by the sRGB gamut, not by taste.** At
   `L 0.690 / H 149` anything above ~`0.190` falls outside sRGB, and the
   conversion clamps the red channel to 0 — silently flattening the colour and
   shifting its hue. `0.185` is deliberately just inside. **Raising it produces
   a duller green, not a louder one.**
2. The `PINS` array now has five entries. `stop()` was already written to
   interpolate across an arbitrary pin list, so this was a data-only edit —
   no logic change.

**Files touched** `js/themes.js` (pins + comments),
`docs/07-MAIN-REFERENCE.md` (§7.6), `CHANGELOG.md`.

**CACHE_VERSION bumped?** **No — deliberately.** It was already moved to
`repcounter-v3` earlier today and **has not been deployed yet**; the live site
still serves `repcounter-v2`, so v3 already invalidates it. ⚠ If `v3` has
already been uploaded to GitHub, bump to `v4` before uploading this.

**How it was verified**

Hard-reloaded past the HTTP cache, then driven through the real end-of-workout
flow:

- Ramp emitted: `#e22226 #ec4800 #f26600 #f58200 #f89d00 #f6b900 #f0d400
  #98da3c #66ca4b #21b956`.
- **Minimum contrast across all ten tiles: 4.68** (rank 1) — still clears WCAG
  AA (4.5). Peak 12.72 at rank 7.
- Green pins confirmed **in gamut** (no channel clamped) before committing the
  values; candidates at `C 0.200`/`0.207` were rejected for clipping.
- Screenshotted the live rating sheet at 375×812: strip reads red → orange →
  yellow → green with 8, 9, 10 clearly green.
- Tapping 10 selects it and tints the label `rgb(33,185,86)`.
- `endSession(wid, 8)` → session stores `rating: 8`.
- Regression: 8 screens render, zero app console errors, zero nested buttons,
  `e1rm(60,8)=76` / `(60,12)=84` / `(60,1)=60`. ES5 syntax clean.

---

## 2026-08-19 — Rating colours: maroon→gold replaced with red→green

**What changed**

The 1–10 workout rating ramp in `js/themes.js` now runs **bright red → orange →
yellow → lush green** instead of the previous deep-maroon → gold. Requested so
the tile reads as a verdict at a glance: a bad session is red, a great one is
green.

- Re-pinned the oklch ramp at **four** points instead of three. Three pins
  across a red→green hue sweep interpolate through muddy olive in the middle;
  the fourth pin holds a clean yellow at rank 7.

  | Pin | oklch (L C H) | Result |
  | --- | --- | --- |
  | 1 | `0.585 0.222 27` | `#e22226` bright red |
  | 4 | `0.720 0.190 62` | `#f58200` orange |
  | 7 | `0.865 0.185 100` | `#f0d400` yellow |
  | 10 | `0.735 0.205 148` | `#1fca57` lush green |

- Generalised `stop()` to interpolate across an arbitrary `PINS` array, so
  adding or moving a pin is now a one-line data edit rather than a rewrite.
- Split the old `toHex()` into `srgb()` + `toHex()` + `luminance()`, so the tile
  colour and its text colour come from one conversion.

**Why the behaviour changed in two places a supervisor should know about**

1. **Lightness no longer climbs monotonically.** The old ramp guaranteed "no
   tile is darker than the one before", and that rule is stated in
   `docs/01-PRODUCT-SPEC.md` §7 and the old `themes.js` comment. It cannot
   survive a red→green scale: yellow is the lightest hue on the path, so
   forcing 8–10 lighter still would yield pale mint, not the vivid green the
   top of the scale is meant to feel like. Lightness now rises
   `0.585 → 0.865` (peak at 7) and eases back to `0.735`. Chroma stays ≥
   `0.185` so nothing looks washed out. **This is a deliberate departure from a
   previously documented invariant**, recorded in `07` §7.6.
2. **Text colour is computed, not hard-coded to a rank.** The old ramp used
   "white below 5, black from 5 up". With a wider hue sweep that crossover no
   longer lands on a tidy rank, so each tile now picks whichever of white /
   `#0a0a0a` has the better WCAG contrast against it. Move a pin and the text
   colour follows instead of silently going unreadable.

**No data-shape change.** `rating` is still an integer 1–10 or `null`, clamped
identically, stored identically. Existing sessions keep their ratings and simply
render in the new colours. No `normalize()` change was needed.

**Files touched** `js/themes.js` (ramp), `sw.js` (cache version),
`docs/07-MAIN-REFERENCE.md` (§1 line counts, §5 file entry, §6.6 constants,
§7.6 rewritten), `CHANGELOG.md`.

**CACHE_VERSION bumped?** **Yes — `repcounter-v2` → `repcounter-v3`.** An app
file changed, so without this every installed phone would keep serving the old
maroon ramp forever.

**How it was verified**

Served locally, hard-reloaded past the HTTP cache, then driven through the real
end-of-workout flow (`END WORKOUT` → the rating sheet) rather than by inspection:

- Full ramp emitted: `#e22226 #ec4800 #f26600 #f58200 #f89d00 #f6b900 #f0d400
  #c0d200 #85d030 #1fca57` — all valid 6-digit hex, no `oklch()` leaked into any
  inline style.
- **Contrast measured on every tile: 4.68 (rank 1) → 13.31 (rank 7).** All ten
  clear WCAG AA (4.5), and the computed picker chose the better of white/ink on
  all ten.
- Screenshotted the live rating sheet at mobile viewport: strip reads red →
  orange → yellow → green; tapping 10 selects it and tints the `10 / 10` label
  green (`rgb(31,202,87)`).
- Rating round-trips: `endSession(wid, 9)` → session stores `rating: 9`.
- Regression: all 8 screens render, zero app console errors, zero nested
  buttons, `e1rm(60,8)=76`, `(60,12)=84`, `(60,1)=60`,
  `e1rmAxis([26,31]).ticks=[25,30,35]`, all 4 themes intact.
- ES5 syntax check clean (no arrow functions, `let`/`const`, template literals).

*(Unchanged caveat: service-worker registration can't be exercised in the
verification browser — see `07` §10.5. The `CACHE_VERSION` bump is therefore
correct-by-construction, not observed.)*

---

## 2026-08-19 — Folder renamed; paths in `07` corrected

**What changed** The app folder was renamed and flattened outside this session:
`rep-counter 2nd/rep-counter app 2/` → **`rep-counter 2/`** (app files moved up
one level; `Rep-counter 2nd - purpose.rtf` now sits alongside them). Updated the
three hard-coded paths in `docs/07-MAIN-REFERENCE.md` (the header, the §2 `cd`
command, and the §8 git note) and added a folder-note recording the old name.

**Why** The run instructions in §2 were a paste-ready `cd` that would now fail.

**New variables/behaviour** None. No code touched.

**Files touched** `docs/07-MAIN-REFERENCE.md`, `CHANGELOG.md`.

**CACHE_VERSION bumped?** No — no app file changed.

**How it was verified** `grep -rn "rep-counter 2nd"` across all docs returns only
`docs/06-PROJECT-CONTEXT.md:22`, which is inside the folder-map the user asked to
leave as-is. The new `cd` path was confirmed to exist.

**Still outstanding:** `docs/06-PROJECT-CONTEXT.md` §1 still names
`rep-counter/` as canonical and describes this folder under its old name. The
user has explicitly declined changing it. Anyone reading `06` §1 cold will be
pointed at the wrong folder — `CLAUDE.md` and `07` are the corrective.

---

## 2026-08-19 — Documentation repair, inline comments, and a standing doc protocol

**What changed**

- Added `docs/07-MAIN-REFERENCE.md` — the new authoritative document. Overview,
  architecture, data flow, a full variable/config reference, a file-by-file
  breakdown, verified run instructions, real git history, a corrections list,
  and known issues.
- Added this `CHANGELOG.md` and `CLAUDE.md` (the documentation protocol every
  future session must follow).
- Added inline comments to code that lacked them, and corrected one comment that
  contradicted the code:
  - `js/store.js` — documented the `KEY` vs `version` distinction, the
    `DEFAULT_REST` unit, the shallow-merge boot path and its `Object.assign`
    browser-floor caveat, the planned-set floor (`max(1, log.length)`), the
    silent set-count auto-grow in `logSet`, the `reps === 1` special case in
    `e1rm`, and the fact that `e1rmAxis().ticks` excludes the `0` label.
  - `js/ui.js` — **corrected a stale comment** claiming `UI.exercise` includes a
    drop-sets control (it does not; the per-exercise toggle was removed long
    ago). Documented `wireStepper`'s parameters and the `.field`-wrapper
    requirement that supplies the ≥16px font size.
  - `js/themes.js` — flagged that the theme swatch literals are raw `oklch()`
    strings written into inline styles, with the hex values to use if it ever
    needs fixing.
  - `js/app.js` — documented every module-level variable (`view`, `edit`,
    `timerBack`, `RING`, the debounce handles), marked `workout-rest` as dead
    code and explained why it still exists, explained the non-obvious
    `pick-rating` coupling (handled by a sheet-local capture listener, not the
    `actions` map, because sheets live outside `#app`), and annotated the boot
    sequence including why the first `go()` uses `replace`.
  - `css/app.css` — added a file header covering the no-colour-literals rule,
    the layout contract, the class-naming and `is-` state convention, the
    browser-support declaration pairs that must not be "tidied", and the two
    non-negotiables (≥16px inputs, `-webkit-font-smoothing`).

**Why**

The previous documentation pack was written as a previous session's context
window ran out. It was largely accurate but had never been checked against the
code. Eleven specific claims were wrong or misleading; they are listed in
`docs/07-MAIN-REFERENCE.md` §9 with the corrected values.

**New variables/behaviour a supervisor should know**

None. **No application behaviour changed in this entry** — comments and
documentation only. The state shape, the storage key, every default and every
action are untouched.

**Files touched**

`docs/07-MAIN-REFERENCE.md` (new), `CHANGELOG.md` (new), `CLAUDE.md` (new),
`js/store.js`, `js/ui.js`, `js/themes.js`, `js/app.js`, `css/app.css`.

**CACHE_VERSION bumped?** No — deliberately. `CACHE_VERSION` stays
`repcounter-v2` because nothing that affects behaviour changed, and bumping it
would force every installed phone to re-download the shell for comment-only
edits. **Bump it on the next behavioural change.**

**How it was verified**

Served with `python3 -m http.server` and driven from the browser console after a
hard cache-busting reload:

- All 7 globals present; all 8 screens render; **zero JavaScript console
  errors**; zero nested `<button>` elements in the live DOM.
- `e1rm(60,8)=76`, `e1rm(60,12)=84`, `e1rm(60,1)=60`, `e1rm(60,13)≈86.8`.
- `e1rmAxis([26,31]).ticks=[25,30,35]`, `([44,48])=[40,45,50]`,
  `([40,38]).base=35`.
- Full lifecycle: create → log a 3-segment drop set → verify it stays **one** set
  with 18 total reps → trailing 0-rep segment discarded → start → end with
  rating 7 → session frozen with 2 entries and a numeric duration → workout logs
  wiped. Weight precision held at 62.5 kg throughout.
- `endSession` with no recorded start → `durationMs: null` → renders `—`.
- `formatDuration`: `47m`, `1h 12m`, `—`.
- CSS applied (`-webkit-font-smoothing: antialiased`, `--accent` resolving).

**Not verified:** offline / service-worker caching. The verification browser
refuses service-worker registration (`An unknown error occurred when fetching
the script`) even though `sw.js` serves as HTTP 200 with the correct MIME type.
The app degrades gracefully as designed. See `docs/07-MAIN-REFERENCE.md` §10.5.

**Known issues newly identified** (documented, **not fixed** — this was a
documentation task): the ES5 claim vs. three ES2015 runtime APIs including one
on the boot path; the dead `workout-rest` action; theme swatches emitting raw
`oklch()` into inline styles; and one sheet input measuring 13.33px, below the
16px iOS zoom threshold. Full detail in §10.

---

## 2026-08-19 — `docs/06-PROJECT-CONTEXT.md` added *(commit `4960ba1`)*

Session handover notes: which on-disk copy is canonical, how the site is
actually deployed, the list of features built-then-removed, and known gaps.
Docs only; no behaviour change.

## 2026-08-05 — Documentation pack + file-header comments *(commit `f289287`)*

Added `docs/00`–`05` and expanded the header comments on all six JS modules
(+327 comment lines across `app.js`, `screens.js`, `store.js`, `themes.js`,
`timer.js`, `ui.js`). No behaviour change.

## 2026-08-02 — Initial commit *(commit `875d182`)*

The entire application in one commit: 18 files, 4,174 lines. Everything before
this date — roughly thirty rounds of iteration, including every feature that was
built and then removed — happened before version control and left no trace in
git. `docs/06-PROJECT-CONTEXT.md` §3 is the only record of it.
