# 06 — Project Context & Session Handover

Everything a new session needs that **cannot be recovered by reading the code**:
where things live, what's deployed, which ideas were already tried and rejected,
and how the person you're working for likes to work.

Read this **second**, right after `00-START-HERE.md`.

---

## 1. Where things live ⚠ READ THIS FIRST

There are **three copies of this app on disk**. They were identical at the time
of writing, but they will drift, and editing the wrong one means your changes
never reach the live site.

```
~/Documents/Claude code/
├── rep-counter/                    ← ★ CANONICAL. Edit this one.
│   ├── (the app)                     Has the git repo + the docs/ folder.
│   └── docs/
├── rep-counter 2nd/                ← A handover bundle the user assembled.
│   └── rep-counter app and…/         Snapshot for starting fresh sessions.
├── rep copunter designs/
│   ├── Designs/                    ← The ORIGINAL Claude Design mockup files.
│   ├── app/                          Another app copy.
│   └── rep-counter.zip
└── rep-counter-full.zip            ← Packaged app + docs.
```

**Rule: `rep-counter/` is the source of truth.** It's the one wired to git and
the one containing `docs/`. If you're asked to change the app, change it there.

**If the user opens a session in a different folder**, say so before editing —
don't silently edit a copy that will be overwritten later.

`rep copunter designs/Designs/` holds the original mockups
(`Exercise Flow - Theme Variants.dc.html`, `Exercise Progress Tables.dc.html`,
`3A Home.dc.html`, `ios-frame.jsx`, `support.js`). They came from a Claude
Design project (id `530fcf44-8082-46b4-8e5a-8768ec821638`). `support.js` is the
design-canvas React runtime — **it is not part of the app** and must not be
copied into it.

---

## 2. Hosting — the current deployment ⚠ non-obvious state

**Live URL:** https://siddhaaaaaaaaaaarth.github.io/rep-counter-2/
**Repo:** https://github.com/siddhaaaaaaaaaaarth/rep-counter-2 (public)
**GitHub username:** `siddhaaaaaaaaaaarth` — note the *eleven* a's. Miscounting
this wasted time once; copy-paste it, never retype it.

### How it was actually deployed

**Via GitHub's web drag-and-drop uploader, not `git push`.** This matters:

- The local repo in `rep-counter/` has 2 commits and a configured remote, but
  **has never successfully pushed**. Auth was never completed (no Personal
  Access Token was created, and the `gh` CLI is not installed).
- GitHub has its own commit history created by the web uploads.
- **These two histories are unrelated.** A plain `git push` will be rejected as
  a non-fast-forward. Don't blindly `--force` — check with the user first.

### What is live vs. local, right now

| | Live site | Local `rep-counter/` |
| --- | --- | --- |
| App code | ✅ working | ✅ same behaviour |
| `docs/` folder | ❌ **not uploaded** (404) | ✅ present |
| JS header comments | ❌ older version | ✅ expanded |
| `CACHE_VERSION` | `repcounter-v2` | `repcounter-v2` |

The live app *behaves* identically — the outstanding changes are comments and
documentation only. But if you change app behaviour, the site needs re-uploading
or the user's phone keeps the old build.

### Deploying a change

Simplest path, matching how it's been done: open the repo on github.com →
**Add file → Upload files** → drag the changed files in → Commit.

⚠ **Bump `CACHE_VERSION` in `sw.js` in the same change**, or every installed
phone keeps serving the cached old build indefinitely and will never recover on
its own.

---

## 3. Decisions already made and REVERSED ⚠ do not re-add these

Each of these was built, then explicitly removed at the user's request. A new
session reading only the code might see a "gap" and helpfully restore one. Don't.

