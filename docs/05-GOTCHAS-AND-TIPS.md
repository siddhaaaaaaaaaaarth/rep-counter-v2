# 05 — Gotchas and Tips

Every bug that cost real time building this, why it happened, and how to avoid
it. Then practical technique for working on the codebase.

If you read only one document before editing, make it this one — several of
these are invisible until they bite.

---

# Part 1 — Traps that actually happened

## 1.1 Nested `<button>` silently breaks layout ⚠ WORST ONE

**What happened:** the chart card was a `<button>` (tap to expand). Adding
`1M/3M/6M/ALL` range `<button>`s inside it made the chart fall *outside* the
card — the card measured 66px tall while the chart rendered below it with a
huge gap.

**Why:** HTML forbids a `<button>` inside a `<button>`. The parser doesn't
error — it **silently auto-closes the outer button** at the first inner one.
Everything after that becomes a sibling. Your DOM no longer matches your source.

**Fix:** make the container a `<div role="button" tabindex="0">` with the
`data-act`. Delegation works on any element, not just buttons.

**Symptom to watch for:** an element appears outside its parent, or a container
is far shorter than its contents. Check for nested interactive elements first.

The same class of bug applies to `<a>` inside `<a>`, and `<form>` inside
`<form>`. Elsewhere in this codebase the delete ✕ inside a card uses `<span
data-act="…">` for exactly this reason.

## 1.2 oklch in custom properties has no natural fallback

**What happened:** the entire palette is oklch. On Chrome <111 the app would
render completely unpainted.

**Why:** the classic two-declaration fallback —
```css
--surface: #161616;
--surface: oklch(0.20 0 0);   /* older browsers "ignore" this */
```
— **does not work for custom properties.** CSS parses custom property values
permissively: the unsupported oklch value is stored fine, and only fails later
when `var()` substitutes it, making the *using* property invalid at
computed-value time. The result is no colour at all.

**Fix:** `@supports not (color: oklch(0 0 0))` block redefining the tokens in
hex. See `03-DESIGN-SYSTEM.md` §6.

**Tip:** get exact fallback values by painting to a canvas rather than
converting by hand — browsers gamut-map out-of-range colours in ways naive
maths doesn't reproduce:
```js
var c = document.createElement('canvas').getContext('2d');
c.fillStyle = 'oklch(0.58 0.24 27)';
c.fillRect(0,0,1,1);
[...c.getImageData(0,0,1,1).data];   // exact sRGB bytes
```

## 1.3 Re-render on every tick destroys typing

**What happened:** the remarks textarea lost focus and cursor position mid-word
whenever the rest timer ticked.

**Why:** the timer fired `render()`, which replaced `innerHTML`, which destroyed
and recreated the textarea.

**Fix:** timer updates patch individual nodes (`[data-timer-display]`, the
button label, the ring) instead of re-rendering. Same for the rep counter.

**Rule:** anything that fires on a timer or while typing must not call
`render()`.

## 1.4 Idle-state sync fighting user input

**What happened:** after toggling the rest timer on, the `30/60/90/120` preset
buttons appeared dead — tapping them did nothing.

**Why:** a `syncIdleTimer()` helper reset the clock to the stored rest value.
It was being called from `render()`, so every re-render — including the one
caused by tapping a preset — immediately snapped the duration back.

**Fix:** call it once per *navigation* (from `go()`), never from `render()`.

**Generalisation:** "sync state on render" is a trap. Render should be a pure
function of state, not a place that also changes state.

## 1.5 Browser caching during development

**What happened:** repeated confusion where an edit "didn't work" — the class
was still the old one in the DOM despite the source being correct.

**Why:** `python3 -m http.server` sends no `Cache-Control`. The browser applies
heuristic caching and serves stale JS.

**Fix during development:**
```js
Promise.all(['index.html','css/app.css','js/app.js','js/screens.js','js/store.js']
  .map(function(p){ return fetch(p, {cache:'reload'}); }))
  .then(function(){ location.reload(); });
```

**And once a service worker exists, that's a second cache layer.** Full reset:
```js
(async function(){
  var rs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(rs.map(function(r){ return r.unregister(); }));
  var ks = await caches.keys();
  await Promise.all(ks.map(function(k){ return caches.delete(k); }));
  location.reload();
})();
```

**Before concluding "my change didn't work", verify the browser has your
change.** Check a known-changed class or string in the DOM.

## 1.6 Safari's `dominant-baseline`

SVG text centred with `dominant-baseline="middle"` misaligns on Safari
(long-standing bugs). Use `dy="0.32em"` with the default baseline — pixel-
identical on Chrome and correct on Safari.

## 1.7 iOS zooms on input focus

Any `<input>`/`<textarea>` under 16px makes iOS Safari zoom the page on focus.
The naive fix is `maximum-scale=1` in the viewport meta — **don't**: it also
disables pinch-zoom (accessibility regression) and Android ignores it.
Set the font-size to ≥16px instead.

## 1.8 `--surface` darker than `--bg`

Dark-theme cards were *receding* rather than lifting: `--surface` resolved to
`#070707` against a `--bg` of `#0a0a0a`. Roughly 1% separation, in the wrong
direction.

