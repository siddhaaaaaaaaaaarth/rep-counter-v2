/* ═══════════════════════════════════════════════════════════════════════════
 * screens.js — HTML generation. One function per screen.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ROLE IN THE SYSTEM
 * ------------------
 * Every function here is PURE: it takes data and returns an HTML string. It
 * must never mutate Store, never touch the DOM, and never attach listeners.
 * app.js takes the returned string and assigns it to #app.innerHTML.
 *
 * That purity is what makes the app predictable — the screen you see is always
 * a direct function of Store's contents. If you find yourself wanting to change
 * state in here, the change belongs in an action handler in app.js instead.
 *
 * HOW INTERACTION WORKS
 * ---------------------
 * Nothing here binds events. Instead, elements declare intent with a data-act
 * attribute:
 *
 *     <button data-act="complete-set">COMPLETE SET</button>
 *
 * app.js has ONE delegated click listener that reads data-act and dispatches.
 * Extra parameters travel as data attributes and arrive as the handler's first
 * argument:
 *
 *     data-w  workout id      data-i  index (log entry)
 *     data-e  exercise id     data-n  number (rating rank)
 *     data-s  seconds         data-r  range key ('1m'/'3m'/'6m'/'all')
 *     data-d  delta (weight step)
 *
 * ⚠ NEVER nest a <button> inside another <button>. The HTML parser silently
 *   auto-closes the outer one and your DOM stops matching your source — this
 *   cost real debugging time (see docs/05-GOTCHAS-AND-TIPS.md §1.1). Where a
 *   tappable thing must live inside another tappable thing, use
 *   <span data-act="..."> or <div role="button" tabindex="0" data-act="...">.
 *   Delegation works on any element, so nothing is lost.
 *
 * ⚠ ALWAYS pass user-supplied text through esc(). Everything here is built by
 *   string concatenation, so an unescaped workout name is an XSS hole.
 *
 * THE SCREENS (each returns a complete <div class="screen">)
 * ---------------------------------------------------------
 *   settings()     theme picker, feature switches, default rest, reset
 *   home()         workout library + bottom tab bar
 *   dataLog()      workout list for the log + bottom tab bar
 *   logWorkout()   ALL THREE data views stacked: table, day-sheet card, graph
 *   daySheet()     the spreadsheet grid
 *   workout()      exercise list, START/END session button
 *   exercise()     the rep counter — the densest screen in the app
 *   timer()        countdown/stopwatch dial + the rest ON/OFF panel
 *
 * SHARED BUILDERS
 * ---------------
 *   tabBar()       the two-tab bottom bar (home + data log only)
 *   secHd()        a section header row
 *   progressRow()  one row of the exercise progress table
 *   ratingTiles()  the 1–10 colour strip (used by the end-of-session sheet)
 *   e1rmChart()    the estimated-1RM SVG, hand-built, no chart library
 *   shortDate()    ISO timestamp → "JUL 29"
 *
 * LAYOUT CONTRACT
 * ---------------
 * Every screen follows the same skeleton, and app.css depends on it:
 *
 *     <div class="screen">        flex column, fills the viewport
 *       <div class="hd">          fixed header, never scrolls
 *       <div class="scroll">      THE ONLY scrolling region (flex: 1)
 *       <div class="cta">         fixed bottom button (optional)
 *     </div>
 *
 * body has overflow:hidden, so if you put content outside .scroll it will be
 * unreachable rather than merely awkward.
 */