| Removed | Why | Replaced by |
| --- | --- | --- |
| Seven-tier emoji rating (🤬😿😕👍😊🤩 + Hulk) | Wanted a plain numeric scale | 1–10 numeric ramp |
| Hulk emoji / drawn SVG / `img/hulk.png` loader | Went with the numeric scale | — (fully deleted) |
| First-run theme picker screen | "Don't make me pick a theme" | Defaults to `t3a`; theme lives in Settings |
| `TABLE / E1RM GRAPH` tab selector | Wanted all views at once | All three views stacked on one page |
| Per-exercise drop-sets toggle | Too much clutter | One global switch in Settings |
| `REST TIMER: OFF` bar on the workout screen | Wanted it off that screen | Big ON/OFF panel on the timer screen |
| `EDIT` chip beside the rest-timer chip | Redundant | Home → EDIT → tap a workout |
| Rating section permanently on the workout screen | Should only be asked once | Asked only at session end |
| Home empty-state message ("Nothing here yet…") | "Don't say anything on the homepage" | Nothing at all when empty |
| Three seeded sample workouts (Push/Pull/Leg Day) | Wanted a clean install | Starts completely empty |
| `Bash(…)` Google Fonts CDN link | Needed offline support | Self-hosted `fonts/*.woff2` |

**The pattern:** this user consistently prefers **less UI**. When in doubt,
remove rather than add, and never add explanatory text to a screen unasked.

---

## 4. How this user works — worth knowing

Observed over ~30 rounds of iteration. Not rules imposed by them, just what
actually lands well:

- **Terse beats thorough.** Long explanations get pushback. Answer, then stop.
- **Show, don't tell.** Screenshots of the actual rendered change land far
  better than descriptions of it.
- **They'll say when something's wrong, bluntly and briefly** ("this isn't
  working", "where is this"). Take it at face value; don't over-apologise.
- **They notice small visual details** — font weight, spacing, colour drift. A
  reported "looks a bit different" is usually real and worth measuring rather
  than dismissing.
- **They are not a developer.** Terminal steps need exact, paste-ready commands
  and an explanation of where to run them. "Open Settings → Pages" needs to say
  *which* settings and *where* the sidebar item is.
- **Verify before claiming.** Several times a "fix" appeared not to work purely
  because of browser caching. Confirm the browser actually has your change
  before concluding anything.

---

## 5. Development environment

- `git` is installed. **`gh` (GitHub CLI) is not.** No auth token configured.
- Node.js is **not** installed — you cannot `node --check` a file. Verify JS by
  loading it in a browser and reading the console instead.
- Python 3 is available — `python3 -m http.server 8080` is the dev server.
- macOS. The user runs commands in Terminal.app.

### The caching trap (this cost real time, repeatedly)

`python3 -m http.server` sends no `Cache-Control`, so the browser serves stale
JS and your edit appears to do nothing. Once a service worker is registered,
that's a *second* cache layer on top.

Full reset, run in the browser console:

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

**Before saying "that didn't work", check the DOM actually contains your
change.**

---

## 6. Known gaps / things discussed but not built

Not bugs — deliberate non-goals or deferred work. Don't "fix" them unprompted.

- **No export/import.** Discussed; not built. Data lives only in one browser's
  `localStorage`. If the user clears site data or switches browsers, history is
  gone. This is the single biggest gap and the most likely next request.
- **Data is per-origin.** Sessions logged at `localhost:8080` do **not** appear
  at the GitHub Pages URL, and vice versa. There's no migration path.
- **No session history editing.** Once a session is ended, its entries can't be
  edited — only the current, unsaved session can.
- **No progressive-overload suggestions, no rest-day tracking, no bodyweight
  logging, no plate calculator.** Never requested.
- **`.nojekyll`** exists locally but wasn't included in the web upload (Finder
  hides dotfiles). Harmless — no folder starts with `_`.
- **Not device-tested.** Everything was verified in a Chromium engine at mobile
  viewport, plus an offline test with the server stopped. It has not been run on
  a real iPhone or Android handset. The compatibility work (oklch fallbacks,
  `dvh`, `dominant-baseline`, ≥16px inputs) was done analytically.

---

## 7. What "done" looked like

For calibration, the app was verified end-to-end by driving the real code paths
from the browser console — not by inspection:

- Full session lifecycle: start → log → drop set → end → rate → appears in log
- Weight precision preserved at 62.5 kg (an integer clamp bug once broke this)
- `e1rm(60,8) === 76`, `e1rm(60,12) === 84` (Epley at the boundary, not Wathan)
- Broken axis: lowest 26 → `[0,25,30,35]`; regression `[40,38]` → base drops to 35
- Every screen renders; zero console errors
- Offline: server **stopped**, page reloaded, full workout logged successfully

If you make changes, this is the bar. `05-GOTCHAS-AND-TIPS.md` §2.1 shows the
console-driving technique.
