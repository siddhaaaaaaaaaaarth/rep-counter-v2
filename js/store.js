/* ═══════════════════════════════════════════════════════════════════════════
 * store.js — ALL persistent state and ALL business logic.  ← START HERE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * If you are new to this codebase, read this file first. Once you know the
 * shape of the state object below, the rest of the app is predictable: every
 * screen is just a rendering of this data.
 *
 * TWO ABSOLUTE RULES
 * ------------------
 * 1. This file NEVER touches the DOM. No document, no window beyond the global
 *    attach. That's why the maths here is trivially verifiable — you can call
 *    Store.e1rm(60, 8) in a console and check it returns 76.
 * 2. This is the ONLY place state changes. Every mutation goes through a Store
 *    method and every method calls save(). Screens are pure; action handlers in
 *    app.js call into here.
 *
 * PERSISTENCE
 * -----------
 * One JSON blob in one localStorage key ('repcounter.v1'). No IndexedDB, no
 * server, no accounts. save() is wrapped in try/catch because Safari private
 * mode throws on write — the session keeps working, it just won't persist.
 *
 * ═══ THE STATE SHAPE ═══
 *
 *  {
 *    version, theme, rest,          // rest = DEFAULT seconds for NEW workouts
 *    dropSets, exerciseRemarks,     // global feature switches
 *    workoutRemarks,
 *
 *    activeWorkoutId,               // the session running right now, or null
 *    activeStartedAt,               // ms timestamp — PERSISTED, see below
 *
 *    workouts: [ {                  // the templates AND the scratchpad
 *      id, name,
 *      restEnabled, rest,           // workout-level rest timer
 *      rating,                      // 1–10, cleared when a session ends
 *      remarks,
 *      exercises: [ {
 *        id, name,
 *        sets,                      // PLANNED number of sets
 *        target,                    // target reps (a label, not enforced)
 *        weight,
 *        restOverride,              // null = inherit | 0 = off | n = seconds
 *        remarks,
 *        draft,                     // reps counted but not yet logged
 *        draftDrops: [],            // banked segments of the in-progress set
 *        log: [ {reps, weight, drops:[{reps,weight}]} ]   // COMPLETED sets
 *      } ]
 *    } ],
 *
 *    sessions: [ {                  // permanent history, append-only
 *      id, wid, wname,
 *      date,                        // ISO — when it ENDED
 *      startedAt,                   // ISO or null
 *      durationMs,                  // number or null (null when unknown)
 *      rating, remarks,
 *      entries: [ {eid, ename, set, weight, reps, drops:[...]} ]
 *    } ]
 *  }
 *
 * ═══ THREE IDEAS WORTH INTERNALISING ═══
 *
 * 1. `workouts` is BOTH the template and today's scratchpad; `sessions` is
 *    history. An exercise's `log` holds only the current, unsaved session. When
 *    endSession() runs, everything is copied into a new `sessions` entry and
 *    the logs are emptied. So `workouts` never grows over time; `sessions` does.
 *
 * 2. SET NUMBERS ARE NEVER STORED. A set's number is its array index + 1.
 *    Delete set 2 and set 3 becomes set 2 automatically — no renumbering pass
 *    exists anywhere, and none is needed. Same for drop segments.
 *
 * 3. A DROP SET IS ONE SET. The main effort is the top-level reps/weight; every
 *    subsequent lighter segment is an entry in `drops`. It stays one set in
 *    every count and total — it must never inflate the set count.
 *
 * ═══ REST TIMER RESOLUTION (most specific wins) ═══
 *
 *    exercise.restOverride === null  → inherit the workout's setting
 *    exercise.restOverride === 0     → explicitly OFF for this exercise
 *    exercise.restOverride  >  0     → n seconds, overriding the workout
 *
 *    effectiveRest(workout, exercise) resolves this and returns
 *    {enabled, seconds, source} where source is 'exercise' or 'workout'.
 *
 * ═══ MIGRATION ═══
 *
 * normalize() runs on EVERY load and fills in any field an older version didn't
 * store. This is how the schema has evolved across several versions without
 * ever breaking saved data. It also actively deletes retired keys (e.g. the old
 * `feeling` field from a previous 7-tier rating scale) rather than leaving them.
 *
 * ⚠ WHEN YOU ADD A FIELD, ADD IT TO normalize() IN THE SAME EDIT. Everything
 *   downstream assumes fields exist.
 *
 * ═══ NUMBER CLAMPING ═══
 *
 * clamp()   → integers. Reps, sets, target, rating.
 * clampKg() → 2 decimal places. Weights ONLY.
 *
 * ⚠ Do not use clamp() on a weight. Gym plates come in 2.5kg steps; rounding
 *   32.5kg to 33kg is data corruption, and it shipped once as a real bug.
 */
