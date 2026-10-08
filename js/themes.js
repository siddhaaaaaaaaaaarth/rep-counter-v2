/* ═══════════════════════════════════════════════════════════════════════════
 * themes.js — static configuration: the four themes, and the 1–10 rating ramp.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THEMES
 * ------
 * The actual colours live in css/theme.css as custom properties. This file only
 * holds the LIST (for the settings picker) and applyTheme(), which sets
 * data-theme on <html> — that one attribute switches the entire app's palette.
 *
 * ⚠ `swatch` colours are hard-coded literals, not var() references. A theme row
 *   in Settings must preview a theme that ISN'T currently applied, so it can't
 *   read the live custom properties.
 *
 * THE RATING RAMP  (see docs/01-PRODUCT-SPEC.md §7)
 * ------------------------------------------------
 * A 1–10 scale rendered as one continuous colour gradient. Authored in oklch
 * because it gives perceptually even steps, then pinned at three points so it
 * lands where the design requires rather than wherever linear interpolation
 * happens to go:
 *
 *      1  L 0.30  H 22   deep maroon-red
 *      5  L 0.62  H 60   orange
 *     10  L 0.86  H 92   bright gold
 *
 * Lightness climbs monotonically so no tile is darker than the one before it.
 * Text flips white → black at rank 5, where the tile gets light enough that
 * white would stop being readable.
 *
 * ⚠ The ramp is converted to sRGB HEX here in JS, not emitted as oklch(). These
 *   colours land in inline style attributes, where the @supports fallback in
 *   theme.css cannot reach them — an unsupported oklch() there would leave the
 *   tile completely unpainted on Chrome < 111. toHex() below is a full
 *   oklch→linear-sRGB→gamma conversion with clamping.
 */
