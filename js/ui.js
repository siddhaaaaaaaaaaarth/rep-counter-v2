/* ═══════════════════════════════════════════════════════════════════════════
 * ui.js — bottom sheets (every dialog in the app) plus small shared helpers.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ROLE
 * ----
 * ALL data entry in this app happens in a bottom sheet. There are no inline
 * forms and no browser prompt()/alert() anywhere. Centralising it here means
 * every dialog gets identical behaviour: backdrop tap to dismiss, Enter to
 * confirm, consistent CANCEL/SAVE footer, and automatic focus.
 *
 * ⚠ Sheets render into #sheetRoot, NOT #app. This is deliberate and load-
 *   bearing: app.js replaces #app.innerHTML on every render, which would
 *   destroy an open dialog mid-typing. Keeping sheets in a sibling container
 *   makes them immune to re-renders.
 *
 * THE SHEETS
 * ----------
 *   UI.open(html, onMount)  the generic shell — everything else builds on it.
 *                           onMount receives the sheet element so callers can
 *                           wire their own buttons.
 *   UI.text({...})          single free-text field   (workout name, etc.)
 *   UI.number({...})        number with −/+ steppers (weight, seconds, reps)
 *   UI.workout({...})       name + the workout-wide rest timer switch
 *   UI.exercise({...})      name + sets + target reps + weight
 *   UI.confirm({...})       two-button confirmation; supports custom labels
 *                           and an onCancel callback (used by the leave-guard,
 *                           where "cancel" means "keep the session running")
 *
 * HELPERS
 * -------
 *   UI.esc(str)             HTML-escape. ⚠ Use on ALL user text — the whole app
 *                           is built by string concatenation.
 *   UI.buzz(ms)             haptic feedback. Guarded: navigator.vibrate is
 *                           Android-only and simply absent on iOS.
 *   UI.switchPair()         wires an OFF/ON button pair, returns a getter
 *   UI.wireStepper()        wires −/+ buttons around a number input
 *   UI.stepperHtml()        markup for the above
 *   UI.footer()/wireFooter() the standard CANCEL/SAVE pair
 *
 * ⚠ Inputs must stay ≥16px (see app.css). Below that, iOS Safari zooms the
 *   whole page when a field is focused.
 */
