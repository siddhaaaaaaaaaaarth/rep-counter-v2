/* ═══════════════════════════════════════════════════════════════════════════
 * app.js — the wiring. Router, event dispatch, and all action handlers.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Loaded LAST. This is the only file that knows about all the others, and the
 * only one that connects user input to state changes.
 *
 * THE RENDER LOOP  (the central idea of this codebase)
 * ---------------------------------------------------
 *     user taps something
 *          ↓
 *     the ONE delegated listener on #app finds the nearest [data-act]
 *          ↓
 *     actions[name](dataset, event)   ← mutates Store; the ONLY place state changes
 *          ↓
 *     render()
 *          ↓
 *     Screens.foo(...) returns an HTML string
 *          ↓
 *     app.innerHTML = string          ← the ENTIRE screen is replaced
 *
 * There is no virtual DOM and no diffing. At this app's size (a few dozen
 * elements) replacing innerHTML is imperceptibly fast, and it removes a whole
 * class of state-desync bugs: what you see is always a pure function of Store.
 *
 * ⚠ THE TWO DELIBERATE EXCEPTIONS
 *   Full re-render is WRONG in two places, and both bypass it to patch
 *   individual DOM nodes instead:
 *
 *   1. The rep counter (`tap`) updates only [data-reps] text nodes. Re-rendering
 *      on every tap would be wasteful and would fight the tap animation.
 *
 *   2. The timer's onChange subscriber updates [data-timer-display], the
 *      start/pause label, the dial ring and the bar label. It fires ~5×/second;
 *      re-rendering would destroy the remarks textarea's focus and cursor
 *      position while the user is typing in it.
 *
 *   Generalised rule: ANYTHING THAT TICKS OR FIRES WHILE TYPING MUST NOT CALL
 *   render(). This is also why the remarks autosave only writes to Store.
 *
 * ⚠ A RELATED TRAP: never sync state *from* render(). An earlier bug had
 *   syncIdleTimer() called inside render(), so tapping a timer preset triggered
 *   a render that immediately snapped the value back — the presets looked dead.
 *   It is now called once per navigation, from go(). Render must stay a pure
 *   read of state.
 *
 * NAVIGATION
 * ----------
 * `view` is the whole router: {name, wid, eid, exIdx, expanded, logRange, ...}.
 * go(name, opts) sets it, pushes a History entry, and renders. A popstate
 * listener restores `view` from history state, so hardware/swipe back works and
 * closes any open sheet first.
 *
 * ACTION HANDLERS (~52)
 * ---------------------
 * `actions` maps a data-act name to a function receiving (dataset, event).
 * Grouped in source order:
 *   navigation ......... home, open-workout, open-exercise, open-settings,
 *                        open-timer, tab-workouts, tab-log, open-log-workout,
 *                        open-day-sheet
 *   settings ........... pick-theme, default-rest, reset-data, and the three
 *                        feature toggles
 *   workouts/exercises . new-*, edit-*, del-*, workout-settings, workout-rest,
 *                        exercise-rest, reset-workout
 *   counting ........... tap, rep-inc/dec/zero, complete-set, add-drop,
 *                        undo-drop, set-inc/dec, weight-step, edit-weight
 *   set log ............ edit-log, clear-log
 *   sessions ........... start-workout, end-workout
 *   data log ........... log-prev-ex, log-next-ex, toggle-table-expand,
 *                        toggle-graph-expand, log-range
 *   timer .............. timer-toggle/reset/mode/preset/custom, rest-on/off
 *   remarks ............ save-remarks, save-workout-remarks
 *
 * THE THREE SESSION PROMPTS  (see docs/01-PRODUCT-SPEC.md §2)
 * ----------------------------------------------------------
 *   ensureSessionThen()  logging with no session running → offer to start one
 *   leaveWorkoutGuard()  navigating away mid-session → end (save+wipe) or keep
 *   endWorkoutFlow()     always asks the 1–10 rating, then freezes the session
 */
