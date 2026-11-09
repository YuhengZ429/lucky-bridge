/* ============================================================
   LUCKY BRIDGE — WebAudio sound engine (no audio files needed)
   All sounds are synthesised: lever thunk, reel ticks, stops,
   win arpeggios and a dedicated grand-prize fanfare.
   ============================================================ */

const LB_AUDIO = (() => {
  let ctx = null;
  let muted = localStorage.getItem(LB_CONFIG.muteKey) === '1';
  let tickTimer = null;

  function ac() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /** Unlock audio on the first user gesture (browser policy). */
  function unlock() { ac(); }

  function on() { return !muted && ac(); }

  /* ---------- primitives ---------- */

  function tone({ freq = 440, type = 'sine', t0 = 0, dur = .2, vol = .2, glide = null, attack = .005 }) {
    const c = ac(); if (!c) return;
    const start = c.currentTime + t0;
    const osc = c.createOscillator();
    const g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (glide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, glide), start + dur);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + attack);
    g.gain.exponentialRampToValueAtTime(.0001, start + dur);
    osc.connect(g).connect(c.destination);
    osc.start(start); osc.stop(start + dur + .05);
  }

  function noise({ t0 = 0, dur = .15, vol = .25, freq = 900, q = .8 }) {
    const c = ac(); if (!c) return;
    const start = c.currentTime + t0;
    const len = Math.max(1, Math.floor(c.sampleRate * dur));
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, start);
    g.gain.exponentialRampToValueAtTime(.0001, start + dur);
    src.connect(bp).connect(g).connect(c.destination);
    src.start(start);
  }

  /* ---------- game sounds ---------- */

  /** Lever pull: mechanical thunk. */
  function lever() {
    if (!on()) return;
    noise({ dur: .1, vol: .3, freq: 1800, q: .6 });
    tone({ freq: 190, type: 'triangle', dur: .18, vol: .3, glide: 70 });
    tone({ t0: .02, freq: 90, type: 'sine', dur: .22, vol: .25, glide: 45 });
  }

  /** Lever release: springy boing. */
  function leverRelease() {
    if (!on()) return;
    tone({ freq: 140, type: 'triangle', dur: .16, vol: .18, glide: 320 });
  }

  /** Reel tick — called repeatedly while spinning. */
  function tick(speed = 1) {
    if (!on()) return;
    noise({ dur: .025, vol: .08 * Math.min(1, speed), freq: 2400, q: 2 });
  }

  /** Start the tick loop; speedFn() returns 0..1 to fade ticks with reel speed. */
  function startTicks(speedFn) {
    stopTicks();
    if (!on()) return;
    let last = performance.now();
    const loop = (now) => {
      const s = speedFn();
      if (s > .04) {
        const gap = 45 + 105 * (1 - Math.min(1, s));
        if (now - last > gap) { tick(s); last = now; }
      }
      tickTimer = requestAnimationFrame(loop);
    };
    tickTimer = requestAnimationFrame(loop);
  }

  function stopTicks() {
    if (tickTimer) cancelAnimationFrame(tickTimer);
    tickTimer = null;
  }

  /** A single reel stops: wooden clack. */
  function reelStop() {
    if (!on()) return;
    noise({ dur: .05, vol: .22, freq: 1300, q: 1.2 });
    tone({ freq: 240, type: 'square', dur: .07, vol: .1, glide: 150 });
    tone({ t0: .01, freq: 110, type: 'sine', dur: .12, vol: .2, glide: 60 });
  }

  /* ---------- wins ---------- */

  const NOTE = (n) => 440 * Math.pow(2, (n - 69) / 12); // midi -> Hz

  /** Win jingles per tier: third / second / first / doubleHit. */
  function win(kind) {
    if (!on()) return;
    const seqs = {
      third:    [ { n: 76, d: .14 }, { n: 81, d: .16 }, { n: 88, d: .34 } ],
      second:   [ { n: 72, d: .12 }, { n: 76, d: .12 }, { n: 79, d: .12 }, { n: 84, d: .22 }, { n: 88, d: .4 } ],
      first:    [ { n: 69, d: .12 }, { n: 73, d: .12 }, { n: 76, d: .12 }, { n: 81, d: .2 }, { n: 85, d: .2 }, { n: 88, d: .5 } ],
      doubleHit:[ { n: 71, d: .11 }, { n: 76, d: .11 }, { n: 80, d: .11 }, { n: 83, d: .16 }, { n: 87, d: .16 }, { n: 92, d: .55 } ],
    };
    let t = 0;
    for (const { n, d } of seqs[kind] || seqs.third) {
      tone({ t0: t, freq: NOTE(n), type: 'triangle', dur: d, vol: .22 });
      tone({ t0: t, freq: NOTE(n) * 2, type: 'sine', dur: d * .7, vol: .07 });
      t += d * .78;
    }
    // sparkle
    for (let i = 0; i < 4; i++) {
      tone({ t0: t + .05 + i * .07, freq: NOTE(93 + i * 3), type: 'sine', dur: .18, vol: .06 });
    }
  }

  /** Grand prize fanfare — its own bigger sound. */
  function grand() {
    if (!on()) return;
    // rising sweep
    tone({ freq: 110, type: 'sawtooth', dur: 1.1, vol: .1, glide: 880 });
    // trumpet-ish chords
    const chords = [
      [ 60, 64, 67 ], [ 65, 69, 72 ], [ 67, 71, 74 ], [ 72, 76, 79 ],
    ];
    let t = .25;
    for (const ch of chords) {
      for (const n of ch) {
        tone({ t0: t, freq: NOTE(n), type: 'sawtooth', dur: .26, vol: .09 });
        tone({ t0: t, freq: NOTE(n + 12), type: 'triangle', dur: .26, vol: .07 });
      }
      t += .24;
    }
    // final big chord + bells
    for (const n of [ 72, 76, 79, 84 ]) {
      tone({ t0: t, freq: NOTE(n), type: 'sawtooth', dur: 1.1, vol: .1 });
    }
    for (let i = 0; i < 8; i++) {
      tone({ t0: t + .12 * i, freq: NOTE(96 - i * 2), type: 'sine', dur: .3, vol: .05 });
    }
    // drum roll underneath
    for (let i = 0; i < 10; i++) {
      noise({ t0: i * .1, dur: .06, vol: .12, freq: 300 + i * 30, q: .8 });
    }
  }

  function toggleMute() {
    muted = !muted;
    localStorage.setItem(LB_CONFIG.muteKey, muted ? '1' : '0');
    return muted;
  }

  function isMuted() { return muted; }

  return { unlock, lever, leverRelease, startTicks, stopTicks, reelStop, win, grand, toggleMute, isMuted };
})();
