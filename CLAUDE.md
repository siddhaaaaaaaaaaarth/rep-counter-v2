# CLAUDE.md — working agreement for this repo

Read this before doing anything else in this folder. It is short on purpose.

---

## The app in one paragraph

Zero-dependency, no-build static PWA: a phone-first gym rep counter. Six plain
`<script>` files, ES5 syntax, one `localStorage` key, no server, no tests, no
package manager. Open `index.html` on `localhost` and it runs.

**Orientation, in order:**

1. **`docs/07-MAIN-REFERENCE.md`** — the authoritative document. Architecture,
   data flow, the full variable/config reference, file-by-file breakdown,
   verified run instructions, known issues. **If it and `docs/00`–`06`
   disagree, `07` wins.**
2. `docs/05-GOTCHAS-AND-TIPS.md` — traps that cost real time.
3. `docs/06-PROJECT-CONTEXT.md` — deployment reality, and the list of features
   that were **built and then deliberately removed**. Do not helpfully re-add
   them.
4. `CHANGELOG.md` — what changed recently and why.

---

## THE DOCUMENTATION PROTOCOL (mandatory, every session, unprompted)

**Documentation is part of a change, not a follow-up task.** A change that
lands without its documentation is an incomplete change. Do not defer this, do
not batch it for later, do not leave it for the next session — that is exactly
how the docs drifted out of sync with the code before.

### 1. Comment as you write, in the same edit

When you add or modify code, comment it **in the same edit** — never as a later
pass. Explain:

- **what** the function or block does, and **why** it exists;
- **what every new variable or config value means**: its unit (seconds vs
  milliseconds, kg), its valid range, its default, and why it's set that way;
- **assumptions and coupling to other files** — if your code depends on a class
  name in `app.css`, a `data-` attribute in `screens.js`, or a field shape in
  `store.js`, say so where a future reader will hit it.

Match the existing comment style: `/* … */` block comments, plain prose,
`⚠` for a trap someone could reasonably walk into.

### 2. Update the docs in the same turn as the change

After completing any feature, fix or refactor, before you report back:

- Update the affected sections of **`docs/07-MAIN-REFERENCE.md`** —
  architecture, variable reference, file-by-file breakdown, data flow, known
  issues. Keep the line counts and the "verified" claims honest.
- **Append an entry to `CHANGELOG.md`** (newest first) covering: what changed,
  why, any new variables or behaviour a human supervisor would need to know,
  files touched, whether `CACHE_VERSION` was bumped, and how you verified it.

### 3. Verify rather than assume

If you are unsure whether something is documented accurately, **check it against
the code** — do not trust the docs, and do not trust your own memory of an edit
you made earlier in the session. Run the checks in
`docs/07-MAIN-REFERENCE.md` §11 and report what actually happened, including
anything you could not verify and why.

### 4. If you are running low on context mid-task

**Stop coding and write things down.** Accurate, concise notes about what you
have done, what is half-finished, and what you were about to do next are worth
more than a few more lines of code. Put them in `CHANGELOG.md` under a clearly
marked in-progress heading. The previous documentation pack was written as a
context window ran out, and it shipped eleven inaccurate claims as a result.

---

## Hard rules for this codebase

| Rule | Why |
| --- | --- |
| **ES5 syntax only** — no arrow functions, `let`/`const`, template literals, spread, optional chaining | Old WebViews parse the whole file before running it; one modern token means a blank screen, not a graceful failure. Also avoid *new* ES6 runtime APIs — see `07` §10.1. |
| **All state changes go through `js/store.js`** | One source of truth. `store.js` never touches the DOM. |
| **Screen functions are pure** — return strings, never mutate state or touch the DOM | The screen is always a pure function of `Store`. |
| **Never nest `<button>` inside `<button>`** | The parser silently auto-closes the outer one and the DOM stops matching your source. Use `<span data-act>` or `<div role="button" tabindex="0" data-act>`. |
| **Never call `render()` from anything that ticks or fires while typing** | It destroys textarea focus mid-word. Patch individual nodes instead. |
| **Never sync state *from* `render()`** | Render must be a pure read. State-syncing there makes controls look dead. |
| **Escape all user text with `UI.esc()`** | Everything is built by string concatenation. |
| **Add every new persisted field to `normalize()` in the same edit** | Old saved data must keep loading. |
| **Bump `CACHE_VERSION` in `sw.js` on any app-file change** | Otherwise installed phones serve the stale build forever and never recover. |
| **Weights use `clampKg` (2 decimals), never `clamp`** | Gym plates are 2.5 kg. Rounding 32.5 → 33 is data corruption; it shipped once as a real bug. |
| **Inputs stay ≥16px** | Below that iOS Safari zooms the page on focus. |
| **No colour literals in `css/app.css`** | Every colour is a `var()` token from `theme.css`, or one of the four themes breaks silently. |

---

## Running and verifying

```bash
python3 -m http.server 8080
```

Then <http://localhost:8080>. `localhost` matters — service workers need it, and
Safari blocks `localStorage` on `file://`.

There is **no build, no lint, and no test suite.** Verification means loading the
app and driving it from the browser console; the exact checks are in
`docs/07-MAIN-REFERENCE.md` §11. Node.js is not installed on this machine, so
`node --check` is not available.

**Browser caching will lie to you.** Hard-reload past both the HTTP cache and the
service worker before concluding a change didn't work (§11 has the snippets).

---

## Things to know before you touch anything

- **Deployment is `git push`.** Changed 8 Oct 2026 — this repo is wired to
  `git@github.com:siddhaaaaaaaaaaarth/rep-counter.git` over SSH, and GitHub
  Pages serves `main` at
  **<https://siddhaaaaaaaaaaarth.github.io/rep-counter/>**. Pushing to `main`
  deploys. Still bump `CACHE_VERSION` in the same change or installed phones
  keep the old build.
  ⚠ `docs/06-PROJECT-CONTEXT.md` §2 still describes the OLD arrangement
  (manual web upload, unrelated histories, push rejected). That described a
  **different, now-abandoned repo** — `rep-counter-2`, still live, deliberately
  left untouched. Ignore §2 for deployment; it is kept as history.
- **This user consistently prefers less UI.** When in doubt, remove rather than
  add, and never add explanatory text to a screen unasked.
- **They are not a developer.** Terminal steps need exact, paste-ready commands
  and an explanation of where to run them.

### How to work visibly (asked for explicitly, 19 Aug 2026)

- **Edit files with the Edit/Write tools, not shell `sed`/`python3` heredocs.**
  Both make identical changes, but only Edit/Write emit a structured diff that
  the client renders as green/red +/− lines. Scripted shell edits are invisible
  to the user, who then has no idea whether anything actually changed. If a
  session's mode nudges toward doing file work in Bash, **override it for edits
  to app files** — visibility here is worth more than the speed.
- **Terse, but not opaque.** Short replies are still right; "mountains of output
  to comb through" is not wanted. But say what you changed and why as you go —
  the failure mode to avoid is the user "driving blind", not the user reading a
  long message. Aim for a few sentences per change, not a paragraph and not one
  word.
- **Flag trade-offs BEFORE building, not after.** A fix that was shipped, then
  rejected, then reverted (the audio-session rest alarm — see `CHANGELOG.md`)
  cost a whole cycle because a well-known downside wasn't raised up front. When
  an approach has a cost the user would obviously refuse, say so and ask first.
