# REP COUNTER — Documentation Pack

**Read this file first.** It explains what every other document is for, so you
can jump straight to the one you need.

> ⚠ **`07-MAIN-REFERENCE.md` is the authoritative document.** It was written by
> reading every line of the real source and driving the running app, and it
> corrects eleven inaccurate claims in the documents below (listed in its §9).
> **Where `07` and any other document disagree, `07` wins.** Documents `01`–`06`
> remain useful supporting detail — they were largely accurate — but they have
> not all been re-verified line by line.
>
> Also read **`../CLAUDE.md`** before editing: it carries the documentation
> protocol every session must follow, and the hard rules for this codebase.

This pack is written to be self-contained. Someone with no prior exposure to
this project — a human reviewer, or an AI agent given these files — should be
able to understand, modify, or rebuild the entire application from these
documents plus the source code.

---

## What this application is

A phone-first gym rep counter, built as a static web app (a PWA). You tap a big
button once per rep, log sets with weights, run rest timers, and it keeps a
permanent training log with progress tables and estimated-1RM graphs.

**Key characteristics that shape every decision in the codebase:**

| Property | Value | Why it matters |
| --- | --- | --- |
| Build step | **None** | Open `index.html` and it runs. No npm, no bundler, no transpiler. |
| Dependencies | **Zero** | No frameworks, no chart library. Everything is hand-written. |
| Backend | **None** | No server, no accounts, no API. |
| Data storage | `localStorage`, one JSON blob | Entirely on the user's device. |
| JS dialect | **ES5** | No arrow functions, `let`/`const`, or template literals — deliberate, for old Android WebView support. |
| Total size | ~92 KB | Including two self-hosted font files. |
| Offline | **Full** | A service worker caches everything; works in airplane mode. |

**Source size:** 3,148 lines of JavaScript, 1,288 lines of CSS (verified
19 Aug 2026; the per-file counts in the listing below are from the initial
commit and are now out of date — see `07-MAIN-REFERENCE.md` §5 for current
figures).

---

## The documents

Read in this order if you're new. Skip around if you know what you're after.

### `00-START-HERE.md` ← you are here
The index. What each document covers and how the pack fits together.

### `07-MAIN-REFERENCE.md` ← ★ **THE AUTHORITATIVE DOCUMENT**
**Everything, verified against the code.** Overview, architecture, data flow, a
full variable and config reference (every field, its unit, range and default),
a file-by-file breakdown, run instructions confirmed by actually running them,
the real git history, a list of corrections to these older docs, and the known
issues with their measured evidence.

**Read this if:** you are doing anything at all. It supersedes the documents
below wherever they disagree.

