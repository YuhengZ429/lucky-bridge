/* ============================================================
   LUCKY BRIDGE — slot machine engine
   Reel strips, spin easing (spin-up → long deceleration),
   staggered stops with overshoot bounce, dynamic motion blur,
   and the lever animation. The outcome is decided by game.js
   BEFORE the reels move; reels only animate to land on it.
   ============================================================ */

const LB_SLOT = (() => {
  const machine = document.getElementById('machine');
  const reels = [...document.querySelectorAll('.reel')];
  const lever = document.getElementById('lever');
  const cfg = LB_CONFIG.spin;

  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];

  function cellH() {
    const v = parseFloat(getComputedStyle(machine).getPropertyValue('--cell'));
    return v || 150;
  }

  function windowH(reel) { return reel.clientHeight; }

  function cellEl(sym) {
    const div = document.createElement('div');
    div.className = 'cell' + (sym.id === 'special' ? ' special' : '');
    div.dataset.sym = sym.id;
    const img = document.createElement('img');
    img.src = sym.img;
    img.alt = sym.name;
    div.appendChild(img);
    return div;
  }

  /** Fill a reel strip so that `centerSym` sits centred and calm. */
  function idleStrip(strip, centerSym, cellPx, baseY) {
    strip.innerHTML = '';
    strip.style.transition = 'none';
    strip.style.filter = '';
    const around = [pick(LB_CONFIG.symbols), pick(LB_CONFIG.symbols), centerSym, pick(LB_CONFIG.symbols), pick(LB_CONFIG.symbols)];
    for (const s of around) strip.appendChild(cellEl(s));
    const idx = 2;
    strip.style.transform = `translateY(${baseY - idx * cellPx}px)`;
  }

  function setIdle() {
    const cellPx = cellH();
    for (const reel of reels) {
      const strip = reel.querySelector('.strip');
      const baseY = (windowH(reel) - cellPx) / 2;
      idleStrip(strip, pick(LB_CONFIG.symbols), cellPx, baseY);
    }
    machine.classList.remove('spinning', 'landed');
    reels.forEach(r => r.classList.remove('winner'));
  }

  /* ---------- easing ----------
     Segment A (spin-up):   t ∈ [0, .2]  easeInQuad  → 10% of distance
     Segment B (deceleration): cubic Hermite, C1-matched velocity,
                               ends at rest on the overshoot point. */
  function makeEase() {
    const splitT = 0.2, splitD = 0.10;
    return (t) => {
      if (t < splitT) {
        const u = t / splitT;
        return splitD * u * u; // easeInQuad
      }
      const s = (t - splitT) / (1 - splitT);
      // Hermite p0=0 p1=1, m1=0; m0 matches segment-A end velocity
      // vA = 2·splitD/splitT (progress units per t); converted to h'(0):
      const m0 = (2 * splitD / splitT) / ((1 - splitD) / (1 - splitT)); // ≈ 0.889
      const h = (2 * s ** 3 - 3 * s ** 2 + 1) * 0
              + (s ** 3 - 2 * s ** 2 + s) * m0
              + (-2 * s ** 3 + 3 * s ** 2) * 1
              + (s ** 3 - s ** 2) * 0;
      return splitD + (1 - splitD) * h;
    };
  }

  /**
   * Spin all reels to land on `targets` (array of 3 symbol objects).
   * Callbacks: onReelStop(i), onDone().
   */
  function spinTo(targets, { onReelStop, onDone } = {}) {
    machine.classList.add('spinning');
    machine.classList.remove('landed');
    reels.forEach(r => r.classList.remove('winner'));

    const cellPx = cellH();
    const ease = makeEase();
    let stopped = 0;

    const states = reels.map((reel, i) => {
      const strip = reel.querySelector('.strip');
      const baseY = (windowH(reel) - cellPx) / 2;
      const endIndex = 2;
      const laps = 3 + i + rand(2);                    // later reels travel further
      const startIndex = endIndex + laps * 7 + 5 + rand(5);

      // Build strip: index endIndex holds the target symbol.
      strip.innerHTML = '';
      strip.style.transition = 'none';
      const syms = [];
      for (let k = 0; k <= startIndex + 3; k++) {
        syms.push(k === endIndex ? targets[i]
               : k === endIndex - 1 || k === endIndex + 1 ? pick(LB_CONFIG.symbols)
               : k < endIndex ? pick(LB_CONFIG.symbols)
               : pick(LB_CONFIG.symbols));
      }
      for (const s of syms) strip.appendChild(cellEl(s));

      const p0 = baseY - startIndex * cellPx;
      const pEnd = baseY - endIndex * cellPx;
      const D = pEnd - p0;                              // > 0 → strip moves down
      const over = cfg.overshotPx;
      const duration = cfg.baseDuration + i * cfg.reelStagger;

      strip.style.transform = `translateY(${p0}px)`;
      return { reel, strip, p0, pEnd, D, over, duration, t0: null, lastP: p0, lastT: 0, settled: false, i };
    });

    const vmax = states.map(s => s.D / s.duration).sort((a, b) => b - a)[0] * 2.2;

    function speedNow() {
      let v = 0;
      for (const s of states) {
        if (s.settled) continue;
        v = Math.max(v, s.curV || 0);
      }
      return v / (vmax / 2.2); // 0..1-ish
    }
    LB_AUDIO.startTicks(speedNow);

    function frame(now) {
      let allDone = true;
      for (const s of states) {
        if (s.settled) continue;
        allDone = false;
        if (s.t0 === null) { s.t0 = now; s.lastT = now; }
        const t = Math.min(1, (now - s.t0) / s.duration);
        const pMain = s.p0 + (s.D + s.over) * ease(t);

        if (t < 1) {
          s.strip.style.transform = `translateY(${pMain}px)`;
          const dt = Math.max(1, now - s.lastT);
          s.curV = Math.abs(pMain - s.lastP) / dt;
          const blur = Math.min(7, (s.curV / vmax) * 7);
          s.strip.style.filter = blur > .6 ? `blur(${blur.toFixed(1)}px)` : '';
          s.lastP = pMain; s.lastT = now;
        } else {
          // main travel done (on the overshoot point) → springy settle
          s.curV = 0;
          s.strip.style.filter = '';
          s.strip.style.transition = `transform ${cfg.settleMs}ms cubic-bezier(.2, 1.6, .4, 1)`;
          s.strip.style.transform = `translateY(${s.pEnd}px)`;
          s.settled = true;
          LB_AUDIO.reelStop();
          onReelStop && onReelStop(s.i);
        }
      }
      if (!allDone) requestAnimationFrame(frame);
      else {
        setTimeout(() => {
          LB_AUDIO.stopTicks();
          machine.classList.remove('spinning');
          machine.classList.add('landed');
          onDone && onDone();
        }, cfg.settleMs);
      }
    }
    requestAnimationFrame(frame);
  }

  /* ---------- lever ---------- */

  function pullLever(onDown) {
    lever.classList.remove('release');
    lever.classList.add('pulled');
    LB_AUDIO.lever();
    // arm reaches the bottom of its arc at ~300ms — reels kick off there
    setTimeout(() => { onDown && onDown(); }, 240);
    // release + spring back up
    setTimeout(() => {
      lever.classList.remove('pulled');
      lever.classList.add('release');
      LB_AUDIO.leverRelease();
    }, 560);
    setTimeout(() => lever.classList.remove('release'), 1300);
  }

  function onLeverPull(fn) {
    const handler = (e) => { e.preventDefault(); fn(); };
    lever.addEventListener('click', handler);
    lever.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') handler(e); });
  }

  function markWinners(indices) {
    indices.forEach(i => reels[i] && reels[i].classList.add('winner'));
  }

  /** Neon-blink the given reel frames (casino marquee style). */
  function flashReels(indices) {
    stopFlash();
    indices.forEach(i => reels[i] && reels[i].classList.add('flash'));
  }
  function stopFlash() {
    reels.forEach(r => r.classList.remove('flash'));
  }

  return { setIdle, spinTo, pullLever, onLeverPull, markWinners, flashReels, stopFlash };
})();
