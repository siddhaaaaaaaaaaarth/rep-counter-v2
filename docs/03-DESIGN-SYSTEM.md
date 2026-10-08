# 03 — Design System

The visual language: themes, tokens, typography, and the rules that keep it
coherent.

---

## 1. Origin

The design came from four Claude Design mockup files:

| File | Gave us |
| --- | --- |
| `Exercise Flow - Theme Variants.dc.html` | The four themes; home, exercise list, counter, review, timer screens |
| `Exercise Progress Tables.dc.html` | The data log: workout list, progress tables, spreadsheet |
| `3A Home.dc.html` | The bottom tab bar treatment |
| `ios-frame.jsx` | The iOS device frame the mockups render inside |

The mockups are static HTML with inline styles, rendered inside a simulated
iPhone. The app reproduces their look using CSS custom properties instead of
inline styles, so one component definition serves all four themes.

**Aesthetic:** brutalist gym signage. Flat surfaces, hard edges, no rounded
corners anywhere, condensed uppercase display type, one loud accent colour, and
a hard offset shadow on the rep counter. Nothing decorative.

---

## 2. The four themes

Every theme is a set of CSS custom properties on `[data-theme="..."]`. Switching
themes sets one attribute on `<html>`; nothing else changes.

| id | Name in app | Character |
| --- | --- | --- |
| `t3a` | DARK & RED | Dark, hazard-red accent, borderless flat surfaces |
| `t3b` | LIGHT & RED | Light, hazard-red accent, 3px black card borders |
| `t7a` | DARK | Dark, white-on-black (accent = white) |
| `t7b` | LIGHT | Light, black-on-white (accent = black) |

**The whole design collapses into these tokens:**

```css
--bg           page background
--surface      cards, buttons, panels
--surface-2    raised surfaces (chips, pressed states, sheet headers)
--text         primary text
--muted        secondary text
--accent       the one loud colour  ← the theme's identity
--accent-fg    text drawn on top of accent
--invert-bg    high-contrast button background (white on dark, black on light)
--invert-fg    text on invert
--bw / --bc    card border width + colour  (0 on dark themes, 3px black on light)
--lead-w       accent left-bar width on "next up" cards (6px dark, 0 light)
--hairline     divider lines
--ring         timer dial ring
--tap-shadow   the counter's hard offset shadow
--field-bg     input/textarea background
--field-bw     input border width
--dash-w       dashed border width for upcoming sets
--scrim        modal backdrop
```

**Two structural ideas make four themes from one stylesheet:**

1. **Dark themes have no borders; light themes have 3px black borders.** `--bw`
   is `0px` or `3px`, so `border: var(--bw) solid var(--bc)` renders correctly
   in both without any theme-specific rules.

2. **In the mono themes, `--accent` equals `--text`.** So every accent cue
   (active tab, current set outline, rep counts, ON toggles) still *works* —
   it just reads by weight and position rather than hue. No mono-specific code
   exists anywhere.

---

## 3. Colour roles ⚠ follow this

One rule keeps the accent meaningful rather than decorative:

| Role | Style | Examples |
| --- | --- | --- |
| **Add something** | accent (red) | `+ NEW WORKOUT`, `+ ADD EXERCISE` |
| **Primary flow action** | invert (white on dark / black on light) | `START`/`END WORKOUT`, `COMPLETE SET` |
| **Everything else** | surface | `+ DROP`, `CLEAR LOG`, `SAVE REMARKS` |

The accent additionally marks **live state** — the in-progress dot, the current
set's outline, rep counts, ON toggles, the active tab — and **destructive rows**
like `RESET ALL DATA`.

Deliberate consequence: `END WORKOUT` is *not* red, even though it's a primary
action, because a red `+ ADD EXERCISE` sits directly above it and the button
that ends and wipes a session shouldn't look identical to the one that adds an
exercise.

---

## 4. Typography

Two families, both self-hosted in `fonts/` (latin subset only):

| Font | Use | Notes |
| --- | --- | --- |
| **Bebas Neue** | All display text: titles, card names, buttons, numbers | Only ships weight 400; `font-weight: 900` synthesises a faux bold — matching the mockups, which do the same |
| **Archivo** | All UI text: labels, sub-text, table cells, body | Variable font, one 34 KB file covers 500–900 |

```css
--font-display: 'Bebas Neue', 'Archivo Black', Impact, 'Haettenschweiler', 'Arial Narrow', sans-serif;
--font-ui: 'Archivo', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
```

**Tracking, matched to the mockups:**

| Element | Size / weight | Letter-spacing |
| --- | --- | --- |
| Screen title | Bebas 900 34px | `0.03em` |
| Card name | Bebas 900 20px | `0.02em` |
| Button | Bebas 900 18px | `0.05em` |
| Sub-text | Archivo 700 11px | **none** |
| Small caps labels | Archivo 800 9–10px | `0.04–0.06em` |

⚠ **`-webkit-font-smoothing: antialiased` on `body` is required.** The mockups
render inside a device frame that sets it. Without it, macOS/iOS use subpixel
antialiasing which makes the identical font look noticeably heavier — this was
diagnosed as a reported "the font is a little different" bug.

⚠ **Inputs must be ≥16px.** Below that, iOS Safari zooms the page on focus.
This is why `maximum-scale=1` was *removed* from the viewport tag — it also
blocked pinch-zoom (an accessibility regression) and Android ignores it anyway.

---

## 5. Layout patterns

**Every screen is the same skeleton:**

```html
<div class="screen">          <!-- flex column, full height -->
  <div class="hd">…</div>     <!-- fixed header -->
  <div class="scroll">…</div> <!-- the only scrolling region, flex:1 -->
  <div class="cta">…</div>    <!-- fixed bottom button (optional) -->
</div>
```

Only `.scroll` scrolls; `body` has `overflow: hidden`. This gives a native app
feel — headers and primary buttons never move.

**Safe areas:** bottom padding uses `max(14px, env(safe-area-inset-bottom))` so
content clears the iPhone home indicator. `viewport-fit=cover` in the meta tag
enables this.

**Width:** `#app` is capped at `max-width: 480px` and centred, so it looks
deliberate on desktop rather than stretched.

---

## 6. The oklch fallback ⚠ CRITICAL

Colours are authored in **oklch** for perceptually even ramps. oklch needs
Chrome 111+ / Safari 15.4+.

**The usual two-declaration fallback does not work for custom properties.** CSS
parses custom property values permissively — an unsupported `oklch()` is stored
happily and only fails later, when `var()` substitutes it, leaving the property
invalid at computed-value time. The result is an *unpainted* app, not a
fallback.

The reliable gate is `@supports`, at the end of `theme.css`:

```css
@supports not (color: oklch(0 0 0)) {
  [data-theme="t3a"] { --surface: #161616; --accent: #e60016; /* … */ }
  /* …all four themes… */
}
```

The hex values are the **exact sRGB bytes Chrome paints** for each oklch colour,
sampled by filling a `<canvas>` and reading the pixel back — not eyeballed.

The rating ramp takes a different approach: it converts oklch→hex **in
JavaScript** at startup, because those colours land in inline `style`
attributes where `@supports` can't reach.

---

## 7. Adding a fifth theme

1. Add a `[data-theme="tXX"]` block in `theme.css` defining every token.
2. Add an entry to `THEMES` in `themes.js` with literal `base`/`accent` swatch
   colours for the settings preview.
3. Add matching overrides in the `@supports not (color: oklch(...))` block.

No component CSS should need touching. **If you find yourself writing a
theme-specific component rule, a token is missing** — add the token instead.
