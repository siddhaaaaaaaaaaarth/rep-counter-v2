/* ═══════════════════════════════════════════════════════════════════════════
 * timer.js — the rest timer / stopwatch. ONE shared instance for the whole app.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * WHY A SINGLE INSTANCE
 * ---------------------
 * The same clock is shown in two places: the compact bar on the exercise screen
 * and the big dial on the timer screen. Because it's one object rather than
 * per-screen state, a countdown started mid-workout keeps running while you
 * navigate around the app. Screens subscribe via onChange() and patch their own
 * DOM nodes.
 *
 * TWO MODES
 * ---------
 *   'rest'       counts DOWN from `duration`; beeps and vibrates at zero
 *   'stopwatch'  counts UP from zero
 *
 * ⚠ ELAPSED TIME IS DERIVED, NOT ACCUMULATED
 *   value() computes from Date.now() minus a stored start stamp, plus banked
 *   time from previous runs. It never adds up per-tick deltas. This matters
 *   because mobile browsers throttle timers in background tabs — a tick-
 *   accumulating implementation silently loses minutes when the phone locks,
 *   which is exactly when a gym rest timer is running.
 *
 * ⚠ THE TICK MUST NOT TRIGGER A FULL RE-RENDER
 *   emit() fires ~5×/second. app.js's subscriber patches individual nodes.
 *   Calling render() here would destroy the remarks textarea's focus while the
 *   user types. See app.js header.
 *
 * THE ALARM
 * ---------
 * A triple square-wave beep via WebAudio, plus navigator.vibrate on Android.
 * Both are wrapped defensively: iOS Safari has no vibrate, and audio contexts
 * can fail. It works because the timer can only be STARTED by a user tap,
 * which satisfies the browser's audio-unlock requirement.
 *
 * WHAT THIS FILE DOES NOT KNOW
 * ----------------------------
 * Nothing about workouts, exercises, or which rest setting applies. It's a dumb
 * clock. Store.effectiveRest() decides the duration and app.js calls
 * Timer.startRest(seconds).
 */
(function (global) {
  'use strict';

  var listeners = [];
  var interval = null;


  var Timer = {
    mode: 'rest',
    duration: 90000,   // ms, rest mode only
    running: false,
    finished: false,
    _acc: 0,           // ms banked from previous runs
    _start: 0,         // Date.now() when the current run began

    elapsed: function () {
      return this._acc + (this.running ? Date.now() - this._start : 0);
    },

    /* ms on the clock: remaining in rest mode, elapsed in stopwatch mode */
    value: function () {
      if (this.mode === 'rest') return Math.max(0, this.duration - this.elapsed());
      return this.elapsed();
    },

    display: function () {
      var total = Math.ceil(this.value() / 1000);
      var m = Math.floor(total / 60);
      var s = total % 60;
      return (m < 10 ? '0' + m : m) + ':' + (s < 10 ? '0' + s : s);
    },

    /* 0..1 of the countdown consumed (rest mode only) */
    fraction: function () {
      if (this.mode !== 'rest' || !this.duration) return 0;
      return Math.min(1, this.elapsed() / this.duration);
    },

    setMode: function (mode) {
      if (mode === this.mode) return;
      this.mode = mode;
      this.reset();
    },

    setDuration: function (ms) {
      this.duration = Math.max(1000, ms);
      this.reset();
      this.emit();
    },

    start: function () {
      if (this.running) return;
      if (this.mode === 'rest' && this.value() <= 0) this._acc = 0;
      this.finished = false;
      this.running = true;
      this._start = Date.now();
      this.tick();
      if (!interval) interval = setInterval(this.tick.bind(this), 200);
    },

    pause: function () {
      if (!this.running) return;
      this._acc = this.elapsed();
      this.running = false;
      this.stopInterval();
      this.emit();
    },

    toggle: function () {
      if (this.running) this.pause(); else this.start();
    },

    reset: function () {
      this.running = false;
      this.finished = false;
      this._acc = 0;
      this.stopInterval();
      this.emit();
    },

    /* Called when a set is completed and auto-rest is on. */
    startRest: function (seconds) {
      this.mode = 'rest';
      this.duration = Math.max(1000, seconds * 1000);
      this.running = false;
      this.finished = false;
      this._acc = 0;
      this.start();
    },

    stopInterval: function () {
      if (interval) { clearInterval(interval); interval = null; }
    },

    tick: function () {
      if (this.mode === 'rest' && this.running && this.value() <= 0) {
        this._acc = this.duration;
        this.running = false;
        this.finished = true;
        this.stopInterval();
        this.alarm();
      }
      this.emit();
    },

    onChange: function (fn) { listeners.push(fn); },

    emit: function () {
      for (var i = 0; i < listeners.length; i++) listeners[i](this);
    },

    /* Short triple beep + haptic. Audio is unlocked because the timer can only
     * be started by a tap.
     *
     * ⚠ THE AUDIO CONTEXT IS CREATED HERE, AT THE MOMENT OF THE BEEP, AND
     *   NOWHERE EARLIER. This is deliberate and was re-established by reverting
     *   a change that opened it when the countdown STARTED.
     *
     *   A page holding a live audio session takes audio focus from the phone:
     *   on Android that pauses the user's music outright, on iOS it ducks or
     *   pauses it. Holding one open for the whole 90-second rest meant music
     *   stopping between every set — a dealbreaker for a gym app, and a far
     *   worse bug than the one it was trying to fix.
     *
     *   So: touch audio for the ~0.8s of the beep and not one moment before.
     *   Anything that keeps a session open across the rest period is not an
     *   acceptable trade here, however well it makes the alarm work. */
    alarm: function () {
      if (global.navigator && navigator.vibrate) navigator.vibrate([180, 90, 180, 90, 260]);
      try {
        var Ctx = global.AudioContext || global.webkitAudioContext;
        if (!Ctx) return;
        if (!this._ctx) this._ctx = new Ctx();
        var ctx = this._ctx;
        if (ctx.state === 'suspended') ctx.resume();
        [0, 0.28, 0.56].forEach(function (offset) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = 'square';
          osc.frequency.value = 880;
          gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
          gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.01);
          gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.18);
          osc.connect(gain).connect(ctx.destination);
          osc.start(ctx.currentTime + offset);
          osc.stop(ctx.currentTime + offset + 0.2);
        });
      } catch (err) {
        /* no audio available — the haptic and the red bar still signal the end */
      }
    }
  };

  global.Timer = Timer;
})(window);