(function (global) {
  'use strict';

  /* The localStorage key. ⚠ The 'v1' here is the STORAGE-SLOT name and is
   * frozen forever — bumping it would orphan every existing user's data. The
   * schema version is the separate `version` field inside the blob (currently
   * 3), and schema changes are handled by normalize(), never by a new key. */
  var KEY = 'repcounter.v1';

  /* Seconds. The factory default rest length, used for (a) a fresh install's
   * state.rest, and (b) the prefill when creating a workout. Settings can
   * change state.rest; this constant never changes. */
  var DEFAULT_REST = 90;

  function uid() {
    return Math.random().toString(36).slice(2, 10);
  }

  function ex(name, sets, target, weight) {
    return {
      id: uid(), name: name, sets: sets, target: target, weight: weight,
      restOverride: null,
      remarks: '', draft: 0, draftDrops: [], log: []
    };
  }

  function wk(name, exercises) {
    return {
      id: uid(), name: name, restEnabled: false, rest: DEFAULT_REST,
      rating: null, remarks: '', exercises: exercises
    };
  }

  /* The app starts genuinely empty — no sample workouts, no sample sets. */
  function seed() {
    return [];
  }

  function defaults() {
    return {
      activeWorkoutId: null, /* the workout currently in progress, if any */
      activeStartedAt: null, /* when it started — persisted so a reload mid-workout
                              * doesn't lose the clock */
      sessions: [],          /* finished workouts, newest last */
      version: 3,
      theme: 't3a',      /* dark & red — no first-run picker, change it in settings */
      rest: DEFAULT_REST,
      dropSets: true,        /* drop-set logging is on unless the user hides it */
      exerciseRemarks: true, /* per-exercise notepad, on by default */
      workoutRemarks: false, /* whole-workout notepad, off by default */
      /* Fire a phone NOTIFICATION when a rest countdown ends, so the alert can
       * reach the user with the app backgrounded. On by default.
       * ⚠ Notifications are used here specifically because a notification
       *   sound MIXES with whatever the phone is playing — it ducks music for
       *   an instant rather than taking audio focus and pausing it. An earlier
       *   attempt that held an audio session open for the whole rest DID pause
       *   music, and was rejected outright. Do not go back to that. */
      restAlerts: true,
      workouts: seed()
    };
  }

  /* Fills in anything a previous version didn't store. */
  function normalize(s) {
    if (!Array.isArray(s.workouts)) s.workouts = seed();
    if (typeof s.rest !== 'number') s.rest = DEFAULT_REST;
    if (!Array.isArray(s.sessions)) s.sessions = [];
    if (s.activeWorkoutId === undefined) s.activeWorkoutId = null;
    if (s.activeStartedAt === undefined) s.activeStartedAt = null;
    if (typeof s.dropSets !== 'boolean') s.dropSets = true;
    if (typeof s.exerciseRemarks !== 'boolean') s.exerciseRemarks = true;
    if (typeof s.workoutRemarks !== 'boolean') s.workoutRemarks = false;
    if (typeof s.restAlerts !== 'boolean') s.restAlerts = true;
    if (!s.theme) s.theme = 't3a';
    s.workouts.forEach(function (w) {
      if (typeof w.restEnabled !== 'boolean') w.restEnabled = false;
      if (typeof w.rest !== 'number') w.rest = s.rest;
      /* the retired 0–6 emoji scale doesn't translate onto 1–10, so drop it
       * rather than invent a rank the user never chose */
      if (w.feeling !== undefined) delete w.feeling;
      if (typeof w.rating !== 'number') w.rating = null;
      else w.rating = clamp(w.rating, 1, 10);
      if (typeof w.remarks !== 'string') w.remarks = '';
      if (!Array.isArray(w.exercises)) w.exercises = [];
      w.exercises.forEach(function (e) {
        if (e.restOverride === undefined) e.restOverride = null;
        if (!Array.isArray(e.draftDrops)) e.draftDrops = [];
        if (!Array.isArray(e.log)) e.log = [];
        if (typeof e.draft !== 'number') e.draft = 0;
        if (typeof e.remarks !== 'string') e.remarks = '';
        e.log.forEach(function (entry) {
          if (!Array.isArray(entry.drops)) entry.drops = [];
        });
      });
    });
    s.version = 3;
    return s;
  }

  /* Boot: read the one localStorage key, merge it over defaults(), normalize.
   * Object.assign gives a SHALLOW merge, which is exactly what's wanted — the
   * top-level scalars (theme, rest, the switches) come from the save, and any
   * key a previous version never wrote falls back to defaults(). Nested objects
   * are NOT merged; normalize() below is what repairs those.
   *
   * ⚠ Object.assign is an ES2015 *runtime API* (Chrome 45+ / Safari 9+). The
   *   codebase is ES5 SYNTAX for old-WebView parsing, but this line means the
   *   real floor is ~Chrome 45, not ES5-everywhere. It sits on the boot path,
   *   so on anything older the app throws here and never renders. If that ever
   *   matters, replace it with a hand-rolled copy loop. */
  var state;
  try {
    var raw = global.localStorage.getItem(KEY);
    state = normalize(raw ? Object.assign(defaults(), JSON.parse(raw)) : defaults());
  } catch (err) {
    state = defaults();
  }

  function save() {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      /* private mode / quota — the session still works, it just won't persist */
    }
  }

  function find(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* whole numbers: sets, target reps, rep counts */
  function clamp(n, min, max) {
    n = Math.round(Number(n));
    if (!isFinite(n)) n = min;
    return Math.min(max, Math.max(min, n));
  }

  /* weights keep half- and quarter-plate precision (32.5, 62.5, …) */
  function clampKg(n, min, max) {
    n = Math.round(Number(n) * 100) / 100;
    if (!isFinite(n)) n = min;
    return Math.min(max, Math.max(min, n));
  }

  var Store = {
    uid: uid,
    DEFAULT_REST: DEFAULT_REST,

    get state() { return state; },
    get workouts() { return state.workouts; },
    get theme() { return state.theme; },
    get rest() { return state.rest; },
    get dropSets() { return state.dropSets; },
    get exerciseRemarks() { return state.exerciseRemarks; },
    get workoutRemarks() { return state.workoutRemarks; },
    get restAlerts() { return state.restAlerts; },

    setTheme: function (id) { state.theme = id; save(); },
    setRest: function (sec) { state.rest = clamp(sec, 5, 3600); save(); },
    setDropSets: function (on) { state.dropSets = !!on; save(); },
    setExerciseRemarksEnabled: function (on) { state.exerciseRemarks = !!on; save(); },
    setWorkoutRemarksEnabled: function (on) { state.workoutRemarks = !!on; save(); },
    setRestAlerts: function (on) { state.restAlerts = !!on; save(); },

    workout: function (wid) { return find(state.workouts, wid); },
    exercise: function (wid, eid) {
      var w = this.workout(wid);
      return w ? find(w.exercises, eid) : null;
    },

    /* ── Workouts ── */
    addWorkout: function (data) {
      var w = wk((data.name || 'NEW WORKOUT').trim().toUpperCase(), []);
      w.restEnabled = !!data.restEnabled;
      w.rest = clamp(data.rest === undefined ? state.rest : data.rest, 5, 3600);
      state.workouts.push(w);
      save();
      return w;
    },

    renameWorkout: function (wid, name) {
      var w = this.workout(wid);
      if (w && name.trim()) { w.name = name.trim().toUpperCase(); save(); }
    },

    /* How the session went, 1–10, or null for unrated. */
    setRating: function (wid, rank) {
      var w = this.workout(wid);
      if (!w) return;
      w.rating = rank === null ? null : clamp(rank, 1, 10);
      save();
    },

    /* Free-text notes on the whole session, separate from per-exercise remarks. */
    setWorkoutRemarks: function (wid, text) {
      var w = this.workout(wid);
      if (!w) return;
      w.remarks = String(text);
      save();
    },

    /* The workout-wide rest timer. Off by default for every new workout. */
    setWorkoutRest: function (wid, enabled, seconds) {
      var w = this.workout(wid);
      if (!w) return;
      w.restEnabled = !!enabled;
      if (seconds !== undefined) w.rest = clamp(seconds, 5, 3600);
      save();
    },

    deleteWorkout: function (wid) {
      state.workouts = state.workouts.filter(function (w) { return w.id !== wid; });
      save();
    },

    /* ── Exercises ── */
    addExercise: function (wid, data) {
      var w = this.workout(wid);
      if (!w) return null;
      var e = ex(
        (data.name || 'NEW EXERCISE').trim().toUpperCase(),
        clamp(data.sets, 1, 50),
        clamp(data.target, 1, 500),
        clampKg(data.weight, 0, 1000)
      );
      w.exercises.push(e);
      save();
      return e;
    },

    updateExercise: function (wid, eid, patch) {
      var e = this.exercise(wid, eid);
      if (!e) return;
      if (patch.name !== undefined && patch.name.trim()) e.name = patch.name.trim().toUpperCase();
      /* the planned-set floor is however many sets are already logged — you
       * can't plan fewer sets than you've actually done, or logged sets would
       * fall off the bottom of the set list with no way to reach them */
      if (patch.sets !== undefined) e.sets = clamp(patch.sets, Math.max(1, e.log.length), 50);
      if (patch.target !== undefined) e.target = clamp(patch.target, 1, 500);
      if (patch.weight !== undefined) e.weight = clampKg(patch.weight, 0, 1000);
      if (patch.remarks !== undefined) e.remarks = String(patch.remarks);
      if (patch.draft !== undefined) e.draft = clamp(patch.draft, 0, 999);
      save();
    },

    /* null = inherit workout, 0 = off for this exercise, n = n seconds */
    setExerciseRest: function (wid, eid, value) {
      var e = this.exercise(wid, eid);
      if (!e) return;
      e.restOverride = value === null ? null : clamp(value, 0, 3600);
      save();
    },

    deleteExercise: function (wid, eid) {
      var w = this.workout(wid);
      if (!w) return;
      w.exercises = w.exercises.filter(function (e) { return e.id !== eid; });
      save();
    },

    /* Move an exercise up (delta -1) or down (delta +1) in the workout.
     *
     * Exercise order is just array order — there is no `position` field and
     * there must not be one, for the same reason set numbers aren't stored:
     * a derived order can never disagree with itself. Before this existed a
     * new exercise always landed at the bottom and the only way to reorder was
     * to delete and re-add, which threw away its remarks and rest override.
     *
     * Silently does nothing at the ends of the list, so the caller doesn't
     * have to bounds-check. Returns true if something actually moved. */
    moveExercise: function (wid, eid, delta) {
      var w = this.workout(wid);
      if (!w) return false;
      var from = -1;
      for (var i = 0; i < w.exercises.length; i++) {
        if (w.exercises[i].id === eid) { from = i; break; }
      }
      if (from < 0) return false;
      var to = from + delta;
      if (to < 0 || to >= w.exercises.length) return false;
      var moved = w.exercises.splice(from, 1)[0];
      w.exercises.splice(to, 0, moved);
      save();
      return true;
    },

    /* ── Logging ── */

    /* Bank the current count as one segment of a drop set and carry on at a
     * lighter weight. The first segment is the main set. */
    addDropSegment: function (wid, eid) {
      var e = this.exercise(wid, eid);
      if (!e) return;
      e.draftDrops.push({ reps: e.draft, weight: e.weight });
      e.draft = 0;
      save();
    },

    undoDropSegment: function (wid, eid) {
      var e = this.exercise(wid, eid);
      if (!e || !e.draftDrops.length) return;
      var last = e.draftDrops.pop();
      e.draft = last.reps;
      e.weight = last.weight;
      save();
    },

    /* Push the current draft (plus any drop segments) as a completed set. */
    logSet: function (wid, eid) {
      var e = this.exercise(wid, eid);
      if (!e) return null;
      var segments = e.draftDrops.concat([{ reps: e.draft, weight: e.weight }]);
      /* finishing right after a drop shouldn't tack on a 0-rep segment */
      if (segments.length > 1 && segments[segments.length - 1].reps === 0) segments.pop();
      e.log.push({
        reps: segments[0].reps,
        weight: segments[0].weight,
        drops: segments.slice(1)
      });
      e.draft = 0;
      e.draftDrops = [];
      /* logging past the plan silently raises the plan, so an extra set is just
       * logged rather than rejected — the plan is a guide, not a limit */
      if (e.log.length > e.sets) e.sets = e.log.length;
      save();
      /* `complete` tells the caller this exercise has now met its planned count */
      return { complete: e.log.length >= e.sets };
    },

    updateLogEntry: function (wid, eid, index, patch) {
      var e = this.exercise(wid, eid);
      if (!e || !e.log[index]) return;
      var entry = e.log[index];
      if (patch.reps !== undefined) entry.reps = clamp(patch.reps, 0, 999);
      if (patch.weight !== undefined) entry.weight = clampKg(patch.weight, 0, 1000);
      if (patch.drops !== undefined) {
        entry.drops = patch.drops.map(function (d) {
          return { reps: clamp(d.reps, 0, 999), weight: clampKg(d.weight, 0, 1000) };
        });
      }
      save();
    },

    deleteLogEntry: function (wid, eid, index) {
      var e = this.exercise(wid, eid);
      if (!e) return;
      e.log.splice(index, 1);
      save();
    },

    clearLog: function (wid, eid) {
      var e = this.exercise(wid, eid);
      if (!e) return;
      e.log = [];
      e.draft = 0;
      e.draftDrops = [];
      save();
    },

    /* ── Derived helpers ── */

    /* Reps in one logged set, main part plus every drop segment. */
    entryReps: function (entry) {
      return entry.drops.reduce(function (sum, d) { return sum + d.reps; }, entry.reps);
    },

    totalReps: function (e) {
      var self = this;
      return e.log.reduce(function (sum, entry) { return sum + self.entryReps(entry); }, 0);
    },

    exerciseDone: function (e) {
      return e.log.length >= e.sets;
    },

    /* Rest timing for one exercise: exercise override wins over the workout. */
    effectiveRest: function (w, e) {
      var fallback = (w && w.rest) || state.rest || DEFAULT_REST;
      if (e && e.restOverride !== null && e.restOverride !== undefined) {
        if (e.restOverride === 0) return { enabled: false, seconds: fallback, source: 'exercise' };
        return { enabled: true, seconds: e.restOverride, source: 'exercise' };
      }
      if (w && w.restEnabled) return { enabled: true, seconds: w.rest, source: 'workout' };
      return { enabled: false, seconds: fallback, source: 'workout' };
    },

    /* Sets logged vs planned across a whole workout. */
    progress: function (w) {
      var logged = 0, total = 0;
      w.exercises.forEach(function (e) {
        logged += Math.min(e.log.length, e.sets);
        total += e.sets;
      });
      return { logged: logged, total: total, started: logged > 0 };
    },

    /* Index of the first exercise that still has sets left — the "next up". */
    nextExerciseIndex: function (w) {
      for (var i = 0; i < w.exercises.length; i++) {
        if (!Store.exerciseDone(w.exercises[i])) return i;
      }
      return -1;
    },

    /* Index of the workout to highlight on the home screen. */
    leadWorkoutIndex: function () {
      for (var i = 0; i < state.workouts.length; i++) {
        var p = this.progress(state.workouts[i]);
        if (p.started && p.logged < p.total) return i;
      }
      return state.workouts.length ? 0 : -1;
    },

    /* ── Sessions: start → log → end (saved into the data log) ── */

    get activeWorkoutId() { return state.activeWorkoutId; },
    get sessions() { return state.sessions; },

    isActive: function (wid) { return state.activeWorkoutId === wid; },
    hasActiveSession: function () { return !!state.activeWorkoutId; },

    startSession: function (wid) {
      state.activeWorkoutId = wid;
      state.activeStartedAt = Date.now();
      save();
    },

    /* ms elapsed in the workout running right now, or null */
    activeElapsed: function () {
      if (!state.activeWorkoutId || !state.activeStartedAt) return null;
      return Date.now() - state.activeStartedAt;
    },

    /* "47m" / "1h 12m" — compact enough for a spreadsheet cell */
    formatDuration: function (ms) {
      if (ms === null || ms === undefined) return '—';
      var mins = Math.max(0, Math.round(ms / 60000));
      if (mins < 60) return mins + 'm';
      return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
    },

    /* Is there anything logged in this workout right now? */
    hasLoggedData: function (wid) {
      var w = this.workout(wid);
      if (!w) return false;
      return w.exercises.some(function (e) {
        return e.log.length > 0 || e.draft > 0 || e.draftDrops.length > 0;
      });
    },

    /* Freeze the current numbers into a dated session record, then clear the
     * workout so the next session starts from a blank slate. */
    endSession: function (wid, rating) {
      var w = this.workout(wid);
      if (!w) return null;

      var entries = [];
      w.exercises.forEach(function (e) {
        e.log.forEach(function (entry, i) {
          entries.push({
            eid: e.id,
            ename: e.name,
            set: i + 1,
            weight: entry.weight,
            reps: entry.reps,
            drops: entry.drops.map(function (d) {
              return { reps: d.reps, weight: d.weight };
            })
          });
        });
      });

      /* only trust the clock if this session was actually started — a session
       * ended without a recorded start gets a null duration rather than a
       * fabricated one */
      var startedAt = (state.activeWorkoutId === wid && state.activeStartedAt) || null;
      var endedAt = Date.now();

      var session = {
        id: uid(),
        wid: w.id,
        wname: w.name,
        date: new Date(endedAt).toISOString(),
        startedAt: startedAt ? new Date(startedAt).toISOString() : null,
        durationMs: startedAt ? endedAt - startedAt : null,
        rating: rating === null || rating === undefined ? null : clamp(rating, 1, 10),
        remarks: w.remarks,
        entries: entries
      };
      state.sessions.push(session);

      /* wipe the workout for next time */
      w.exercises.forEach(function (e) {
        e.log = [];
        e.draft = 0;
        e.draftDrops = [];
      });
      w.rating = null;
      w.remarks = '';
      if (state.activeWorkoutId === wid) {
        state.activeWorkoutId = null;
        state.activeStartedAt = null;
      }
      save();
      return session;
    },

    /* ── Estimated one-rep max ────────────────────────────────
     * Epley up to 12 reps, Wathan beyond it — Epley drifts high once the rep
     * count gets long, which is the range Wathan was fitted for.
     *   Epley   1RM = w × (1 + r/30)
     *   Wathan  1RM = 100w / (48.8 + 53.8·e^(−0.075r))
     * The spec said "<12" and ">12" without naming 12 itself; 12 uses Epley
     * here, keeping the low-rep formula across its whole usual range. */
    e1rm: function (weight, reps) {
      /* 0 means "no estimate" — guards missing/zero weight and sub-1 reps */
      if (!weight || !reps || reps < 1) return 0;
      /* A single rep IS the one-rep max — return it untouched. Without this
       * line Epley would inflate it by 1/30 (60kg×1 → 62kg), which is wrong by
       * definition rather than merely imprecise. */
      if (reps === 1) return weight;
      if (reps <= 12) return weight * (1 + reps / 30);
      return (100 * weight) / (48.8 + 53.8 * Math.exp(-0.075 * reps));
    },

    /* One point per session for an exercise: the best e1RM of that day, since
     * that's the number worth tracking rather than an average including
     * warmups. Chronological (oldest first) so the chart reads left to right. */
    e1rmSeries: function (wid, eid) {
      var self = this;
      var out = [];
      this.sessionsFor(wid).forEach(function (s) {
        var best = 0, bestSet = null;
        s.entries.forEach(function (en) {
          if (en.eid !== eid) return;
          /* the main set and every drop segment are all candidates */
          [{ reps: en.reps, weight: en.weight }].concat(en.drops).forEach(function (c) {
            var v = self.e1rm(c.weight, c.reps);
            if (v > best) { best = v; bestSet = c; }
          });
        });
        if (best > 0) {
          out.push({
            date: s.date,
            e1rm: Math.round(best * 10) / 10,
            reps: bestSet.reps,
            weight: bestSet.weight
          });
        }
      });
      return out.reverse();
    },

    /* Y-axis ticks: 0, a break, then 5kg steps.
     * The tick after 0 is the nearest multiple of 5 at or below the LOWEST
     * e1RM in the series — normally that's the first session (36 → 35,
     * 26 → 25, 44 → 40), but if a later session comes in worse than the
     * first (40 then 38) the base drops to 35 so the dip stays on the
     * chart instead of falling off the bottom. */
    /* Returns {base, top, ticks}. ⚠ `ticks` holds ONLY the real scale above
     * the axis break — the 0 label is drawn separately by Screens.e1rmChart()
     * and is deliberately NOT a member of this array. base/top are always
     * multiples of 5 (kg), and top is forced at least one step above base so a
     * flat series still has height to draw into. */
    e1rmAxis: function (series) {
      if (!series.length) return null;
      var vals = series.map(function (p) { return p.e1rm; });
      var base = Math.floor(Math.min.apply(null, vals) / 5) * 5;
      var top = Math.ceil(Math.max.apply(null, vals) / 5) * 5;
      if (top <= base) top = base + 5;
      var ticks = [];
      for (var v = base; v <= top; v += 5) ticks.push(v);
      return { base: base, top: top, ticks: ticks };
    },

    /* Range windowing for the expanded chart. Anchored to the most recent
     * session rather than today, so an old log still shows something instead
     * of an empty chart after a layoff. */
    windowSeries: function (series, range) {
      if (range === 'all' || !series || series.length < 2) return series || [];
      var months = { '1m': 1, '3m': 3, '6m': 6 }[range];
      if (!months) return series;
      var cut = new Date(series[series.length - 1].date);
      cut.setMonth(cut.getMonth() - months);
      var out = series.filter(function (p) { return new Date(p.date) >= cut; });
      return out.length ? out : series.slice(-1);
    },

    /* Sessions for one workout, newest first. */
    sessionsFor: function (wid) {
      return state.sessions.filter(function (s) { return s.wid === wid; })
        .sort(function (a, b) { return b.date.localeCompare(a.date); });
    },

    /* Every logged set for one exercise across all sessions, newest first.
     * Drop segments follow their parent set as their own rows. */
    exerciseHistory: function (wid, eid) {
      var rows = [];
      this.sessionsFor(wid).forEach(function (s) {
        s.entries.forEach(function (en) {
          if (en.eid !== eid) return;
          rows.push({ date: s.date, set: String(en.set), weight: en.weight, reps: en.reps });
          en.drops.forEach(function (d, k) {
            rows.push({ date: s.date, set: en.set + '·D' + (k + 1), weight: d.weight, reps: d.reps, drop: true });
          });
        });
      });
      return rows;
    },

    /* Flat spreadsheet rows for a workout: one line per set, newest first,
     * carrying that day's rating. */
    daySheetRows: function (wid) {
      var rows = [];
      this.sessionsFor(wid).forEach(function (s) {
        s.entries.forEach(function (en) {
          rows.push({
            date: s.date, exercise: en.ename, set: String(en.set),
            weight: en.weight, reps: en.reps, rating: s.rating,
            durationMs: s.durationMs === undefined ? null : s.durationMs
          });
          en.drops.forEach(function (d, k) {
            rows.push({
              date: s.date, exercise: en.ename, set: en.set + '·D' + (k + 1),
              weight: d.weight, reps: d.reps, rating: s.rating,
              durationMs: s.durationMs === undefined ? null : s.durationMs, drop: true
            });
          });
        });
      });
      return rows;
    },

    /* Which exercises this workout has data for (falls back to its current
     * exercise list so a fresh workout still shows its exercises). */
    loggedExercises: function (wid) {
      var w = this.workout(wid);
      var seen = {};
      var out = [];
      this.sessionsFor(wid).forEach(function (s) {
        s.entries.forEach(function (en) {
          if (seen[en.eid]) return;
          seen[en.eid] = true;
          out.push({ id: en.eid, name: en.ename });
        });
      });
      if (w) {
        w.exercises.forEach(function (e) {
          if (seen[e.id]) return;
          seen[e.id] = true;
          out.push({ id: e.id, name: e.name });
        });
      }
      return out;
    },

    /* Every session of this workout that carries a written note, newest first.
     *
     * ⚠ WHY THIS EXISTS. `session.remarks` is a frozen copy of the workout's
     *   notes, taken by endSession(). It was being written on every session and
     *   then never rendered anywhere — the user could type "shoulder felt off
     *   today", save it, and had no way to ever read it back. This is the read
     *   side of a feature that previously only had a write side.
     *
     * Returns [{id, date, remarks, rating}]. Sessions with an empty note are
     * left out, so a workout nobody has written notes for produces an empty
     * array and the UI can render nothing at all. */
    sessionNotes: function (wid) {
      return this.sessionsFor(wid)
        .filter(function (s) { return s.remarks && s.remarks.trim(); })
        .map(function (s) {
          return { id: s.id, date: s.date, remarks: s.remarks.trim(), rating: s.rating };
        });
    },

    sessionStats: function (wid) {
      var list = this.sessionsFor(wid);
      var sets = 0;
      list.forEach(function (s) { sets += s.entries.length; });
      return { sessions: list.length, sets: sets };
    },

    /* ── Backup and restore ───────────────────────────────────
     * ⚠ THE PROBLEM THIS SOLVES. Everything the user has ever logged lives in
     *   ONE localStorage key, in ONE browser, on ONE device. Clearing site
     *   data, switching phones, or the OS evicting storage under pressure
     *   destroys the entire training history with no recovery and no warning.
     *   It is also per-origin, so data logged at localhost never appears on the
     *   deployed site. This was the single biggest gap in the app.
     *
     * The whole state blob round-trips through JSON, so a backup is a complete
     * and faithful copy — not a summary. */

    /* Pretty-printed so the file is human-readable if it ever needs
     * inspecting or hand-repairing. Size is irrelevant at this scale. */
    exportJSON: function () {
      return JSON.stringify(state, null, 2);
    },

    /* Suggested filename: rep-counter-backup-YYYY-MM-DD.json */
    exportFilename: function () {
      var d = new Date();
      function pad(n) { return (n < 10 ? '0' : '') + n; }
      return 'rep-counter-backup-' + d.getFullYear() + '-' +
        pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '.json';
    },

    /* Replace everything with the contents of a backup file.
     *
     * ⚠ DESTRUCTIVE — the caller MUST confirm with the user first. There is no
     *   merge: a restore is a restore, and merging two divergent histories
     *   would silently duplicate sessions with no way to tell which is right.
     *
     * Validation is deliberately shallow-but-real: parse, check it is an
     * object that looks like this app's state, then hand it to the SAME
     * normalize() every load already goes through. That means an older backup
     * missing newer fields is repaired exactly as an old save would be, rather
     * than needing its own migration path.
     *
     * Returns {ok:true, workouts, sessions} or {ok:false, error} — never
     * throws, so the caller can just show the message. */
    importJSON: function (text) {
      var parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        return { ok: false, error: 'That file isn\'t valid JSON.' };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { ok: false, error: 'That doesn\'t look like a backup file.' };
      }
      /* A backup must carry at least one of the two data arrays. Without this
       * an unrelated .json would import "successfully" as an empty app. */
      if (!Array.isArray(parsed.workouts) && !Array.isArray(parsed.sessions)) {
        return { ok: false, error: 'No workouts or sessions found in that file.' };
      }
      try {
        state = normalize(Object.assign(defaults(), parsed));
      } catch (err) {
        return { ok: false, error: 'That backup couldn\'t be read.' };
      }
      save();
      return { ok: true, workouts: state.workouts.length, sessions: state.sessions.length };
    },

    resetAll: function () {
      state = defaults();
      save();
    }
  };

  global.Store = Store;
})(window);