(function (global) {
  'use strict';

  var app = document.getElementById('app');

  /* Circumference of the timer dial's SVG circle (r=46 in a 100×100 viewBox).
   * Used as stroke-dasharray/offset so the ring drains as the countdown runs.
   * ⚠ Must stay in step with the r="46" in Screens.timer(). */
  var RING = 2 * Math.PI * 46;

  /* THE ROUTER. The whole of navigation state lives in this one object:
   *   name          screen id: home | settings | workout | exercise | timer
   *                 | datalog | logworkout | daysheet   (8 screens)
   *   wid, eid      which workout / exercise the screen is about
   *   exIdx         data log: which exercise the ‹ › arrows are on (0-based)
   *   tableExpanded, graphExpanded   data log card expansion (booleans)
   *   logRange      chart window: '1m' | '3m' | '6m' | 'all'  (default 'all')
   * It is serialised into history.state, so it must stay JSON-safe. */
  var view = { name: 'home' };

  /* Where the timer screen's ← goes back to; set by the 'open-timer' action
   * because the timer is reachable from both the workout and exercise screens. */
  var timerBack = { act: 'home' };

  /* Edit mode for the home and workout lists (reveals the ✕ delete buttons).
   * Deliberately NOT part of `view`: it resets on every navigation. */
  var edit = false;

  /* ── Surviving a reload ────────────────────────────────────
   * A phone can throw the app away at any moment: switch to another app for a
   * few minutes and iOS/Android will often discard the page to reclaim memory,
   * then re-run it from scratch when you come back. `view` lives in memory
   * (and in history.state, which a fresh load does not have), so before this
   * the app always reopened on HOME — mid-workout, with the user having to
   * navigate back to where they were. Reported as a real annoyance.
   *
   * So the current screen is mirrored into localStorage on every navigation
   * and restored at boot. This is the same reasoning that already puts
   * activeStartedAt in Store: anything the user would be upset to lose when
   * the OS reclaims the page has to be on disk, not in memory.
   *
   * ⚠ Kept in its OWN key, deliberately not inside Store's blob. This is
   *   throwaway UI position, not user data — it must never be able to corrupt
   *   or bloat the training log, and Store.resetAll() shouldn't have to know
   *   about it. */
  var VIEW_KEY = 'repcounter.view';

  /* ms. How stale a saved screen may be and still be restored. 6 hours
   * comfortably covers "I left the gym app to reply to a text" and any
   * realistic session length, while a genuinely fresh open the next morning
   * still lands on HOME, which is what you want when starting a new day. */
  var VIEW_TTL = 6 * 60 * 60 * 1000;

  /* Pending debounce handles for the two remarks notepads (exercise-level and
   * workout-level). ~500ms after typing stops the text is written to Store. */
  var saveTimer = null;
  var saveTimerW = null;

  /* ── Rest-end notifications ────────────────────────────────
   * The problem: when the app is backgrounded the browser stops running our
   * JavaScript, so the rest alarm can't sound at the right moment. The obvious
   * workaround — keeping audio playing so the page stays awake — was built,
   * tested and REJECTED: holding an audio session open takes audio focus and
   * pauses the user's music for the whole rest. For a gym app that is worse
   * than the bug. ⚠ Do not reintroduce it.
   *
   * Notifications are the right tool instead, for one specific reason:
   * ⚠ A NOTIFICATION SOUND MIXES WITH MUSIC. The OS ducks the music for an
   *   instant and plays the alert over it. Nothing is paused, nothing takes
   *   audio focus. That is the entire reason this approach is acceptable where
   *   the audio one wasn't.
   *
   * Two delivery paths, best first, both feature-detected:
   *
   *   1. NOTIFICATION TRIGGERS — reg.showNotification(..., {showTrigger}).
   *      The OS itself holds the schedule, so it fires at the exact second
   *      even if the page has been frozen or discarded entirely. This is the
   *      one that actually solves the problem. Chrome/Android, and only where
   *      experimental web platform features are enabled — hence the detect.
   *
   *   2. A PAGE TIMER as fallback. Fires whenever the browser next lets our
   *      JS run. On Android that is often close to on time; on iOS a suspended
   *      page may not run it until the user returns, in which case the alert
   *      is late or never arrives. Accepted: iOS has no route to a scheduled
   *      local notification from a web page.
   *
   * Android is expected to work; iOS is expected to remain imperfect. That
   * split was explicitly accepted rather than shipping a fix that fights the
   * user's music on both. */
  var Notify = {
    timeout: null,   /* handle for the path-2 fallback */

    /* Is the browser capable of showing notifications at all? Service-worker
     * notifications are required on Android — `new Notification()` throws
     * there — so a registration is part of the requirement. */
    supported: function () {
      return ('Notification' in global) && !!(global.navigator && navigator.serviceWorker);
    },

    /* Does the OS hold the schedule for us? This is the difference between
     * "fires exactly on time with the app dead" and "fires when the app next
     * wakes up". */
    canTrigger: function () {
      return this.supported() &&
        ('showTrigger' in global.Notification.prototype) &&
        (typeof global.TimestampTrigger !== 'undefined');
    },

    /* Ask once, and only ever from inside a user gesture — completing a set.
     * Browsers reject a permission prompt that isn't tied to a real tap. */
    ask: function () {
      if (!this.supported() || !Store.restAlerts) return;
      if (global.Notification.permission !== 'default') return;
      try {
        var p = global.Notification.requestPermission();
        if (p && p.then) p.then(function () {});
      } catch (err) {
        /* older callback-style API, or blocked — nothing to do either way */
      }
    },

    /* Schedule the "rest is over" alert for `ms` from now. */
    schedule: function (ms, label) {
      this.cancel();
      if (!this.supported() || !Store.restAlerts) return;
      if (global.Notification.permission !== 'granted') return;

      var opts = {
        body: label || 'Time for your next set.',
        /* one tag = one notification: a new rest replaces the old alert
         * instead of stacking a pile of them in the shade */
        tag: 'rest-done',
        renotify: true,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        /* the phone's own alert sound + vibration, which mix with music */
        vibrate: [180, 90, 180, 90, 260],
        requireInteraction: false
      };
      var self = this;

      if (this.canTrigger()) {
        /* PATH 1 — hand the schedule to the OS and forget about it. */
        try {
          opts.showTrigger = new global.TimestampTrigger(Date.now() + ms);
          navigator.serviceWorker.ready.then(function (reg) {
            reg.showNotification('REST DONE', opts)['catch'](function () {
              /* trigger refused after all — fall back to the page timer */
              delete opts.showTrigger;
              self.fallback(ms, opts);
            });
          })['catch'](function () { self.fallback(ms, opts); });
          return;
        } catch (err) {
          delete opts.showTrigger;
        }
      }
      this.fallback(ms, opts);
    },

    /* PATH 2 — our own timer. Only as good as the browser's willingness to
     * keep running us in the background. */
    fallback: function (ms, opts) {
      this.timeout = setTimeout(function () {
        if (!navigator.serviceWorker) return;
        navigator.serviceWorker.ready.then(function (reg) {
          reg.showNotification('REST DONE', opts)['catch'](function () {});
        })['catch'](function () {});
      }, ms);
    },

    /* Drop any pending or already-shown alert: the rest was reset, paused,
     * re-timed, or the user came back and can see the screen for themselves. */
    cancel: function () {
      if (this.timeout) { clearTimeout(this.timeout); this.timeout = null; }
      if (!this.supported()) return;
      try {
        navigator.serviceWorker.ready.then(function (reg) {
          /* includeTriggered also reaches scheduled-but-not-yet-fired ones */
          reg.getNotifications({ tag: 'rest-done', includeTriggered: true })
            .then(function (list) {
              for (var i = 0; i < list.length; i++) list[i].close();
            })['catch'](function () {});
        })['catch'](function () {});
      } catch (err) {
        /* getNotifications unsupported — the tag still prevents stacking */
      }
    }
  };

  /* ── Render ──────────────────────────────────────────────── */
  function render() {
    var w, e;
    switch (view.name) {
      case 'settings':
        app.innerHTML = Screens.settings();
        break;
      case 'workout':
        w = Store.workout(view.wid);
        if (!w) return go('home');
        app.innerHTML = Screens.workout(w, edit);
        break;
      case 'exercise':
        w = Store.workout(view.wid);
        e = w && Store.exercise(view.wid, view.eid);
        if (!e) return go('workout', { wid: view.wid });
        app.innerHTML = Screens.exercise(w, e);
        break;
      case 'timer':
        app.innerHTML = Screens.timer(timerBack, timerContext());
        break;
      case 'datalog':
        app.innerHTML = Screens.dataLog();
        break;
      case 'logworkout':
        w = Store.workout(view.wid);
        if (!w) return go('datalog');
        app.innerHTML = Screens.logWorkout(w, view.exIdx || 0, !!view.tableExpanded,
          !!view.graphExpanded, view.logRange || 'all');
        break;
      case 'daysheet':
        w = Store.workout(view.wid);
        if (!w) return go('datalog');
        app.innerHTML = Screens.daySheet(w);
        break;
      default:
        app.innerHTML = Screens.home(edit);
    }
  }

  /* An untouched clock should already show the rest that applies here, so the
   * bar reads 02:00 before you ever start it. Runs once per navigation (from
   * go()), never from render() itself — otherwise every render an in-screen
   * action triggers (toggling rest on, tapping a preset) would immediately
   * snap the clock back to the stored value and the presets would look dead. */
  function syncIdleTimerForView() {
    var rest;
    if (view.name === 'exercise') {
      var w = Store.workout(view.wid);
      var e = w && Store.exercise(view.wid, view.eid);
      if (!e) return;
      rest = Store.effectiveRest(w, e);
    } else if (view.name === 'timer') {
      rest = Store.effectiveRest(Store.workout(view.wid), current());
    } else {
      return;
    }
    if (!rest || !rest.enabled) return;
    if (Timer.mode === 'rest' && !Timer.running && !Timer.finished && Timer.elapsed() === 0) {
      Timer.duration = rest.seconds * 1000;
    }
  }

  /* The timer screen carries the big, one-tap ON/OFF switch for whichever
   * rest setting applies here — the workout's, or one exercise's override. */
  function timerContext() {
    var w = Store.workout(view.wid);
    var e = view.eid ? Store.exercise(view.wid, view.eid) : null;
    if (!w) return null;
    var rest = Store.effectiveRest(w, e);
    if (e) {
      return {
        kind: 'exercise',
        name: e.name,
        enabled: rest.enabled,
        seconds: rest.seconds,
        overridden: rest.source === 'exercise'
      };
    }
    return {
      kind: 'workout',
      name: w.name,
      enabled: w.restEnabled,
      seconds: w.rest
    };
  }

  /* Mirror the current screen to disk. Called from go() — i.e. once per
   * navigation — and never from render(), which must stay a pure read. */
  function saveView() {
    try {
      localStorage.setItem(VIEW_KEY, JSON.stringify({ v: view, t: Date.now() }));
    } catch (err) {
      /* private mode / quota: losing the position is survivable, carry on */
    }
  }

  /* The screen to reopen on, or null for HOME. Everything it points at is
   * re-validated against Store, because the workout or exercise may have been
   * deleted since — restoring into a screen whose data is gone would bounce
   * the user through an empty render. */
  function restoreView() {
    var saved;
    try {
      saved = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    } catch (err) {
      return null;
    }
    if (!saved || !saved.v || !saved.t) return null;
    if (Date.now() - saved.t > VIEW_TTL) return null;
    var v = saved.v;
    if (!v.name || v.name === 'home') return null;
    if (v.wid && !Store.workout(v.wid)) return null;
    if (v.eid && !Store.exercise(v.wid, v.eid)) return null;
    return v;
  }

  function go(name, opts, replace) {
    view = Object.assign({ name: name }, opts || {});
    edit = false;
    saveView();
    try {
      if (replace) history.replaceState({ v: view }, '');
      else history.pushState({ v: view }, '');
    } catch (err) {
      /* history unavailable (file:// in some browsers) — in-app back still works */
    }
    syncIdleTimerForView();
    render();
    var scroll = app.querySelector('.scroll');
    if (scroll) scroll.scrollTop = 0;
  }

  /* Hardware / swipe back closes a sheet first, then walks the screen stack. */
  global.addEventListener('popstate', function (ev) {
    UI.close();
    if (ev.state && ev.state.v) {
      view = ev.state.v;
      edit = false;
      saveView();   /* going back is a navigation too — keep the mirror current */
      syncIdleTimerForView();
      render();
    }
  });

  /* Coming back to the app after it was backgrounded: the timer's interval was
   * throttled or stopped while we were away, so the numbers on screen can be
   * badly stale. Timer.value() is derived from Date.now() and is therefore
   * already correct — it just hasn't been painted. One emit() refreshes every
   * subscriber immediately, rather than leaving a wrong time on screen until
   * the next 200ms tick.
   * ⚠ Deliberately does NOT touch the audio context. Opening one outside the
   *   moment of the beep takes audio focus and can pause the user's music.
   * ⚠ emit(), never render() — the user may be mid-word in a remarks box. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    Timer.emit();
    /* The user is looking at the screen — the timer bar tells them everything
     * the notification would, so clear it rather than leaving it in the shade. */
    if (!Timer.running) Notify.cancel();
  });

  function current() {
    return Store.exercise(view.wid, view.eid);
  }

  /* ── Live updates (no full re-render) ────────────────────── */
  function paintReps() {
    var e = current();
    if (!e) return;
    var nodes = app.querySelectorAll('[data-reps]');
    for (var i = 0; i < nodes.length; i++) nodes[i].textContent = e.draft;
  }

  function restLabel() {
    if (Timer.finished) return 'REST DONE — NEXT SET';
    if (Timer.mode !== 'rest') return 'STOPWATCH';
    var rest = Store.effectiveRest(Store.workout(view.wid), current());
    if (!rest.enabled) return 'REST OFF · TAP TO SET';
    return 'REST ' + rest.seconds + 'S · ' + (rest.source === 'exercise' ? 'EXERCISE' : 'WORKOUT');
  }

  Timer.onChange(function () {
    var i, nodes;
    nodes = app.querySelectorAll('[data-timer-display]');
    for (i = 0; i < nodes.length; i++) nodes[i].textContent = Timer.display();

    nodes = app.querySelectorAll('[data-timer-btn]');
    for (i = 0; i < nodes.length; i++) {
      nodes[i].textContent = Timer.running ? 'PAUSE' : 'START';
      if (nodes[i].classList.contains('chip')) nodes[i].classList.toggle('is-on', Timer.running);
    }

    var bar = app.querySelector('[data-timer-bar]');
    if (bar) bar.classList.toggle('is-done', Timer.finished);

    var tbLabel = app.querySelector('[data-tb-label]');
    if (tbLabel) tbLabel.textContent = restLabel();

    var dialLabel = app.querySelector('[data-dial-label]');
    if (dialLabel) {
      dialLabel.textContent = Timer.finished ? 'TIME' : (Timer.running ? 'RUNNING' : 'PAUSED');
    }

    var ring = app.querySelector('[data-timer-ring]');
    if (ring) ring.setAttribute('stroke-dashoffset', (RING * Timer.fraction()).toFixed(1));
  });

  /* ── Remarks: autosave while typing, plus an explicit SAVE ─ */
  function flushRemarks(flash) {
    var pad = app.querySelector('[data-remarks]');
    var e = current();
    if (!pad || !e) return;
    Store.updateExercise(view.wid, view.eid, { remarks: pad.value });
    var state = app.querySelector('[data-save-state]');
    if (!state) return;
    state.textContent = flash ? 'SAVED ✓' : (pad.value.trim() ? 'SAVED' : 'EMPTY');
    state.classList.toggle('is-ok', !!pad.value.trim());
    if (flash) {
      setTimeout(function () {
        if (state.isConnected) state.textContent = pad.value.trim() ? 'SAVED' : 'EMPTY';
      }, 1600);
    }
  }

  app.addEventListener('input', function (ev) {
    if (!ev.target.matches('[data-remarks]')) return;
    var state = app.querySelector('[data-save-state]');
    if (state) { state.textContent = 'SAVING…'; state.classList.remove('is-ok'); }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { flushRemarks(false); }, 500);
  });

  /* Same pattern, one level up: notes on the whole workout rather than one
   * exercise. Only rendered when Store.workoutRemarks is on. */
  function flushWorkoutRemarks(flash) {
    var pad = app.querySelector('[data-workout-remarks]');
    var w = Store.workout(view.wid);
    if (!pad || !w) return;
    Store.setWorkoutRemarks(view.wid, pad.value);
    var state = app.querySelector('[data-workout-save-state]');
    if (!state) return;
    state.textContent = flash ? 'SAVED ✓' : (pad.value.trim() ? 'SAVED' : 'EMPTY');
    state.classList.toggle('is-ok', !!pad.value.trim());
    if (flash) {
      setTimeout(function () {
        if (state.isConnected) state.textContent = pad.value.trim() ? 'SAVED' : 'EMPTY';
      }, 1600);
    }
  }

  app.addEventListener('input', function (ev) {
    if (!ev.target.matches('[data-workout-remarks]')) return;
    var state = app.querySelector('[data-workout-save-state]');
    if (state) { state.textContent = 'SAVING…'; state.classList.remove('is-ok'); }
    clearTimeout(saveTimerW);
    saveTimerW = setTimeout(function () { flushWorkoutRemarks(false); }, 500);
  });

  /* ── Ending a workout ─────────────────────────────────────
   * Always asks for the 1–10 rating first — whether END WORKOUT was tapped
   * deliberately or the leave-guard offered it — then files the session into
   * the data log and clears the workout. */
  function endWorkoutFlow(wid, after) {
    var w = Store.workout(wid);
    if (!w) return;
    var picked = 0;

    function sheetHtml() {
      return '<h2>RATE THIS WORKOUT</h2>' +
        '<p class="hint">' + UI.esc(w.name) + ' · how did it go?</p>' +
        '<div class="rate-strip" data-rate-strip>' + Screens.ratingTiles(picked, 'pick-rating') + '</div>' +
        '<div class="rate-label" data-rate-label>' +
          (picked ? picked + ' / 10' : 'TAP A NUMBER · OPTIONAL') + '</div>' +
        '<div class="btn-row" style="margin-top:16px">' +
          '<button class="btn btn-quiet" data-cancel>CANCEL</button>' +
          '<button class="btn btn-accent" data-ok>SAVE &amp; END</button>' +
        '</div>';
    }

    function mount(sheet) {
      /* ⚠ NON-OBVIOUS COUPLING: the rating tiles carry data-act="pick-rating",
       * but there is NO 'pick-rating' entry in the `actions` map. It is handled
       * right here instead, by a capture-phase listener local to this sheet —
       * which is necessary, because the global delegated listener is bound to
       * #app and sheets render into the separate #sheetRoot element. Searching
       * app.js for 'pick-rating' in `actions` will find nothing; this is why. */
      sheet.addEventListener('click', function (ev) {
        var tile = ev.target.closest('[data-act="pick-rating"]');
        if (!tile) return;
        ev.preventDefault();
        ev.stopPropagation();
        var n = Number(tile.dataset.n);
        picked = picked === n ? 0 : n;
        UI.buzz(12);
        sheet.querySelector('[data-rate-strip]').innerHTML = Screens.ratingTiles(picked, 'pick-rating');
        var label = sheet.querySelector('[data-rate-label]');
        label.textContent = picked ? picked + ' / 10' : 'TAP A NUMBER · OPTIONAL';
        label.style.color = picked ? RATINGS[picked - 1].bg : '';
      }, true);

      sheet.querySelector('[data-cancel]').addEventListener('click', UI.close);
      sheet.querySelector('[data-ok]').addEventListener('click', function () {
        UI.close();
        Store.endSession(wid, picked || null);
        UI.buzz(30);
        if (after) after();
        else render();
      });
    }

    UI.open(sheetHtml(), mount);
  }

  /* Logging a set with no session running: offer to start one. */
  function ensureSessionThen(proceed) {
    if (Store.isActive(view.wid) || !view.wid) return proceed();
    var w = Store.workout(view.wid);
    UI.confirm({
      title: 'START THIS WORKOUT?',
      body: 'You haven\'t started ' + (w ? w.name : 'this workout') +
        ' yet. Start it now so this set gets saved to the data log when you finish.',
      okLabel: 'START & LOG',
      onConfirm: function () {
        Store.startSession(view.wid);
        proceed();
      }
    });
  }

  /* Leaving a workout mid-session: end it (save + wipe) or keep the numbers. */
  function leaveWorkoutGuard(nextView) {
    if (!Store.isActive(view.wid)) return nextView();
    var w = Store.workout(view.wid);
    var wid = view.wid;
    UI.confirm({
      title: 'END ' + (w ? w.name : 'WORKOUT') + '?',
      body: 'End the workout and save it to the data log, or leave it running and keep the numbers as they are.',
      okLabel: 'END WORKOUT',
      cancelLabel: 'KEEP RUNNING',
      onConfirm: function () { endWorkoutFlow(wid, nextView); },
      onCancel: nextView
    });
  }

  /* Weight changes session to session, so this is one tap from the counter. */
  function weightSheet(title) {
    var e = current();
    if (!e) return;
    UI.number({
      title: title,
      hint: e.name,
      label: 'KG FOR THE SETS YOU LOG FROM NOW ON',
      value: e.weight,
      min: 0,
      max: 1000,
      step: 2.5,
      onSave: function (v) { Store.updateExercise(view.wid, view.eid, { weight: v }); render(); }
    });
  }

  /* ── Rest-timer sheet: exercise override beats the workout ─ */
  function restSheet(wid, eid, after) {
    var w = Store.workout(wid);
    var e = Store.exercise(wid, eid);
    if (!w || !e) return;
    var mode = (e.restOverride === null || e.restOverride === undefined)
      ? 'inherit' : (e.restOverride === 0 ? 'off' : 'custom');
    var secs = e.restOverride > 0 ? e.restOverride : (w.rest || Store.rest);

    var html = '<h2>REST TIMER</h2>' +
      '<p class="hint">' + UI.esc(e.name) + '</p>' +
      '<button class="opt" data-mode="inherit"><span>USE WORKOUT TIMER</span>' +
        '<span class="opt-val">' + (w.restEnabled ? w.rest + 'S' : 'OFF') + '</span></button>' +
      '<button class="opt" data-mode="custom"><span>SET FOR THIS EXERCISE ONLY</span>' +
        '<span class="opt-val">OVERRIDE</span></button>' +
      '<div data-secs style="margin:0 0 8px">' + UI.stepperHtml('data-rest', secs) + '</div>' +
      '<button class="opt" data-mode="off"><span>NO TIMER FOR THIS EXERCISE</span>' +
        '<span class="opt-val">OFF</span></button>' +
      UI.footer('SAVE');

    UI.open(html, function (sheet) {
      var secsWrap = sheet.querySelector('[data-secs]');
      var opts = sheet.querySelectorAll('[data-mode]');
      function paint() {
        for (var i = 0; i < opts.length; i++) {
          opts[i].classList.toggle('is-on', opts[i].dataset.mode === mode);
        }
        secsWrap.style.display = mode === 'custom' ? '' : 'none';
      }
      for (var i = 0; i < opts.length; i++) {
        opts[i].addEventListener('click', function () {
          mode = this.dataset.mode;
          paint();
          UI.buzz(8);
        });
      }
      paint();
      UI.wireStepper(sheet.querySelector('.stepper'), 15, 5, 3600);
      UI.wireFooter(sheet, function () {
        var value = mode === 'inherit' ? null
          : (mode === 'off' ? 0 : Number(sheet.querySelector('[data-rest]').value) || 60);
        UI.close();
        Store.setExerciseRest(wid, eid, value);
        if (after) after();
        render();
      });
    });
  }

  /* ── Actions ─────────────────────────────────────────────── */
  var actions = {
    /* leaving the workout screen mid-session asks before walking away */
    home: function () {
      if (view.name === 'workout') return leaveWorkoutGuard(function () { go('home'); });
      go('home');
    },

    'open-workout': function (d) { go('workout', { wid: d.w || view.wid }); },

    'open-exercise': function (d) { go('exercise', { wid: d.w || view.wid, eid: d.e }); },

    'open-settings': function () { go('settings'); },

    'open-timer': function () {
      timerBack = view.name === 'exercise'
        ? { act: 'open-exercise', w: view.wid, e: view.eid }
        : (view.name === 'workout' ? { act: 'open-workout', w: view.wid } : { act: 'home' });
      go('timer', { wid: view.wid, eid: view.eid });
    },

    'pick-theme': function (d) {
      Store.setTheme(d.id);
      applyTheme(d.id);
      UI.buzz();
      render();
    },

    'toggle-edit': function () { edit = !edit; render(); },

    'default-rest': function () {
      UI.number({
        title: 'DEFAULT REST',
        label: 'SECONDS — PREFILLED WHEN YOU CREATE A WORKOUT',
        value: Store.rest,
        min: 5,
        max: 3600,
        step: 15,
        onSave: function (v) { Store.setRest(v); render(); }
      });
    },

    /* ── Backup ───────────────────────────────────────────────
     * Writes the whole state blob out as a .json file the user can keep in
     * Files / Drive / email to themselves. This is the ONLY protection against
     * losing everything: the app has no server and no sync, so a cleared
     * browser or a new phone is otherwise total data loss. */
    'export-data': function () {
      try {
        var blob = new Blob([Store.exportJSON()], { type: 'application/json' });
        var url = URL.createObjectURL(blob);
        /* A detached <a download> is the only reliable cross-browser way to
         * hand a generated file to the user. It never enters the document. */
        var a = document.createElement('a');
        a.href = url;
        a.download = Store.exportFilename();
        a.click();
        /* Revoke on a delay: revoking synchronously can cancel the download
         * before the browser has finished reading the blob. */
        setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
        UI.buzz(20);
      } catch (err) {
        UI.confirm({
          title: 'EXPORT FAILED',
          body: 'This browser wouldn\'t save the file.',
          okLabel: 'OK',
          cancelLabel: 'CLOSE',
          onConfirm: function () {}
        });
      }
    },

    /* ── Restore ──────────────────────────────────────────────
     * ⚠ DESTRUCTIVE: replaces everything. Confirmed twice — once before the
     *   file picker opens, and the file itself is validated before anything is
     *   written. There is deliberately no merge; see Store.importJSON(). */
    'import-data': function () {
      UI.confirm({
        title: 'IMPORT A BACKUP?',
        body: 'This REPLACES every workout and logged session with the contents of the file. Export your current data first if you want to keep it.',
        okLabel: 'CHOOSE FILE',
        onConfirm: function () {
          var input = document.createElement('input');
          input.type = 'file';
          /* Both hints: some Android pickers ignore accept and need the
           * wildcard to show .json at all. */
          input.accept = 'application/json,.json';
          input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function () {
              var res = Store.importJSON(String(reader.result));
              if (!res.ok) {
                UI.confirm({
                  title: 'IMPORT FAILED',
                  body: res.error,
                  okLabel: 'OK',
                  cancelLabel: 'CLOSE',
                  onConfirm: function () {}
                });
                return;
              }
              /* The restored data may not contain the workout the saved view
               * pointed at, so go home rather than risk an orphaned screen. */
              applyTheme(Store.theme);
              Timer.reset();
              UI.buzz(30);
              go('home');
              UI.confirm({
                title: 'BACKUP RESTORED',
                body: res.workouts + ' workouts and ' + res.sessions + ' sessions loaded.',
                okLabel: 'DONE',
                cancelLabel: 'CLOSE',
                onConfirm: function () {}
              });
            };
            reader.onerror = function () {
              UI.confirm({
                title: 'IMPORT FAILED',
                body: 'That file couldn\'t be read.',
                okLabel: 'OK',
                cancelLabel: 'CLOSE',
                onConfirm: function () {}
              });
            };
            reader.readAsText(file);
          });
          input.click();
        }
      });
    },

    'reset-data': function () {
      UI.confirm({
        title: 'RESET EVERYTHING?',
        body: 'Deletes every workout, logged session and remark. This cannot be undone.',
        okLabel: 'RESET',
        onConfirm: function () {
          Store.resetAll();
          applyTheme(Store.theme);
          go('home');
        }
      });
    },

    'toggle-drop-setting': function () {
      Store.setDropSets(!Store.dropSets);
      UI.buzz(10);
      render();
    },

    'toggle-exercise-remarks-setting': function () {
      Store.setExerciseRemarksEnabled(!Store.exerciseRemarks);
      UI.buzz(10);
      render();
    },

    'toggle-workout-remarks-setting': function () {
      Store.setWorkoutRemarksEnabled(!Store.workoutRemarks);
      UI.buzz(10);
      render();
    },

    'toggle-rest-alerts': function () {
      Store.setRestAlerts(!Store.restAlerts);
      if (Store.restAlerts) Notify.ask(); else Notify.cancel();
      UI.buzz(10);
      render();
    },

    /* ── Data log navigation ── */
    'tab-workouts': function () { go('home'); },
    'tab-log': function () { go('datalog'); },
    'open-log-workout': function (d) { go('logworkout', { wid: d.w || view.wid, exIdx: 0 }); },
    'open-day-sheet': function () { go('daysheet', { wid: view.wid }); },

    /* stepping to another exercise re-collapses both cards, so you always
     * land on the same compact overview */
    'log-prev-ex': function () {
      view.exIdx = Math.max(0, (view.exIdx || 0) - 1);
      view.tableExpanded = false;
      view.graphExpanded = false;
      render();
    },

    'log-next-ex': function () {
      var count = Store.loggedExercises(view.wid).length;
      view.exIdx = Math.min(count - 1, (view.exIdx || 0) + 1);
      view.tableExpanded = false;
      view.graphExpanded = false;
      render();
    },

    'toggle-table-expand': function () {
      view.tableExpanded = !view.tableExpanded;
      render();
    },

    'toggle-graph-expand': function () {
      view.graphExpanded = !view.graphExpanded;
      render();
    },

    /* the range buttons sit inside the tap-to-collapse graph card, so this
     * must not fall through to toggle-graph-expand — the delegated handler
     * picks the closest [data-act], which is the button itself, and stops */
    'log-range': function (d) {
      view.logRange = d.r;
      render();
    },

    /* ── Session lifecycle ── */
    'start-workout': function (d) {
      Store.startSession(d.w || view.wid);
      UI.buzz(20);
      render();
    },

    'end-workout': function (d) { endWorkoutFlow(d.w || view.wid); },

    /* ── Workouts ── */
    'new-workout': function () {
      UI.workout({
        title: 'NEW WORKOUT',
        okLabel: 'CREATE',
        defaultRest: Store.rest,
        onSave: function (data) { go('workout', { wid: Store.addWorkout(data).id }); }
      });
    },

    /* name + the workout-wide rest timer, used by both EDIT WORKOUT and the
     * WORKOUT REST chip */
    'workout-settings': function (d) {
      var w = Store.workout(d.w || view.wid);
      if (!w) return;
      UI.workout({
        title: 'WORKOUT SETTINGS',
        workout: w,
        onSave: function (data) {
          Store.renameWorkout(w.id, data.name);
          Store.setWorkoutRest(w.id, data.restEnabled, data.rest);
          render();
        }
      });
    },

    /* ⚠ DEAD CODE — nothing emits data-act="workout-rest" any more. It served
     * a REST TIMER chip on the workout screen that was removed at the user's
     * request (the big ON/OFF panel on the timer screen replaced it). Kept
     * because it still works and is one markup line away from being usable
     * again; delete it if you want the file shorter. Everything it does is
     * also reachable via 'workout-settings'. */
    'workout-rest': function (d) {
      var w = Store.workout(d.w || view.wid);
      if (!w) return;
      var html = '<h2>REST TIMER</h2>' +
        '<p class="hint">' + UI.esc(w.name) + ' · runs after every set in this workout</p>' +
        '<div class="btn-row" style="margin:14px 0 12px">' +
          '<button class="chip lg" data-rest-off>OFF</button>' +
          '<button class="chip lg" data-rest-on>ON</button>' +
        '</div>' +
        '<div class="field" data-rest-wrap><label>SECONDS</label>' +
          UI.stepperHtml('data-rest', w.rest) + '</div>' +
        UI.footer('SAVE');
      UI.open(html, function (sheet) {
        var wrap = sheet.querySelector('[data-rest-wrap]');
        var restOn = UI.switchPair(sheet, 'rest', w.restEnabled, function (on) {
          wrap.style.opacity = on ? '1' : '0.35';
          wrap.style.pointerEvents = on ? '' : 'none';
        });
        UI.wireStepper(sheet.querySelector('.stepper'), 15, 5, 3600);
        UI.wireFooter(sheet, function () {
          UI.close();
          Store.setWorkoutRest(w.id, restOn(), Number(sheet.querySelector('[data-rest]').value) || 90);
          render();
        });
      });
    },

    'del-workout': function (d) {
      var w = Store.workout(d.w);
      if (!w) return;
      UI.confirm({
        title: 'DELETE ' + w.name + '?',
        body: 'Its ' + w.exercises.length + ' exercises, sets and remarks go with it.',
        onConfirm: function () { Store.deleteWorkout(w.id); render(); }
      });
    },

    'reset-workout': function (d) {
      var w = Store.workout(d.w);
      if (!w) return;
      UI.confirm({
        title: 'CLEAR SETS?',
        body: 'Wipes the logged sets in every exercise of this workout. Remarks are kept.',
        okLabel: 'CLEAR',
        onConfirm: function () {
          w.exercises.forEach(function (e) { Store.clearLog(w.id, e.id); });
          Store.setRating(w.id, null);
          render();
        }
      });
    },

    /* ── Exercises ── */
    'new-exercise': function () {
      UI.exercise({
        title: 'ADD EXERCISE',
        okLabel: 'ADD',
        onSave: function (data) { Store.addExercise(view.wid, data); render(); }
      });
    },

    'edit-exercise': function (d) {
      var e = Store.exercise(view.wid, d.e || view.eid);
      if (!e) return;
      UI.exercise({
        title: 'EDIT EXERCISE',
        exercise: e,
        onSave: function (data) { Store.updateExercise(view.wid, e.id, data); render(); }
      });
    },

    'del-exercise': function (d) {
      var e = Store.exercise(view.wid, d.e);
      if (!e) return;
      UI.confirm({
        title: 'DELETE ' + e.name + '?',
        body: 'Removes its logged sets and remarks too.',
        onConfirm: function () { Store.deleteExercise(view.wid, e.id); render(); }
      });
    },

    /* Reorder within the workout, from EDIT mode. `edit` is deliberately reset
     * by go() on navigation but NOT by render(), so the list stays in edit mode
     * across repeated taps and you can move something several places without
     * re-entering it. */
    'move-exercise': function (d) {
      if (Store.moveExercise(view.wid, d.e, Number(d.d))) UI.buzz(10);
      render();
    },

    'exercise-rest': function (d) { restSheet(view.wid, d.e || view.eid); },

    /* ── Counting ── */
    tap: function () {
      var e = current();
      if (!e) return;
      Store.updateExercise(view.wid, view.eid, { draft: e.draft + 1 });
      paintReps();
      UI.buzz(10);
      var box = app.querySelector('[data-counter]');
      if (box) {
        box.classList.add('is-tapped');
        setTimeout(function () { box.classList.remove('is-tapped'); }, 90);
      }
    },

    'rep-inc': function () {
      var e = current();
      Store.updateExercise(view.wid, view.eid, { draft: e.draft + 1 });
      paintReps();
    },

    'rep-dec': function () {
      var e = current();
      Store.updateExercise(view.wid, view.eid, { draft: Math.max(0, e.draft - 1) });
      paintReps();
    },

    'rep-zero': function () {
      Store.updateExercise(view.wid, view.eid, { draft: 0 });
      paintReps();
    },

    'complete-set': function () {
      var e = current();
      if (!e) return;
      var log = function () {
        Store.logSet(view.wid, view.eid);
        UI.buzz(24);
        var rest = Store.effectiveRest(Store.workout(view.wid), current());
        if (rest.enabled) {
          Timer.startRest(rest.seconds);
          /* This runs inside the COMPLETE SET tap, which is the only moment a
           * permission prompt is allowed — and the only moment it makes sense
           * to the user. Asked once; declining is remembered by the browser. */
          Notify.ask();
          Notify.schedule(rest.seconds * 1000, (current() ? current().name + ' — ' : '') + 'next set');
        }
        render();
      };
      /* guard against fat-fingering the CTA before counting anything */
      if (e.draft === 0 && !e.draftDrops.length) {
        UI.confirm({
          title: 'LOG AN EMPTY SET?',
          body: 'The counter is still at 0 reps.',
          okLabel: 'LOG IT',
          onConfirm: function () { ensureSessionThen(log); }
        });
        return;
      }
      ensureSessionThen(log);
    },

    /* Bank this segment of a drop set, then dial the weight down. */
    'add-drop': function () {
      var e = current();
      if (!e) return;
      if (e.draft === 0) {
        UI.confirm({
          title: 'NOTHING TO DROP YET',
          body: 'Count the reps you did at ' + e.weight + ' kg first, then drop the weight.',
          okLabel: 'GOT IT',
          onConfirm: function () {}
        });
        return;
      }
      Store.addDropSegment(view.wid, view.eid);
      UI.buzz(18);
      render();
      weightSheet('DROP TO');
    },

    'undo-drop': function () {
      Store.undoDropSegment(view.wid, view.eid);
      render();
    },

    'set-inc': function () {
      var e = current();
      Store.updateExercise(view.wid, view.eid, { sets: e.sets + 1 });
      render();
    },

    'set-dec': function () {
      var e = current();
      Store.updateExercise(view.wid, view.eid, { sets: e.sets - 1 });
      render();
    },

    /* ── Weight ── */
    'weight-step': function (d) {
      var e = current();
      if (!e) return;
      Store.updateExercise(view.wid, view.eid, { weight: e.weight + Number(d.d) });
      UI.buzz(8);
      render();
    },

    'edit-weight': function () { weightSheet('WEIGHT'); },

    /* ── Set log ── */
    'edit-log': function (d) {
      var e = current();
      var i = Number(d.i);
      var entry = e && e.log[i];
      if (!entry) return;
      /* working copy so drops can be added and removed before saving */
      var drops = entry.drops.map(function (drop) {
        return { reps: drop.reps, weight: drop.weight };
      });

      var html = '<h2>SET ' + (i + 1) + '</h2>' +
        '<p class="hint">' + UI.esc(e.name) + '</p>' +
        '<div class="field row3" style="margin-top:14px">' +
          '<div><label>REPS</label><input type="number" inputmode="numeric" data-r value="' + entry.reps + '"></div>' +
          '<div><label>WEIGHT (KG)</label><input type="number" inputmode="decimal" data-kg value="' + entry.weight + '"></div>' +
        '</div>' +
        '<div data-drops></div>' +
        UI.footer('SAVE') +
        '<div style="margin-top:10px"><button class="btn btn-quiet" data-del>DELETE THIS SET</button></div>';

      UI.open(html, function (sheet) {
        var box = sheet.querySelector('[data-drops]');

        function readDrops() {
          drops = drops.map(function (drop, k) {
            var r = sheet.querySelector('[data-dr="' + k + '"]');
            var kg = sheet.querySelector('[data-dw="' + k + '"]');
            return {
              reps: r ? Number(r.value) || 0 : drop.reps,
              weight: kg ? Number(kg.value) || 0 : drop.weight
            };
          });
        }

        function paintDrops() {
          box.innerHTML = drops.map(function (drop, k) {
            return '<div class="field row3">' +
              '<div><label>DROP ' + (k + 1) + ' REPS</label>' +
                '<input type="number" inputmode="numeric" data-dr="' + k + '" value="' + drop.reps + '"></div>' +
              '<div><label>DROP ' + (k + 1) + ' KG</label>' +
                '<input type="number" inputmode="decimal" data-dw="' + k + '" value="' + drop.weight + '"></div>' +
              '<div style="flex:0 0 54px"><label>&nbsp;</label>' +
                '<button class="btn btn-quiet" style="padding:13px 0" data-rmdrop="' + k + '">✕</button></div>' +
            '</div>';
          }).join('') +
          '<button class="btn btn-quiet" style="margin-bottom:14px" data-adddrop>+ ADD DROP</button>';
        }

        box.addEventListener('click', function (ev) {
          var rm = ev.target.closest('[data-rmdrop]');
          var add = ev.target.closest('[data-adddrop]');
          if (!rm && !add) return;
          ev.preventDefault();
          readDrops();
          if (rm) drops.splice(Number(rm.dataset.rmdrop), 1);
          else {
            var last = drops.length ? drops[drops.length - 1]
              : { reps: Number(sheet.querySelector('[data-r]').value) || 0,
                  weight: Number(sheet.querySelector('[data-kg]').value) || 0 };
            drops.push({ reps: 0, weight: Math.max(0, last.weight - 5) });
          }
          paintDrops();
          UI.buzz(8);
        });

        paintDrops();

        UI.wireFooter(sheet, function () {
          readDrops();
          UI.close();
          Store.updateLogEntry(view.wid, view.eid, i, {
            reps: Number(sheet.querySelector('[data-r]').value) || 0,
            weight: Number(sheet.querySelector('[data-kg]').value) || 0,
            drops: drops
          });
          render();
        });
        sheet.querySelector('[data-del]').addEventListener('click', function () {
          UI.close();
          Store.deleteLogEntry(view.wid, view.eid, i);
          render();
        });
      });
    },

    'clear-log': function () {
      var e = current();
      UI.confirm({
        title: 'CLEAR SET LOG?',
        body: e.log.length + ' logged sets will be removed. Remarks are kept.',
        okLabel: 'CLEAR',
        onConfirm: function () { Store.clearLog(view.wid, view.eid); render(); }
      });
    },

    'save-remarks': function () {
      clearTimeout(saveTimer);
      flushRemarks(true);
      UI.buzz();
      var pad = app.querySelector('[data-remarks]');
      if (pad) pad.blur();
    },

    'save-workout-remarks': function () {
      clearTimeout(saveTimerW);
      flushWorkoutRemarks(true);
      UI.buzz();
      var pad = app.querySelector('[data-workout-remarks]');
      if (pad) pad.blur();
    },

    /* ── Timer screen's big rest ON/OFF switch ── */
    'rest-off': function () {
      var ctx = timerContext();
      if (!ctx) return;
      if (ctx.kind === 'exercise') Store.setExerciseRest(view.wid, view.eid, 0);
      else Store.setWorkoutRest(view.wid, false);
      UI.buzz(10);
      render();
    },

    'rest-on': function () {
      var ctx = timerContext();
      if (!ctx) return;
      var seconds = ctx.seconds || Store.rest;
      if (ctx.kind === 'exercise') Store.setExerciseRest(view.wid, view.eid, seconds);
      else Store.setWorkoutRest(view.wid, true, seconds);
      UI.buzz(10);
      render();
    },

    /* ── Timer ── */
    /* Every manual timer control has to keep the scheduled alert in step, or
     * the phone buzzes for a countdown the user already stopped. */
    'timer-toggle': function () {
      Timer.toggle();
      if (Timer.running && Timer.mode === 'rest') {
        Notify.ask();
        Notify.schedule(Timer.value(), 'next set');
      } else {
        Notify.cancel();
      }
    },
    'timer-reset': function () { Timer.reset(); Notify.cancel(); },
    'timer-mode': function (d) { Timer.setMode(d.m); Notify.cancel(); render(); },

    'timer-preset': function (d) {
      Timer.mode = 'rest';
      Timer.setDuration(Number(d.s) * 1000);
      Notify.cancel();   /* setDuration resets the clock; the old alert is void */
      render();
    },

    'timer-custom': function () {
      UI.number({
        title: 'TIMER LENGTH',
        label: 'SECONDS',
        value: Math.round(Timer.duration / 1000),
        min: 5,
        max: 3600,
        step: 15,
        onSave: function (v) {
          Timer.mode = 'rest';
          Timer.setDuration(v * 1000);
          Notify.cancel();
          render();
        }
      });
    }
  };

  app.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]');
    if (!el) return;
    var fn = actions[el.dataset.act];
    if (!fn) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (view.name === 'exercise') {
      /* keep whatever is in the notepad before anything re-renders */
      clearTimeout(saveTimer);
      var pad = app.querySelector('[data-remarks]');
      var e = current();
      if (pad && e && pad.value !== e.remarks) Store.updateExercise(view.wid, view.eid, { remarks: pad.value });
    }
    if (view.name === 'workout') {
      clearTimeout(saveTimerW);
      var padW = app.querySelector('[data-workout-remarks]');
      var w = Store.workout(view.wid);
      if (padW && w && padW.value !== w.remarks) Store.setWorkoutRemarks(view.wid, padW.value);
    }
    fn(el.dataset, ev);
  });

  /* ── Boot ──────────────────────────────────────────────────
   * Runs once, at the bottom of the last script tag, so every global exists.
   *   1. paint the saved theme before first render (no flash of wrong colour)
   *   2. preload the clock with the default rest so it reads 01:30 not 00:00
   *   3. go() with replace=true — the first entry REPLACES the history entry
   *      rather than pushing, so one back-press leaves the app instead of
   *      landing on a phantom duplicate of the home screen. */
  applyTheme(Store.theme);
  Timer.duration = Store.rest * 1000;
  /* Reopen where the user left off if the page was thrown away and re-run;
   * otherwise HOME. restoreView() returns null for anything stale, deleted,
   * or already home. */
  var resumed = restoreView();
  if (resumed) go(resumed.name, resumed, true);
  else go('home', null, true);

  global.RepCounter = { render: render, go: go, view: function () { return view; } };
})(window);
