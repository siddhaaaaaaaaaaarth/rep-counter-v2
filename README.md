# Rep Counter

A phone-first gym rep counter. Tap to count reps, log sets with weights and drop
sets, run rest timers, rate the session, and track estimated 1RM over time.

No build step, no dependencies, no backend — plain HTML/CSS/JS. All data lives in
the browser's `localStorage` on your own device.

**Live:** https://USERNAME.github.io/rep-counter/

## Features

- Tap-to-count rep counter with a quick weight stepper (half-plate precision)
- Per-set logging, including drop-set segments
- Rest timers: per workout, overridable per exercise
- Session tracking — start/end a workout, with duration recorded
- 1–10 session rating
- Per-exercise remarks and whole-workout remarks (both optional)
- Data log: by exercise, by day (spreadsheet), and estimated-1RM graphs
- Four themes; works offline once installed

## Install on a phone

Open the live URL, then **Share → Add to Home Screen**. After the first load the
app is cached by a service worker and launches with no network at all.

## Local development

```bash
python3 -m http.server 8080
```

Then open <http://localhost:8080>.

## Notes

- Data is stored per-origin. Sessions logged on `localhost` won't appear on the
  hosted URL, and vice versa.
- After changing any app file, bump `CACHE_VERSION` in `sw.js` — otherwise
  installed phones keep serving the previously cached build.