(function (global) {
  'use strict';

  /* Swatch literals for the Settings preview rows. These are written straight
   * into inline style attributes by Screens.themeRows().
   *
   * ⚠ KNOWN GAP: HAZARD and PAPER are raw oklch() strings, so on a browser
   *   without oklch support (Chrome < 111 / Safari < 15.4) those two swatches
   *   paint as nothing. The @supports block in theme.css cannot reach an
   *   inline style, and unlike the RATINGS ramp below these were never run
   *   through toHex(). Cosmetic only — the themes themselves fall back fine.
   *   Fix, if it ever matters: '#e60016' for HAZARD, '#f5f5f5' for PAPER. */
  var HAZARD = 'oklch(0.58 0.24 27)';
  var INK = '#0a0a0a';
  var PAPER = 'oklch(0.97 0 0)';

  global.THEMES = [
    { id: 't3a', name: 'DARK & RED', swatch: { base: INK, accent: HAZARD } },
    { id: 't3b', name: 'LIGHT & RED', swatch: { base: PAPER, accent: HAZARD } },
    { id: 't7a', name: 'DARK', swatch: { base: INK, accent: PAPER } },
    { id: 't7b', name: 'LIGHT', swatch: { base: PAPER, accent: INK } }
  ];

  global.applyTheme = function (id) {
    var theme = null;
    for (var i = 0; i < global.THEMES.length; i++) {
      if (global.THEMES[i].id === id) theme = global.THEMES[i];
    }
    if (!theme) theme = global.THEMES[0];
    document.documentElement.setAttribute('data-theme', theme.id);
    var meta = document.getElementById('themeColor');
    if (meta) meta.setAttribute('content', theme.swatch.base === INK ? INK : '#f4f4f4');
  };

  /* ── Workout rating, 1–10 ─────────────────────────────────────────────
   * One continuous ramp in oklch, running red → orange → yellow → green so
   * the number reads as a verdict before you've read the digit: a bad session
   * is red, a great one is green. Pinned at FIVE points, because a straight
   * 1→10 interpolation across that much hue would slide through muddy olive
   * in the middle instead of passing through a clean yellow, and because the
   * green end needs its own anchor to stop 8–10 reading as lime:
   *
   *   1   bright red    L 0.585  C 0.222  H 27    (the app's hazard red)
   *   4   orange        L 0.720  C 0.190  H 62
   *   7   yellow        L 0.865  C 0.185  H 100
   *   8   green         L 0.690  C 0.185  H 149   (the handover into green)
   *   10  dark green    L 0.520  C 0.130  H 150
   *
   * ⚠ LIGHTNESS PEAKS AT 7, THEN FALLS AWAY. IT DOES NOT CLIMB ALL THE WAY.
   *   The original maroon→gold ramp climbed monotonically, and that rule is
   *   still recorded in the older docs. It cannot survive a red→green scale:
   *   yellow is intrinsically the lightest hue on the path, so forcing 8–10
   *   lighter still would only produce pale mint. The ramp rises
   *   0.585 → 0.865 (peak at 7), then descends 0.690 → 0.520 across the
   *   greens, so the scale deepens as it improves and 10 lands on a solid
   *   dark green rather than trailing off.
   *
   * ⚠ THE GREEN END IS HELD JUST INSIDE THE sRGB GAMUT, AND CHROMA MUST FALL
   *   WITH LIGHTNESS. sRGB simply holds less saturated green the darker you
   *   go: at L 0.690 the ceiling near H 149 is ~0.190, but by L 0.520 it is
   *   ~0.135. Exceeding it doesn't error — the conversion below clamps the
   *   red channel to 0, which quietly flattens the colour and shifts its hue.
   *   Hence C 0.185 at rank 8 but only 0.130 at rank 10. ⚠ Raising chroma at
   *   the dark end gives you a DULLER green, not a deeper one; lightness is
   *   the lever there, not saturation.
   *   (Ranks 2–7 do clamp slightly. That is inherited from the original ramp
   *   and is what gives the oranges their punch — leave them alone.)
   *
   * TEXT COLOUR IS UNIFORM INK ON EVERY TILE.
   *   Two earlier rules were tried and dropped: "white below 5, black from 5
   *   up" (broke as soon as the hues changed), and a per-tile contrast
   *   picker (correct, but flipped ranks 1 and 10 to white and split the
   *   strip into three visual groups). One ink colour reads as one scale.
   *   See the measured trade-off at the bottom of this block before you
   *   darken any tile.
   *
   * ⚠ Emitted as sRGB HEX, never oklch(). These land in inline style
   *   attributes (Screens.ratingTiles), where the @supports fallback in
   *   theme.css cannot reach them — a raw oklch() here would leave every
   *   tile unpainted on Chrome < 111. */
  global.RATINGS = (function () {
    function lerp(a, b, t) { return a + (b - a) * t; }

    /* The five pins above, as [rank, L, C, H]. Ranks must ascend.
     * The extra pin at 8 is what makes the top of the scale read as GREEN
     * rather than lime. Hue climbs +12–13 per step to rank 7, then jumps +49
     * across 7→8 and effectively stops (+1 over 8→10). So the yellow→green
     * handover happens in ONE decisive step, and ranks 8/9/10 are then the
     * same green getting steadily deeper — 9 is the exact midpoint of the
     * 8 and 10 pins, which is why it needs no pin of its own. */
    var PINS = [
      [1,  0.585, 0.222, 27],
      [4,  0.720, 0.190, 62],
      [7,  0.865, 0.185, 100],
      [8,  0.690, 0.185, 149],
      [10, 0.520, 0.130, 150]
    ];

    /* Linear interpolation inside whichever pinned leg `n` falls in. */
    function stop(n) {
      for (var i = 0; i < PINS.length - 1; i++) {
        var a = PINS[i], b = PINS[i + 1];
        if (n <= b[0] || i === PINS.length - 2) {
          var t = (n - a[0]) / (b[0] - a[0]);
          return { L: lerp(a[1], b[1], t), C: lerp(a[2], b[2], t), H: lerp(a[3], b[3], t) };
        }
      }
      return { L: PINS[0][1], C: PINS[0][2], H: PINS[0][3] };
    }

    /* oklch → linear sRGB → gamma-encoded sRGB, each channel clamped to 0..1.
     * Returns channels as floats so both the hex and the luminance below can
     * be derived from one conversion. */
    function srgb(L, C, H) {
      var a = C * Math.cos(H * Math.PI / 180);
      var b = C * Math.sin(H * Math.PI / 180);
      var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
      var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
      var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
      var l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
      return [
        4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
      ].map(function (v) {
        v = Math.max(0, Math.min(1, v));
        return v > 0.0031308 ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055 : 12.92 * v;
      });
    }

    function toHex(rgb) {
      return '#' + rgb.map(function (v) {
        var n = Math.round(Math.max(0, Math.min(1, v)) * 255);
        return (n < 16 ? '0' : '') + n.toString(16);
      }).join('');
    }

    /* EVERY tile uses the same ink numeral. This is a deliberate visual
     * choice, made after seeing the alternative on screen.
     *
     * Earlier versions picked white or ink per tile by measured contrast.
     * That is the "safer" rule, but it made ranks 1 and 10 — the two darkest
     * tiles — flip to white while 2–9 stayed dark, and the strip read as
     * three groups rather than one scale. Uniform ink looks like one object.
     *
     * ⚠ THE TRADE-OFF, MEASURED (contrast of #0a0a0a on each tile):
     *     rank  1  #e22226  4.22    ← below WCAG AA (4.5)
     *     ranks 2–8          5.2 – 13.3
     *     rank  9  #1f9a4a  5.45
     *     rank 10 #1d7d3e   3.82    ← below WCAG AA (4.5)
     *   The numerals are 17px at weight 900 (.rate-num in app.css). WCAG's
     *   relaxed 3.0 bar for "large text" starts at 18.66px bold, so 17px
     *   just misses it and the formal bar here is 4.5. Ranks 1 and 10 sit
     *   under that. In practice they are legible — heavy condensed digits on
     *   a saturated field — but this is a known, accepted shortfall, not an
     *   oversight.
     *
     * ⚠ IF YOU DARKEN ANY TILE FURTHER, RE-MEASURE. There is no longer an
     *   automatic fallback to white text to save you: a darker tile now just
     *   gets harder to read. To clear 4.5 with ink, rank 1 needs L ≥ 0.605
     *   (#e92d2d) and rank 10 needs L ≥ 0.565 (#298b49) — both nudges are
     *   small enough that the colours barely change.
     *
     * ⚠ COUPLING: this decision depends on `.rate-num { font-size: 17px }`
     *   in css/app.css. If that ever grows past 18.66px the large-text bar
     *   applies and every tile passes comfortably; if it SHRINKS, ranks 1
     *   and 10 get worse. */
    var out = [];
    for (var n = 1; n <= 10; n++) {
      var c = stop(n);
      out.push({ n: n, bg: toHex(srgb(c.L, c.C, c.H)), fg: INK });
    }
    return out;
  })();
})(window);