(function (global) {
  'use strict';

  var esc = UI.esc;

  var ICON = {
    clock: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"></circle><path d="M12 7v5l3.2 2"></path></svg>',
    gear: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>'
  };

  function plural(n, word) {
    return n + ' ' + word + (n === 1 ? '' : 's');
  }

  function secHd(title, right) {
    return '<div class="sec-hd"><h2>' + esc(title) + '</h2>' + (right || '') + '</div>';
  }

  /* ── Theme rows (compact) ────────────────────────────────── */
  function themeRows() {
    return THEMES.map(function (t) {
      var s = t.swatch;
      var sel = Store.theme === t.id;
      /* one flat base + the accent — no near-identical second shade */
      return '<button class="theme-row' + (sel ? ' is-sel' : '') + '" data-act="pick-theme" data-id="' + t.id + '">' +
        '<span class="sw">' +
          '<i style="background:' + s.base + ';flex:2"></i>' +
          '<i style="background:' + s.accent + ';flex:1"></i>' +
        '</span>' +
        '<span class="theme-name">' + esc(t.name) + '</span>' +
        '<span class="theme-check">' + (sel ? '✓' : '') + '</span>' +
      '</button>';
    }).join('');
  }

  /* ── Settings ────────────────────────────────────────────── */
  function settings() {
    return '<div class="screen">' +
      '<div class="hd">' +
        '<div class="hd-mid"><div class="title">SETTINGS</div>' +
        '<div class="sub">Theme · defaults · data</div></div>' +
        '<button class="icon-btn" data-act="home" aria-label="Done">✕</button>' +
      '</div>' +
      '<div class="scroll">' +
        '<div class="sec">' + secHd('THEME') +
          '<div class="opt-list">' + themeRows() + '</div>' +
        '</div>' +
        '<div class="sec">' + secHd('LOGGING') +
          '<button class="opt' + (Store.dropSets ? ' is-on' : '') + '" data-act="toggle-drop-setting">' +
            '<span>DROP SETS</span>' +
            '<span class="opt-val">' + (Store.dropSets ? 'ON' : 'OFF') + '</span>' +
          '</button>' +
        '</div>' +
        '<div class="sec">' + secHd('NOTES') +
          '<button class="opt' + (Store.exerciseRemarks ? ' is-on' : '') + '" data-act="toggle-exercise-remarks-setting">' +
            '<span>EXERCISE REMARKS</span>' +
            '<span class="opt-val">' + (Store.exerciseRemarks ? 'ON' : 'OFF') + '</span>' +
          '</button>' +
          '<button class="opt' + (Store.workoutRemarks ? ' is-on' : '') + '" data-act="toggle-workout-remarks-setting">' +
            '<span>WORKOUT REMARKS</span>' +
            '<span class="opt-val">' + (Store.workoutRemarks ? 'ON' : 'OFF') + '</span>' +
          '</button>' +
        '</div>' +
        '<div class="sec">' + secHd('TIMER') +
          '<button class="opt" data-act="default-rest">' +
            '<span>DEFAULT REST FOR NEW WORKOUTS</span>' +
            '<span class="opt-val">' + Store.rest + 'S</span>' +
          '</button>' +
          /* A phone notification when rest ends, so the alert lands with the
           * app in the background. Notification sound mixes with music — it
           * does not pause it. See the Notify block in app.js. */
          '<button class="opt' + (Store.restAlerts ? ' is-on' : '') + '" data-act="toggle-rest-alerts">' +
            '<span>REST END NOTIFICATION</span>' +
            '<span class="opt-val">' + (Store.restAlerts ? 'ON' : 'OFF') + '</span>' +
          '</button>' +
        '</div>' +
        '<div class="sec">' + secHd('DATA') +
          /* Backup first, restore second, destroy last — ordered by how often
           * you want them and how much damage they do. Only RESET is accent
           * (danger); export and import are ordinary rows. */
          '<button class="opt" data-act="export-data">' +
            '<span>EXPORT BACKUP</span>' +
            '<span class="opt-val">' + plural(Store.sessions.length, 'session') + '</span>' +
          '</button>' +
          '<button class="opt" data-act="import-data">' +
            '<span>IMPORT BACKUP</span><span class="opt-val">→</span>' +
          '</button>' +
          '<button class="opt is-danger" data-act="reset-data">' +
            '<span>RESET ALL DATA</span><span class="opt-val">→</span>' +
          '</button>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* The bottom tab bar shared by the two home tabs. */
  function tabBar(active) {
    return '<div class="tabbar">' +
      '<button class="tab' + (active === 'workouts' ? ' is-on' : '') + '" data-act="tab-workouts">WORKOUTS</button>' +
      '<button class="tab' + (active === 'log' ? ' is-on' : '') + '" data-act="tab-log">DATA LOG</button>' +
    '</div>';
  }

  /* ── Home ────────────────────────────────────────────────── */
  function home(edit) {
    var lead = Store.leadWorkoutIndex();
    var rows = Store.workouts.map(function (w, i) {
      var p = Store.progress(w);
      var status = p.started
        ? (p.logged >= p.total ? 'COMPLETE' : p.logged + ' / ' + p.total + ' SETS')
        : '';
      return '<button class="card' + (i === lead && !edit ? ' is-lead' : '') + '" ' +
        'data-act="' + (edit ? 'workout-settings' : 'open-workout') + '" data-w="' + w.id + '">' +
        '<span class="card-body"><span class="card-name">' + esc(w.name) + '</span>' +
          '<span class="sub">' + plural(w.exercises.length, 'exercise') +
          (w.restEnabled ? ' · rest ' + w.rest + 's' : '') + '</span></span>' +
        '<span class="card-right">' +
          (status ? '<span class="status' + (p.logged >= p.total ? '' : ' is-idle') + '">' + status + '</span>' : '') +
          (edit
            ? '<span class="del-btn" data-act="del-workout" data-w="' + w.id + '">✕</span>'
            : '<span class="arrow">→</span>') +
        '</span></button>';
    }).join('');

    return '<div class="screen">' +
      '<div class="hd">' +
        '<div class="hd-mid"><div class="title">MY WORKOUTS</div>' +
        (edit ? '<div class="sub">Tap a workout to edit it</div>' : '') + '</div>' +
        '<button class="icon-btn" data-act="open-settings" aria-label="Settings">' + ICON.gear + '</button>' +
      '</div>' +
      '<div class="scroll">' +
        /* nothing to count or edit until the first workout exists */
        (rows
          ? '<div class="sec-hd" style="margin-top:16px">' +
              '<span class="sec-note">' + plural(Store.workouts.length, 'workout') + '</span>' +
              '<button class="txt-btn' + (edit ? ' is-on' : '') + '" data-act="toggle-edit">' + (edit ? 'DONE' : 'EDIT') + '</button>' +
            '</div>' +
            '<div class="list" style="margin-top:0">' + rows + '</div>'
          : '') +
        /* the new-workout button sits right under the last workout */
        '<button class="btn btn-accent" data-act="new-workout" style="margin-top:10px">+ NEW WORKOUT</button>' +
      '</div>' +
      tabBar('workouts') +
    '</div>';
  }

  /* ── Data log: pick a workout ────────────────────────────── */
  function dataLog() {
    /* highlight whichever workout was logged most recently, not just the first */
    var newest = null, newestId = null;
    Store.workouts.forEach(function (w) {
      var list = Store.sessionsFor(w.id);
      if (list.length && (!newest || list[0].date > newest)) {
        newest = list[0].date;
        newestId = w.id;
      }
    });

    var rows = Store.workouts.map(function (w) {
      var stats = Store.sessionStats(w.id);
      /* nothing logged yet reads as dimmed — there's nothing in there to see */
      return '<button class="card' + (w.id === newestId ? ' is-lead' : '') +
        (stats.sessions ? '' : ' is-empty') + '" data-act="open-log-workout" data-w="' + w.id + '">' +
        '<span class="card-body"><span class="card-name">' + esc(w.name) + '</span>' +
          '<span class="sub">' + (stats.sessions
            ? plural(stats.sessions, 'session') + ' · ' + plural(stats.sets, 'set')
            : 'No sessions yet') + '</span></span>' +
        '<span class="card-right"><span class="arrow">→</span></span>' +
      '</button>';
    }).join('');

    return '<div class="screen">' +
      '<div class="hd">' +
        '<div class="hd-mid"><div class="title">DATA LOG</div>' +
        '<div class="sub">Select a workout to view its data</div></div>' +
        '<button class="icon-btn" data-act="open-settings" aria-label="Settings">' + ICON.gear + '</button>' +
      '</div>' +
      '<div class="scroll">' +
        (rows ? '<div class="list" style="margin-top:18px">' + rows + '</div>'
              : '<div class="empty">No workouts yet</div>') +
      '</div>' +
      tabBar('log') +
    '</div>';
  }

  /* "2026-07-29T…" → "JUL 29" */
  function shortDate(iso) {
    var MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    var d = new Date(iso);
    if (isNaN(d)) return '—';
    return MONTHS[d.getMonth()] + ' ' + d.getDate();
  }

  function progressRow(r) {
    return '<div class="prow' + (r.drop ? ' is-drop' : '') + '">' +
      '<div class="prow-date">' + shortDate(r.date) + '</div>' +
      '<div class="prow-set">' + esc(r.set) + '</div>' +
      '<div>' + r.weight + 'kg</div>' +
      '<div class="prow-reps">' + r.reps + '</div>' +
    '</div>';
  }

  /* ── e1RM chart ───────────────────────────────────────────
   * X = sessions in order, Y = estimated 1RM in 5kg steps. The Y axis is
   * deliberately broken: a 0 tick sits at the origin, then a slashed gap,
   * then the real scale starting at the first session's e1RM floored to a
   * multiple of 5 — otherwise every point would be squashed into the top
   * of a chart that's mostly empty space below it.
   * Drawn as inline SVG with a viewBox, so the collapsed card just renders
   * the same graph at a smaller CSS height. */
  function e1rmChart(series, axis, expanded) {
    var W = 320;
    var H = expanded ? 210 : 150;
    var padL = 34, padR = 10, padT = 12;
    var padB = expanded ? 30 : 24;
    var x0 = padL, x1 = W - padR;
    var yTop = padT, yBot = H - padB;

    /* 0 sits on the axis floor; the break eats the first slice of height */
    var breakH = 12;
    var yZero = yBot;
    var yScaleTop = yTop;
    var yScaleBot = yBot - breakH;
    var span = axis.top - axis.base || 5;

    function yOf(v) {
      var t = (v - axis.base) / span;
      return yScaleBot - t * (yScaleBot - yScaleTop);
    }
    function xOf(i) {
      if (series.length === 1) return (x0 + x1) / 2;
      return x0 + (i / (series.length - 1)) * (x1 - x0);
    }

    var parts = [];

    /* gridlines + y tick labels */
    axis.ticks.forEach(function (v) {
      var y = yOf(v).toFixed(1);
      parts.push('<line x1="' + x0 + '" y1="' + y + '" x2="' + x1 + '" y2="' + y +
        '" class="cg-grid"/>');
      /* dy rather than dominant-baseline:middle — Safari has long-standing
       * bugs with that attribute on SVG text, and this centres identically
       * everywhere */
      parts.push('<text x="' + (x0 - 5) + '" y="' + y + '" dy="0.32em" class="cg-ylab" text-anchor="end">' + v + '</text>');
    });
    /* the 0 tick below the break */
    parts.push('<text x="' + (x0 - 5) + '" y="' + yZero + '" dy="0.32em" class="cg-ylab" text-anchor="end">0</text>');

    /* axes */
    parts.push('<line x1="' + x0 + '" y1="' + yTop + '" x2="' + x0 + '" y2="' + yZero + '" class="cg-axis"/>');
    parts.push('<line x1="' + x0 + '" y1="' + yZero + '" x2="' + x1 + '" y2="' + yZero + '" class="cg-axis"/>');

    /* break marker: two slashes across the y axis */
    var yb = yScaleBot + breakH / 2;
    parts.push('<line x1="' + (x0 - 4) + '" y1="' + (yb + 3) + '" x2="' + (x0 + 4) + '" y2="' + (yb - 2) + '" class="cg-axis"/>');
    parts.push('<line x1="' + (x0 - 4) + '" y1="' + (yb + 6) + '" x2="' + (x0 + 4) + '" y2="' + (yb + 1) + '" class="cg-axis"/>');

    /* the line through the sessions */
    if (series.length > 1) {
      var d = series.map(function (p, i) {
        return (i ? 'L' : 'M') + xOf(i).toFixed(1) + ' ' + yOf(p.e1rm).toFixed(1);
      }).join(' ');
      parts.push('<path d="' + d + '" class="cg-line"/>');
    }

    /* Sparkline rule: once points sit closer than ~10px the markers stop
     * being data and turn into a smear, so drop them and let the line carry
     * the trend. The most recent point keeps its dot as an anchor for
     * "where you are now". The viewBox is 320 wide and renders at ~315px,
     * so a unit here is near enough a pixel. */
    var spacing = series.length > 1 ? (x1 - x0) / (series.length - 1) : Infinity;
    var showDots = spacing >= 10;

    /* Pick which sessions get a date label: an even spread, always including
     * the last one. Drop the penultimate pick if it would collide with the
     * final label — a date is ~34 units wide at this font size. */
    var step = Math.ceil(series.length / (expanded ? 8 : 5));
    var labelAt = {};
    var picks = [];
    for (var k = 0; k < series.length - 1; k += step) picks.push(k);
    if (picks.length && (series.length - 1 - picks[picks.length - 1]) * spacing < 34) picks.pop();
    picks.push(series.length - 1);
    picks.forEach(function (k) { labelAt[k] = true; });

    /* points, value labels, and session ticks along the bottom */
    series.forEach(function (p, i) {
      var cx = xOf(i), cy = yOf(p.e1rm);
      var isLast = i === series.length - 1;
      if (showDots || isLast) {
        parts.push('<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' +
          (expanded ? 4 : 3) + '" class="cg-dot"/>');
      }
      /* value labels would collide at the same density the dots do */
      if (expanded && (showDots || isLast)) {
        parts.push('<text x="' + cx.toFixed(1) + '" y="' + (cy - 9).toFixed(1) +
          '" class="cg-val" text-anchor="middle">' + Math.round(p.e1rm) + '</text>');
      }
      if (labelAt[i]) {
        parts.push('<text x="' + cx.toFixed(1) + '" y="' + (yZero + 12) +
          '" class="cg-xlab" text-anchor="middle">' + shortDate(p.date) + '</text>');
      }
    });

    return '<svg class="cg" viewBox="0 0 ' + W + ' ' + H + '" ' +
      'style="height:' + H + 'px" preserveAspectRatio="xMidYMid meet" ' +
      'role="img" aria-label="Estimated 1RM across ' + series.length + ' sessions">' +
      parts.join('') + '</svg>';
  }

  /* ── Data log: one workout's progress, exercise by exercise ── */
  /* Range scoping, expanded view only — collapsed always shows the whole
   * graph, which is what it's for. */
  function rangeRow(active, full, shown) {
    var opts = [['1m', '1M'], ['3m', '3M'], ['6m', '6M'], ['all', 'ALL']];
    return '<div class="cg-range">' +
      opts.map(function (o) {
        return '<button class="cg-rbtn' + (active === o[0] ? ' is-on' : '') +
          '" data-act="log-range" data-r="' + o[0] + '">' + o[1] + '</button>';
      }).join('') +
      '<span class="cg-rcount">' + (shown < full ? shown + ' of ' + full : full + ' sessions') + '</span>' +
    '</div>';
  }

  /* All three views stacked on one page: by exercise, by day, then the e1RM
   * graph. The ‹ › arrows drive both the table and the graph so the page
   * always describes a single exercise — the first one on arrival. */
  function logWorkout(w, idx, tableExpanded, graphExpanded, range) {
    var exercises = Store.loggedExercises(w.id);
    var stats = Store.sessionStats(w.id);
    if (!exercises.length) {
      return '<div class="screen">' +
        logHeader(w, null) +
        '<div class="scroll"><div class="empty">Nothing logged yet<br>Finish a workout to see it here</div></div>' +
      '</div>';
    }

    var i = Math.min(Math.max(idx, 0), exercises.length - 1);
    var ex = exercises[i];

    /* ── 1. by exercise ── */
    var all = Store.exerciseHistory(w.id, ex.id);
    var rows;
    if (tableExpanded) {
      rows = all;
    } else {
      var latest = all.length ? all[0].date : null;
      rows = all.filter(function (r) { return r.date === latest; });
    }
    var tableCard = '<div class="ptable" role="button" tabindex="0" data-act="toggle-table-expand">' +
      '<div class="ptable-name">' + esc(ex.name) +
        '<span class="ptable-unit">BY EXERCISE</span></div>' +
      '<div class="prow phead"><div>DATE</div><div>SET</div><div>WEIGHT</div><div>REPS</div></div>' +
      '<div class="ptable-body' + (tableExpanded ? ' is-expanded' : '') + '">' +
        (rows.length ? rows.map(progressRow).join('')
                     : '<div class="prow-empty">No sets logged for this exercise</div>') +
      '</div>' +
      '<div class="ptable-hint">' + (tableExpanded ? 'TAP TO COLLAPSE' : 'TAP TO VIEW FULL HISTORY') + '</div>' +
    '</div>';

    /* ── 3. e1RM graph, same exercise as the table above ── */
    var full = Store.e1rmSeries(w.id, ex.id);
    var series = graphExpanded ? Store.windowSeries(full, range) : full;
    var axis = Store.e1rmAxis(series);
    var graphCard = '<div class="ptable" role="button" tabindex="0" style="margin-top:14px" data-act="toggle-graph-expand">' +
      '<div class="ptable-name">' + esc(ex.name) +
        '<span class="ptable-unit">EST. 1RM · KG</span></div>' +
      (axis
        ? (graphExpanded ? rangeRow(range, full.length, series.length) : '') +
          e1rmChart(series, axis, graphExpanded) +
          '<div class="ptable-hint">' +
            (graphExpanded ? 'TAP TO COLLAPSE' : 'TAP TO EXPAND · ' + plural(full.length, 'session')) +
          '</div>'
        : '<div class="prow-empty">No sets logged for this exercise</div>') +
    '</div>';

    /* ── Session notes ──
     * The read side of the workout-remarks feature. Renders NOTHING when no
     * session has a note — no empty state, no explanatory text, per the
     * standing preference for less UI. Sits below the graph because it's
     * reference material, not something you scan every visit.
     * Note: unlike the table and the graph, this is NOT filtered by the ‹ ›
     * exercise selector — a session note is about the whole session. */
    var notes = Store.sessionNotes(w.id);
    var notesCard = notes.length
      ? '<div class="ptable" style="margin-top:14px">' +
          '<div class="ptable-name">SESSION NOTES' +
            '<span class="ptable-unit">' + plural(notes.length, 'note') + '</span></div>' +
          notes.map(function (n) {
            return '<div class="note-row">' +
              '<div class="note-hd">' + shortDate(n.date) +
                (n.rating === null || n.rating === undefined ? '' : '<span>' + n.rating + '/10</span>') +
              '</div>' +
              '<div class="note-body">' + esc(n.remarks) + '</div>' +
            '</div>';
          }).join('') +
        '</div>'
      : '';

    return '<div class="screen">' +
      logHeader(w, ex.name) +

      '<div class="ex-nav">' +
        '<button class="ex-arrow" data-act="log-prev-ex"' + (i === 0 ? ' disabled' : '') + '>‹</button>' +
        '<div class="ex-nav-name">' + esc(ex.name) + '<span>' + (i + 1) + ' / ' + exercises.length + '</span></div>' +
        '<button class="ex-arrow" data-act="log-next-ex"' + (i === exercises.length - 1 ? ' disabled' : '') + '>›</button>' +
      '</div>' +

      '<div class="scroll">' +
        tableCard +

        /* ── 2. by day ── */
        '<button class="card" style="margin-top:14px" data-act="open-day-sheet">' +
          '<span class="card-body"><span class="card-name sm">FULL LOG</span>' +
            '<span class="sub">BY DAY · ' + plural(stats.sessions, 'session') + ' · ' + plural(stats.sets, 'set') + '</span></span>' +
          '<span class="card-right"><span class="arrow is-accent">⊞</span></span>' +
        '</button>' +

        graphCard +
        notesCard +
      '</div>' +
    '</div>';
  }

  function logHeader(w, exName) {
    return '<div class="hd">' +
      '<button class="icon-btn" data-act="tab-log" aria-label="Back">←</button>' +
      '<div class="hd-mid"><div class="title md">' + esc(w.name) + '</div>' +
        (exName ? '<div class="sub on-accent">' + esc(exName) + '</div>' : '') +
      '</div>' +
    '</div>';
  }

  /* ── Data log: the spreadsheet view, every set by day ────── */
  function daySheet(w) {
    var rows = Store.daySheetRows(w.id);
    var cells = rows.map(function (r) {
      return '<div class="xc">' + shortDate(r.date) + '</div>' +
        '<div class="xc">' + esc(r.exercise) + '</div>' +
        '<div class="xc">' + esc(r.set) + '</div>' +
        '<div class="xc">' + r.weight + 'kg</div>' +
        '<div class="xc xc-reps">' + r.reps + '</div>' +
        '<div class="xc">' + (r.rating === null ? '—' : r.rating + '/10') + '</div>' +
        '<div class="xc">' + Store.formatDuration(r.durationMs) + '</div>';
    }).join('');

    return '<div class="screen sheet-screen">' +
      '<div class="hd">' +
        '<button class="icon-btn" data-act="open-log-workout" data-w="' + w.id + '" aria-label="Back">←</button>' +
        '<div class="hd-mid"><div class="title md">' + esc(w.name) + ' — FULL LOG</div>' +
        '<div class="sub">Every set, newest first</div></div>' +
      '</div>' +
      (rows.length
        ? '<div class="xwrap"><div class="xgrid">' +
            '<div class="xc xh">DATE</div><div class="xc xh">EXERCISE</div><div class="xc xh">SET</div>' +
            '<div class="xc xh">WEIGHT</div><div class="xc xh">REPS</div><div class="xc xh">RATING</div>' +
            '<div class="xc xh">TIME</div>' +
            cells +
          '</div></div>'
        : '<div class="scroll"><div class="empty">Nothing logged yet</div></div>') +
    '</div>';
  }

  /* ── Workout (exercise list) ─────────────────────────────── */
  function workout(w, edit) {
    var next = Store.nextExerciseIndex(w);
    var p = Store.progress(w);

    var rows = w.exercises.map(function (e, i) {
      var done = Store.exerciseDone(e);
      var rest = Store.effectiveRest(w, e);
      var status = e.log.length
        ? (done ? 'DONE · ' + Store.totalReps(e) + ' REPS' : e.log.length + ' / ' + e.sets + ' LOGGED')
        : '';
      /* rest is either on for this exercise (accent) or off (gray) — whether it
       * came from the workout or an override is detail for the sheet */
      var chips = '<span class="mini' + (rest.enabled ? ' is-on' : '') + '" data-act="exercise-rest" data-e="' + e.id + '">' +
          (rest.enabled
            ? 'REST ON' + (rest.source === 'exercise' ? ' · ' + rest.seconds + 'S' : '')
            : 'REST OFF') + '</span>';

      return '<button class="card' + (i === next && !edit ? ' is-lead' : '') + '" ' +
        'data-act="' + (edit ? 'edit-exercise' : 'open-exercise') + '" data-e="' + e.id + '">' +
        '<span class="card-body">' +
          '<span class="card-name sm">' + esc(e.name) + '</span>' +
          '<span class="sub">' + e.sets + ' sets × ' + e.target + ' reps · ' + e.weight + ' kg' +
            (Store.exerciseRemarks && e.remarks.trim() ? ' · ✎' : '') + '</span>' +
          '<span class="mini-row">' + chips + '</span>' +
        '</span>' +
        '<span class="card-right">' +
          (status ? '<span class="status' + (done ? '' : ' is-idle') + '">' + status + '</span>' : '') +
          (edit
            /* ⚠ These MUST be <span>, never <button>: the whole card is already
             * a <button>, and the HTML parser silently auto-closes an outer
             * button at the first nested one, which breaks the layout in a way
             * that looks like a CSS bug. Delegation works on any element.
             * See docs/05-GOTCHAS-AND-TIPS.md §1.1.
             * The arrows are dimmed rather than removed at the ends of the
             * list, so the row's controls don't jump around as you reorder. */
            ? '<span class="ord-btn' + (i === 0 ? ' is-off' : '') + '" data-act="move-exercise" data-e="' + e.id + '" data-d="-1">↑</span>' +
              '<span class="ord-btn' + (i === w.exercises.length - 1 ? ' is-off' : '') + '" data-act="move-exercise" data-e="' + e.id + '" data-d="1">↓</span>' +
              '<span class="del-btn" data-act="del-exercise" data-e="' + e.id + '">✕</span>'
            : '<span class="arrow">→</span>') +
        '</span></button>';
    }).join('');

    return '<div class="screen">' +
      '<div class="hd">' +
        '<button class="icon-btn" data-act="home" aria-label="Back">←</button>' +
        '<div class="hd-mid"><div class="title md">' + esc(w.name) + '</div>' +
        '<div class="sub' + (Store.isActive(w.id) ? ' on-accent' : '') + '">' +
          (Store.isActive(w.id) ? '● In progress · ' : '') +
          plural(w.exercises.length, 'exercise') +
          (p.total ? ' · ' + p.logged + ' / ' + p.total + ' sets' : '') + '</div></div>' +
        '<button class="icon-btn" data-act="open-timer" aria-label="Timer">' + ICON.clock + '</button>' +
      '</div>' +

      '<div class="scroll">' +
        '<div class="sec-hd" style="margin-top:16px">' +
          '<span class="sec-note">Exercises</span>' +
          '<button class="txt-btn' + (edit ? ' is-on' : '') + '" data-act="toggle-edit">' + (edit ? 'DONE' : 'EDIT') + '</button>' +
        '</div>' +
        (rows ? '<div class="list" style="margin-top:0">' + rows + '</div>'
              : '<div class="empty">No exercises yet<br>Add your first one below</div>') +
        '<div style="margin-top:10px"><button class="btn btn-accent" data-act="new-exercise">+ ADD EXERCISE</button></div>' +
        (Store.workoutRemarks ? workoutRemarksSection(w) : '') +
        (p.started ? '<div style="margin-top:16px"><button class="btn btn-quiet" data-act="reset-workout" data-w="' + w.id + '">CLEAR SETS</button></div>' : '') +
      '</div>' +
      /* The session button lives in the fixed .cta bar at the bottom.
       * START is solid accent — it is the hero action of this screen.
       * END is the OUTLINED accent (.btn-outline), not solid, because it does
       * something far more consequential: it freezes the session into the data
       * log and wipes the workout clean. Same slot, same colour family,
       * deliberately different weight — you should not be able to end a
       * session by muscle-memory-tapping where START used to be.
       * ⚠ Both previously used .btn-invert (a solid white/black block). That
       *   was changed on request: it read as foreign against the black-and-red
       *   theme. .btn-invert is still used by COMPLETE SET on the exercise
       *   screen. */
      '<div class="cta">' +
        (Store.isActive(w.id)
          ? '<button class="btn btn-outline" data-act="end-workout" data-w="' + w.id + '">END WORKOUT</button>'
          : '<button class="btn btn-accent" data-act="start-workout" data-w="' + w.id + '">START WORKOUT</button>') +
      '</div>' +
    '</div>';
  }

  /* ── Workout rating: 1–10 across one continuous colour ramp ── */
  /* The 1–10 strip. Used by the end-of-workout prompt; `act` names the action
   * each tile fires so the sheet can own its own selection handling. */
  function ratingTiles(picked, act) {
    return RATINGS.map(function (r) {
      return '<button class="rate' + (r.n === picked ? ' is-sel' : '') + '" data-act="' + act + '" data-n="' + r.n + '"' +
        ' style="background:' + r.bg + ';color:' + r.fg + '" aria-label="Rate ' + r.n + ' out of 10">' +
        '<span class="rate-num">' + r.n + '</span></button>';
    }).join('');
  }

  /* Free-text notes on the whole session — off by default, turned on in
   * Settings → NOTES. Same autosave pattern as an exercise's remarks. */
  function workoutRemarksSection(w) {
    var saved = w.remarks.trim() ? 'SAVED' : 'EMPTY';
    return '<div class="sec">' +
      secHd('WORKOUT REMARKS', '<span class="sec-note' + (w.remarks.trim() ? ' is-ok' : '') + '" data-workout-save-state>' + saved + '</span>') +
      '<textarea class="pad" data-workout-remarks placeholder="How did the whole session go?">' + esc(w.remarks) + '</textarea>' +
      '<div style="margin-top:10px"><button class="btn btn-quiet" data-act="save-workout-remarks">SAVE REMARKS</button></div>' +
    '</div>';
  }

  /* ── Exercise: counter + set log + timer + remarks ───────── */
  function val(value, label, live) {
    return '<span class="log-val"><b' + (live ? ' data-reps' : '') + '>' + value + '</b><span>' + label + '</span></span>';
  }

  function segLine(label, reps, weight) {
    return '<span class="lr-seg"><span>' + label + '</span><span>' + reps + ' × ' + weight + ' KG</span></span>';
  }

  function exercise(w, e) {
    var done = Store.exerciseDone(e);
    var setNum = Math.min(e.log.length + 1, e.sets);
    var rest = Store.effectiveRest(w, e);

    /* completed sets — gray, tappable, with their drop segments listed */
    var logged = e.log.map(function (entry, i) {
      var drops = entry.drops.map(function (d, k) {
        return segLine('DROP ' + (k + 1), d.reps, d.weight);
      }).join('');
      return '<button class="log-row is-done" data-act="edit-log" data-i="' + i + '">' +
        '<span class="lr-main">' +
          '<span class="log-set">SET ' + (i + 1) + '</span>' +
          '<span class="log-vals">' + val(entry.reps, 'REPS') + val(entry.weight, 'KG') +
            '<span class="log-edit">✎</span></span>' +
        '</span>' +
        (drops ? '<span class="lr-segs">' + drops + '</span>' : '') +
      '</button>';
    }).join('');

    /* the set being worked on right now — highlighted, live rep count */
    var current = '';
    if (!done) {
      var segs = e.draftDrops.map(function (d, k) {
        return segLine(k === 0 ? 'MAIN' : 'DROP ' + k, d.reps, d.weight);
      }).join('');
      var nowLabel = e.draftDrops.length
        ? 'SET ' + setNum + ' · DROP ' + e.draftDrops.length
        : 'SET ' + setNum + ' · NOW';
      current = '<div class="log-row is-now">' +
        '<span class="lr-main">' +
          '<span class="log-set">' + nowLabel + '</span>' +
          '<span class="log-vals">' + val(e.draft, 'REPS', true) + val(e.weight, 'KG') + '</span>' +
        '</span>' +
        (segs ? '<span class="lr-segs">' + segs + '</span>' : '') +
      '</div>';
    }

    /* sets still to come — full-strength, not yet touched */
    var todo = '';
    for (var i = e.log.length + 1; i < e.sets; i++) {
      todo += '<div class="log-row is-todo">' +
        '<span class="lr-main">' +
          '<span class="log-set">SET ' + (i + 1) + '</span>' +
          '<span class="log-vals">' + val('—', 'REPS') + val(e.weight, 'KG') + '</span>' +
        '</span></div>';
    }

    return '<div class="screen">' +
      '<div class="hd">' +
        '<button class="icon-btn" data-act="open-workout" data-w="' + w.id + '" aria-label="Back">←</button>' +
        '<div class="hd-mid" style="text-align:center">' +
          '<div class="title sm">' + esc(e.name) + '</div>' +
          '<div class="sub on-accent">' +
            '<button class="txt-btn" data-act="set-dec" style="color:inherit">−</button>' +
            'SET ' + (done ? e.sets : setNum) + ' OF ' + e.sets +
            '<button class="txt-btn" data-act="set-inc" style="color:inherit">+</button>' +
          '</div>' +
        '</div>' +
        '<button class="icon-btn" data-act="open-timer" aria-label="Timer">' + ICON.clock + '</button>' +
      '</div>' +

      timerBar(rest) +

      '<div class="scroll">' +
        '<div class="counter-wrap">' +
          '<button class="counter" data-act="tap" data-counter>' +
            '<span class="reps" data-reps>' + e.draft + '</span>' +
            '<span class="cap">TAP TO COUNT</span>' +
          '</button>' +
          '<div class="fine">' +
            '<button data-act="rep-dec">−1</button>' +
            '<button data-act="rep-zero">CLEAR</button>' +
            '<button data-act="rep-inc">+1</button>' +
          '</div>' +
        '</div>' +

        /* weight is the thing that changes session to session — keep it big */
        '<div class="wstrip">' +
          '<button class="wstep" data-act="weight-step" data-d="-2.5">−2.5</button>' +
          '<button class="wval" data-act="edit-weight"><b>' + e.weight + '</b><span>KG · TAP TO TYPE</span></button>' +
          '<button class="wstep" data-act="weight-step" data-d="2.5">+2.5</button>' +
        '</div>' +
        '<div class="wnote">' + Store.totalReps(e) + ' reps logged so far' +
          '</div>' +

        '<div class="sec">' +
          secHd('SET LOG',
            e.draftDrops.length
              ? '<button class="txt-btn is-on" data-act="undo-drop">UNDO DROP</button>'
              : (e.log.length ? '<button class="txt-btn" data-act="clear-log">CLEAR LOG</button>'
                              : '<span class="sec-note">Nothing logged yet</span>')) +
          logged + current + todo +
        '</div>' +

        (Store.exerciseRemarks
          ? '<div class="sec">' +
              secHd('REMARKS', '<span class="sec-note' + (e.remarks.trim() ? ' is-ok' : '') + '" data-save-state>' +
                (e.remarks.trim() ? 'SAVED' : 'EMPTY') + '</span>') +
              '<textarea class="pad" data-remarks placeholder="Form cues, aches, what to try next time…">' + esc(e.remarks) + '</textarea>' +
              '<div style="margin-top:10px"><button class="btn btn-quiet" data-act="save-remarks">SAVE REMARKS</button></div>' +
            '</div>'
          : '') +
      '</div>' +

      '<div class="cta">' +
        (done
          ? '<div class="btn-row">' +
              '<button class="btn btn-quiet" data-act="set-inc">+ EXTRA SET</button>' +
              '<button class="btn btn-invert" data-act="open-workout" data-w="' + w.id + '">EXERCISE DONE</button>' +
            '</div>'
          : (Store.dropSets
              ? '<div class="btn-row">' +
                  '<button class="btn btn-quiet" data-act="add-drop">+ DROP</button>' +
                  '<button class="btn btn-invert" data-act="complete-set">COMPLETE SET</button>' +
                '</div>'
              : '<button class="btn btn-invert" data-act="complete-set">COMPLETE SET</button>')) +
      '</div>' +
    '</div>';
  }

  /* Compact rest timer that rides along on the exercise screen. */
  function timerBar(rest) {
    var label;
    if (Timer.finished) label = 'REST DONE — NEXT SET';
    else if (Timer.mode !== 'rest') label = 'STOPWATCH';
    else if (!rest.enabled) label = 'REST OFF · TAP TO SET';
    else label = 'REST ' + rest.seconds + 'S · ' + (rest.source === 'exercise' ? 'EXERCISE' : 'WORKOUT');

    return '<div class="timerbar' + (Timer.finished ? ' is-done' : '') + '" data-timer-bar>' +
      '<div class="tb-time" data-timer-display>' + Timer.display() + '</div>' +
      '<button class="tb-label" data-act="exercise-rest" data-tb-label>' + label + '</button>' +
      '<button class="chip' + (Timer.running ? ' is-on' : '') + '" data-act="timer-toggle" data-timer-btn>' +
        (Timer.running ? 'PAUSE' : 'START') + '</button>' +
      '<button class="chip" data-act="timer-reset">RESET</button>' +
    '</div>';
  }

  /* The big ON/OFF switch for the rest timer that applies here — the
   * workout's overall timer, or one exercise's override. This is the
   * prominent control; the small REST ON/OFF chip on a card still exists as
   * a shortcut back to the same setting. */
  function restPanel(ctx) {
    var scope = ctx.kind === 'exercise' ? 'FOR ' + ctx.name : 'FOR ' + ctx.name + ' · ALL EXERCISES';
    return '<div class="rest-panel">' +
      '<div class="rest-panel-hd">REST TIMER <span>' + esc(scope) + '</span></div>' +
      '<div class="rest-switch">' +
        '<button class="rest-switch-half' + (ctx.enabled ? '' : ' is-sel') + '" data-act="rest-off">OFF</button>' +
        '<button class="rest-switch-half is-on' + (ctx.enabled ? ' is-sel' : '') + '" data-act="rest-on">ON</button>' +
      '</div>' +
    '</div>';
  }

  /* ── Full timer screen ───────────────────────────────────── */
  function timer(back, context) {
    var CIRC = 2 * Math.PI * 46;
    /* the ring drains as the countdown runs */
    var offset = CIRC * Timer.fraction();
    var presets = [30, 60, 90, 120].map(function (s) {
      var on = Timer.mode === 'rest' && Math.round(Timer.duration / 1000) === s;
      return '<button class="chip' + (on ? ' is-on' : '') + '" data-act="timer-preset" data-s="' + s + '">' + s + 'S</button>';
    }).join('');

    return '<div class="screen">' +
      '<div class="hd">' +
        '<button class="icon-btn" data-act="' + esc(back.act) + '"' +
          (back.w ? ' data-w="' + back.w + '"' : '') + (back.e ? ' data-e="' + back.e + '"' : '') +
          ' aria-label="Back">←</button>' +
        '<div class="hd-mid"><div class="title md">' + (Timer.mode === 'rest' ? 'REST TIMER' : 'STOPWATCH') + '</div>' +
        '<div class="sub">' + (Timer.mode === 'rest' ? 'Counts down · beeps at zero' : 'Counts up · time a set') + '</div></div>' +
      '</div>' +

      '<div class="chip-row">' +
        '<button class="chip' + (Timer.mode === 'rest' ? ' is-on' : '') + '" data-act="timer-mode" data-m="rest">REST TIMER</button>' +
        '<button class="chip' + (Timer.mode === 'stopwatch' ? ' is-on' : '') + '" data-act="timer-mode" data-m="stopwatch">STOPWATCH</button>' +
      '</div>' +

      '<div class="dial"><div class="dial-inner">' +
        '<div class="dial-ring"></div>' +
        (Timer.mode === 'rest'
          ? '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" stroke-dasharray="' + CIRC.toFixed(1) +
            '" stroke-dashoffset="' + offset.toFixed(1) + '" data-timer-ring></circle></svg>'
          : '') +
        '<div class="dial-time" data-timer-display>' + Timer.display() + '</div>' +
        '<div class="dial-sub" data-dial-label>' + (Timer.finished ? 'TIME' : (Timer.running ? 'RUNNING' : 'PAUSED')) + '</div>' +
      '</div></div>' +

      (Timer.mode === 'rest'
        ? '<div class="presets">' + presets +
          '<button class="chip" data-act="timer-custom">SET…</button></div>'
        : '') +

      (context ? restPanel(context) : '') +

      '<div class="cta"><div class="btn-row">' +
        '<button class="btn btn-quiet" data-act="timer-reset">RESET</button>' +
        '<button class="btn btn-accent" data-act="timer-toggle" data-timer-btn>' + (Timer.running ? 'PAUSE' : 'START') + '</button>' +
      '</div></div>' +
    '</div>';
  }

  global.Screens = {
    settings: settings,
    home: home,
    dataLog: dataLog,
    logWorkout: logWorkout,
    daySheet: daySheet,
    workout: workout,
    exercise: exercise,
    timer: timer,
    ratingTiles: ratingTiles
  };
})(window);