(function (global) {
  'use strict';

  var root = null;

  function esc(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var UI = {
    esc: esc,

    buzz: function (ms) {
      if (global.navigator && navigator.vibrate) navigator.vibrate(ms || 12);
    },

    close: function () {
      if (!root) root = document.getElementById('sheetRoot');
      root.innerHTML = '';
    },

    isOpen: function () {
      if (!root) root = document.getElementById('sheetRoot');
      return !!root.firstChild;
    },

    /* Renders `html` inside a bottom sheet. onMount(sheetEl) wires the buttons. */
    open: function (html, onMount) {
      if (!root) root = document.getElementById('sheetRoot');
      root.innerHTML = '<div class="scrim" data-scrim><div class="sheet">' + html + '</div></div>';
      var scrim = root.querySelector('[data-scrim]');
      var sheet = root.querySelector('.sheet');
      scrim.addEventListener('click', function (e) {
        if (e.target === scrim) UI.close();
      });
      sheet.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && e.target.tagName === 'INPUT') {
          e.preventDefault();
          var ok = sheet.querySelector('[data-ok]');
          if (ok) ok.click();
        }
      });
      if (onMount) onMount(sheet);
      var first = sheet.querySelector('input[type="text"]');
      if (first) { first.focus(); first.select(); }
      return sheet;
    },

    footer: function (okLabel) {
      return '<div class="btn-row" style="margin-top:16px">' +
        '<button class="btn btn-quiet" data-cancel>CANCEL</button>' +
        '<button class="btn btn-accent" data-ok>' + esc(okLabel || 'SAVE') + '</button>' +
        '</div>';
    },

    wireFooter: function (sheet, onOk) {
      sheet.querySelector('[data-cancel]').addEventListener('click', UI.close);
      sheet.querySelector('[data-ok]').addEventListener('click', onOk);
    },

    /* An OFF / ON pair. Returns a getter for the current value. */
    switchPair: function (sheet, name, initial, onChange) {
      var off = sheet.querySelector('[data-' + name + '-off]');
      var on = sheet.querySelector('[data-' + name + '-on]');
      var value = !!initial;
      function paint() {
        off.classList.toggle('is-on', !value);
        on.classList.toggle('is-on', value);
        if (onChange) onChange(value);
      }
      off.addEventListener('click', function () { value = false; paint(); UI.buzz(8); });
      on.addEventListener('click', function () { value = true; paint(); UI.buzz(8); });
      paint();
      return function () { return value; };
    },

    /* Wires the −/+ buttons around a number input and returns the input.
     *   scope  the .stepper element (or any ancestor of one)
     *   step   how much one press changes the value (1, 2.5, 15 …)
     *   min/max  hard bounds; the value is also rounded to 2 decimals so
     *            half-plate weights (62.5) survive but float dust doesn't
     * ⚠ Callers must place stepperHtml() inside a `.field` wrapper — that's
     *   where the ≥16px input font-size comes from. Outside one, the input
     *   falls back to the browser default (~13px) and iOS zooms on focus. */
    wireStepper: function (scope, step, min, max) {
      var input = scope.querySelector('input');
      /* NodeList.forEach is ES2015-era (Chrome 51+ / Safari 10+), as is
       * Object.assign in store.js — ES5 here means syntax, not runtime API. */
      scope.querySelectorAll('[data-step]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var next = (Number(input.value) || 0) + step * Number(btn.dataset.step);
          input.value = Math.min(max, Math.max(min, Math.round(next * 100) / 100));
          UI.buzz(8);
        });
      });
      return input;
    },

    stepperHtml: function (attr, value) {
      return '<div class="stepper">' +
        '<button data-step="-1">−</button>' +
        '<input type="number" inputmode="decimal" ' + attr + ' value="' + esc(value) + '">' +
        '<button data-step="1">+</button>' +
        '</div>';
    },

    /* Single free-text field. */
    text: function (opts) {
      var html = '<h2>' + esc(opts.title) + '</h2>' +
        (opts.hint ? '<p class="hint">' + esc(opts.hint) + '</p>' : '') +
        '<div class="field"><label>' + esc(opts.label || 'NAME') + '</label>' +
        '<input type="text" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') +
        '" autocapitalize="characters" autocomplete="off" spellcheck="false"></div>' +
        UI.footer(opts.okLabel);
      UI.open(html, function (sheet) {
        UI.wireFooter(sheet, function () {
          var val = sheet.querySelector('input').value.trim();
          if (!val) return;
          UI.close();
          opts.onSave(val);
        });
      });
    },

    /* Single number field with −/+ steppers. */
    number: function (opts) {
      var step = opts.step || 1;
      var min = opts.min === undefined ? 0 : opts.min;
      var max = opts.max === undefined ? 999 : opts.max;
      var html = '<h2>' + esc(opts.title) + '</h2>' +
        (opts.hint ? '<p class="hint">' + esc(opts.hint) + '</p>' : '') +
        '<div class="field"><label>' + esc(opts.label || '') + '</label>' +
        UI.stepperHtml('', opts.value) + '</div>' +
        UI.footer(opts.okLabel);
      UI.open(html, function (sheet) {
        var input = UI.wireStepper(sheet.querySelector('.stepper'), step, min, max);
        UI.wireFooter(sheet, function () {
          var val = Number(input.value);
          if (!isFinite(val)) return;
          UI.close();
          opts.onSave(Math.min(max, Math.max(min, val)));
        });
      });
      setTimeout(function () {
        var input = document.querySelector('.sheet input');
        if (input) { input.focus(); input.select(); }
      }, 0);
    },

    /* Workout name + its optional workout-wide rest timer. */
    workout: function (opts) {
      var w = opts.workout || { name: '', restEnabled: false, rest: opts.defaultRest || 90 };
      var html = '<h2>' + esc(opts.title) + '</h2>' +
        '<div class="field"><label>WORKOUT NAME</label>' +
        '<input type="text" data-name value="' + esc(w.name) + '" placeholder="PUSH DAY" ' +
        'autocapitalize="characters" autocomplete="off" spellcheck="false"></div>' +
        '<div class="field">' +
          '<label>REST TIMER BETWEEN SETS</label>' +
          '<div class="btn-row" style="margin-bottom:10px">' +
            '<button class="chip lg" data-rest-off>OFF</button>' +
            '<button class="chip lg" data-rest-on>ON</button>' +
          '</div>' +
          '<div data-rest-wrap>' + UI.stepperHtml('data-rest', w.rest) +
            '<p class="hint" style="margin:8px 0 0">Seconds. Runs after every set of every exercise in this workout — a single exercise can override it later.</p>' +
          '</div>' +
        '</div>' +
        UI.footer(opts.okLabel);
      UI.open(html, function (sheet) {
        var wrap = sheet.querySelector('[data-rest-wrap]');
        var restOn = UI.switchPair(sheet, 'rest', w.restEnabled, function (on) {
          wrap.style.opacity = on ? '1' : '0.35';
          wrap.style.pointerEvents = on ? '' : 'none';
        });
        UI.wireStepper(sheet.querySelector('.stepper'), 15, 5, 3600);
        UI.wireFooter(sheet, function () {
          var name = sheet.querySelector('[data-name]').value.trim();
          if (!name) return;
          UI.close();
          opts.onSave({
            name: name,
            restEnabled: restOn(),
            rest: Number(sheet.querySelector('[data-rest]').value) || 90
          });
        });
      });
    },

    /* Name + sets + target + weight — used for both creating and editing.
     * NOTE: there is deliberately NO drop-set control here. A per-exercise
     * drop-set toggle was built and then removed; drop sets are now a single
     * global switch in Settings (Store.dropSets). Don't re-add one. */
    exercise: function (opts) {
      var e = opts.exercise || { name: '', sets: 3, target: 10, weight: 20 };
      var html = '<h2>' + esc(opts.title) + '</h2>' +
        '<div class="field"><label>EXERCISE NAME</label>' +
        '<input type="text" data-name value="' + esc(e.name) + '" placeholder="BENCH PRESS" ' +
        'autocapitalize="characters" autocomplete="off" spellcheck="false"></div>' +
        '<div class="field row3">' +
        '<div><label>SETS</label><input type="number" inputmode="numeric" data-sets value="' + esc(e.sets) + '"></div>' +
        '<div><label>TARGET REPS</label><input type="number" inputmode="numeric" data-target value="' + esc(e.target) + '"></div>' +
        '<div><label>WEIGHT (KG)</label><input type="number" inputmode="decimal" data-weight value="' + esc(e.weight) + '"></div>' +
        '</div>' +
        UI.footer(opts.okLabel);
      UI.open(html, function (sheet) {
        UI.wireFooter(sheet, function () {
          var name = sheet.querySelector('[data-name]').value.trim();
          if (!name) return;
          UI.close();
          opts.onSave({
            name: name,
            sets: Number(sheet.querySelector('[data-sets]').value) || 1,
            target: Number(sheet.querySelector('[data-target]').value) || 1,
            weight: Number(sheet.querySelector('[data-weight]').value) || 0
          });
        });
      });
    },

    confirm: function (opts) {
      var html = '<h2>' + esc(opts.title) + '</h2>' +
        (opts.body ? '<p class="hint">' + esc(opts.body) + '</p>' : '') +
        '<div class="btn-row" style="margin-top:6px">' +
        '<button class="btn btn-quiet" data-cancel>' + esc(opts.cancelLabel || 'CANCEL') + '</button>' +
        '<button class="btn btn-accent" data-ok>' + esc(opts.okLabel || 'DELETE') + '</button>' +
        '</div>';
      UI.open(html, function (sheet) {
        sheet.querySelector('[data-cancel]').addEventListener('click', function () {
          UI.close();
          if (opts.onCancel) opts.onCancel();
        });
        sheet.querySelector('[data-ok]').addEventListener('click', function () {
          UI.close();
          opts.onConfirm();
        });
      });
    }
  };

  global.UI = UI;
})(window);