**Tip:** don't trust your eye on near-black values. Measure:
```js
getComputedStyle(document.documentElement).getPropertyValue('--surface');
```
and convert via the canvas trick above.

## 1.9 Rounding weights to integers

A generic integer clamp turned 32.5kg into 33kg. Gym plates are 2.5kg — this is
a real data-corruption bug, not a cosmetic one. Weights get their own
`clampKg()` that preserves 2 decimals.

## 1.10 Font weight vs font rendering

A reported "the font looks different" was **not** the font — families and the
Google Fonts URL were byte-identical to the mockups. The mockups render inside
a device frame with `-webkit-font-smoothing: antialiased`; without it, macOS
subpixel antialiasing makes the same font look heavier.

**Lesson:** when something looks wrong, verify the obvious hypothesis before
acting on it. `document.fonts.check('900 34px "Bebas Neue"')` would have
confirmed the font was loading in seconds.

## 1.11 Service worker staleness

Any app change without a `CACHE_VERSION` bump means installed devices keep
serving the old build indefinitely. The change appears to do nothing, and the
device never recovers on its own.

---

# Part 2 — Working on this codebase

## 2.1 Drive the app from the console

Every module is a global, so you can exercise the whole app without clicking:

```js
RepCounter.go('workout', {wid: Store.workouts[0].id});   // navigate anywhere
RepCounter.view();                                        // current view state
Store.workouts[0].exercises[0].log;                       // inspect data
document.querySelector('[data-act="complete-set"]').click();  // fire an action
```

Because actions run through one delegated listener, `.click()` on an element
exercises the *real* code path — not a mock.

## 2.2 Seed realistic data quickly

Verifying the data log needs history. Rather than tapping through sessions:

```js
var w = Store.workouts[0], e = w.exercises[0];
for (var i = 0; i < 8; i++) {
  e.log = [{weight: 60 + i * 2.5, reps: 8, drops: []}];
  Store.startSession(w.id);
  var s = Store.endSession(w.id, 7);
  var d = new Date('2026-06-01'); d.setDate(d.getDate() + i * 7);
  s.date = d.toISOString();               // back-date it
}
localStorage.setItem('repcounter.v1', JSON.stringify(Store.state));
```

Back-dating after `endSession` is the trick — sessions are stamped with the
current time, so overwrite `.date` afterwards.

## 2.3 Test offline properly

Don't trust devtools' "offline" checkbox alone. **Stop the server** and reload —
that's the real condition an installed PWA faces.

## 2.4 Verify, don't assume

The highest-value habit on this project. Cheap checks that repeatedly caught
real bugs:

```js
// is the DOM actually what I think?
document.querySelector('[data-act="new-exercise"]').className;

// is the maths right?
Store.e1rm(60, 12);                       // 84 (Epley) — not 84.9 (Wathan)
Store.e1rmAxis([{e1rm:40},{e1rm:38}]).ticks;   // [35,40] — base drops

// is the element where I think it is?
var card = document.querySelector('.ptable');
card.contains(document.querySelector('svg.cg'));   // caught the nested-button bug
```

## 2.5 Reading the code efficiently

- **A behaviour question** → find the `data-act` name in `screens.js`, then that
  handler in `app.js`.
- **A data question** → `store.js` only. Nothing else touches state.
- **A visual question** → the class name in `app.css`, then the token in
  `theme.css`.

## 2.6 Adding a screen — the checklist

1. Write `screens.myScreen()` returning a string.
2. Add a `case` in `render()` in `app.js`.
3. Add a nav action calling `go('myscreen', {...})`.
4. Use existing classes (`.screen`, `.hd`, `.scroll`, `.cta`, `.card`) before
   writing new CSS.

## 2.7 Adding a persisted field — the checklist

1. Add it to `defaults()`.
2. **Add it to `normalize()`** so existing saves don't break.
3. Add a `Store` setter that calls `save()`.
4. Bump `CACHE_VERSION` in `sw.js`.

## 2.8 Things that look like bugs but aren't

| Looks wrong | Actually |
| --- | --- |
| Bebas Neue at `font-weight: 900` | Font only ships 400; faux-bold is intentional and matches the mockups |
| e1RM jumps 84.0 → 86.8 between 12 and 13 reps | Inherent to switching Epley→Wathan |
| Mono themes show no red anywhere | `--accent` equals `--text` by design |
| The rating strip's colours aren't oklch in the DOM | Converted to hex in JS on purpose — inline styles can't use `@supports` |
| Home screen shows nothing when empty | Explicitly requested; no empty-state message |

## 2.9 If you hand this to an AI agent

Give it `00-START-HERE.md` and `05-GOTCHAS-AND-TIPS.md` first. Then:

- Tell it the codebase is **ES5-only** — models default to modern syntax.
- Tell it **state lives only in `store.js`** and **screens are pure** — the
  common failure is scattering `localStorage` calls and DOM mutation through
  screen functions.
- Ask it to **verify in the browser** rather than assert. The console-driving
  technique in §2.1 works well for this.
- Remind it to **bump `CACHE_VERSION`**.