### `06-PROJECT-CONTEXT.md` ← **read this second**
**Everything you can't learn from the code.** Which of the three on-disk copies
is canonical, how the site is actually deployed (web upload, *not* `git push` —
and why a plain push would be rejected), a list of features that were built and
then deliberately **removed** (so you don't helpfully re-add them), how this
user prefers to work, and the known gaps.

**Read this if:** you are a new session with no prior context. Skipping it is
the fastest way to do confidently wrong work.

### `01-PRODUCT-SPEC.md`
**What the app does, exhaustively.** Every screen, every button, every rule.
Written as behaviour, not code — this is the "what", not the "how".

Includes the non-obvious business rules that are easy to get wrong if you
rebuild from scratch: the rest-timer inheritance hierarchy, how drop sets are
stored, the two different one-rep-max formulas and exactly where they switch,
and the broken-axis rule for the progress graph.

**Read this if:** you're reviewing whether the app behaves correctly, or you're
rebuilding and need the spec.

### `02-ARCHITECTURE.md`
**How the code is put together.** The module layout, the data model, the render
loop, the event-delegation pattern, and the reasoning behind the structural
choices.

**Read this if:** you're about to change the code and need to know where things
live and why they're arranged that way.

### `03-DESIGN-SYSTEM.md`
**The visual language.** Four themes built entirely from CSS custom properties,
the typography, the colour-role rules, and the origin of the design in the
Claude Design mockups.

**Read this if:** you're changing anything visual, adding a screen, or adding a
fifth theme.

### `04-REBUILD-GUIDE.md`
**Step-by-step reconstruction from an empty folder.** Ordered build phases, each
producing something runnable, with checkpoints to verify before moving on.

**Read this if:** you're rebuilding from zero, or you want to understand the
system by assembling it in the order it was originally built.

### `05-GOTCHAS-AND-TIPS.md`
**Hard-won lessons.** Every bug that cost real time during development, why it
happened, and how to avoid it. Plus practical technique for working on this
codebase.

**Read this if:** something is behaving strangely, or before you start editing —
several of these traps are invisible until they bite.

---

## The source files

The application itself. Every file carries a detailed header comment explaining
its responsibility.

```
index.html          44 lines   The shell. Meta tags, stylesheet + script order,
                               service-worker registration.
manifest.json       25 lines   PWA manifest — makes Android install it properly.
sw.js               86 lines   Service worker. The offline cache.

css/theme.css      162 lines   The four themes as CSS custom properties,
                               plus the no-oklch fallback block.
css/fonts.css       17 lines   Self-hosted @font-face declarations.
css/app.css      1,068 lines   All layout and component styling.

js/store.js        623 lines   ALL persistent state and business logic.
                               Zero DOM access. Start here to understand data.
js/themes.js        85 lines   Theme definitions + the 1–10 rating colour ramp.
js/timer.js        150 lines   The shared countdown/stopwatch engine.
js/ui.js           235 lines   Bottom-sheet dialogs (the only input surface).
js/screens.js      745 lines   One function per screen; each returns an HTML
                               string. Zero state mutation.
js/app.js          894 lines   Router, the single delegated click handler,
                               and all action handlers.

fonts/                         Two .woff2 files (Archivo variable, Bebas Neue).
icons/                         Two PNGs for the home-screen icon.
```

**Load order matters** and is fixed in `index.html`: `store → themes → timer →
ui → screens → app`. Each file attaches one global (`Store`, `THEMES`/`RATINGS`,
`Timer`, `UI`, `Screens`, `RepCounter`) and depends only on the ones before it.

---

## Fastest way to get oriented

If you have 15 minutes and want to genuinely understand this codebase:

1. Read **`07-MAIN-REFERENCE.md`** — the verified account of what the app does,
   what every variable controls, and what's known to be broken. Then
   **`06-PROJECT-CONTEXT.md`** for what's already been tried and rejected and
   how the deployment actually works. Ten minutes here prevents hours of
   confidently wrong work.
2. Read **`01-PRODUCT-SPEC.md`** § "Session lifecycle" — the concept everything
   else hangs off.
3. Open **`js/store.js`** and read the header comment plus the data shape. All
   state lives in one object; once you know its shape, the app is predictable.
4. Read **`02-ARCHITECTURE.md`** § "The render loop" — three paragraphs, and it
   explains why the code looks the way it does.
5. Skim **`05-GOTCHAS-AND-TIPS.md`**. It'll save you from re-discovering the
   same traps.

---

## If you are an AI agent starting a fresh session

Paste-ready orientation, before you touch anything:

> This is a zero-dependency, no-build static PWA. Before making changes:
> 0. Read `CLAUDE.md` in the repo root — it carries the mandatory documentation
>    protocol: comment new code in the same edit, and update
>    `docs/07-MAIN-REFERENCE.md` plus `CHANGELOG.md` in the same turn as any
>    code change. Never leave documentation for later.
> 1. Read `docs/07-MAIN-REFERENCE.md` (authoritative),
>    `docs/06-PROJECT-CONTEXT.md` and `docs/05-GOTCHAS-AND-TIPS.md` in full.
> 2. The codebase is **ES5 only** — no arrow functions, `let`/`const`, template
>    literals, spread, or optional chaining in shipped code.
> 3. **All state lives in `js/store.js`**; screen functions are pure and must
>    never mutate state or touch the DOM.
> 4. Never nest a `<button>` inside another `<button>` — the parser silently
>    breaks the DOM.
> 5. Verify changes by loading the app in a browser and driving it from the
>    console, not by inspection. Browser + service-worker caching will lie to
>    you; clear both before concluding anything.
> 6. If you change any app file, bump `CACHE_VERSION` in `sw.js`.

---

## Running it

```bash
cd path/to/app
python3 -m http.server 8080
```

Open <http://localhost:8080>.

`localhost` matters: service workers only run on `localhost` or HTTPS. Opening
`index.html` directly as a `file://` URL will partly work, but Safari blocks
`localStorage` on `file://` so nothing will persist.

---

## Provenance

The visual design came from four Claude Design mockup files (theme variants,
exercise flow, progress tables, home screen). The app was then built to match
those mockups, and evolved through roughly thirty rounds of iteration against a
single user's feedback. `05-GOTCHAS-AND-TIPS.md` records what that iteration
taught; several decisions in the code look arbitrary until you read it.
