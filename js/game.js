/* ============================================================
   LUCKY BRIDGE — game logic
   Outcome generation (weighted), tier evaluation, prize
   picker, persistent inventory, win / grand overlays, confetti,
   and test hooks (?test=1).
   ============================================================ */

(() => {
  const C = LB_CONFIG;
  const $ = (id) => document.getElementById(id);

  /* ============ prize state: shared server pool, local fallback ============
     Preferred: the shared-inventory API (every device playing the public
     link deducts from the SAME pool). If the API is unreachable — e.g. the
     static page is served from GitHub Pages before the backend exists —
     the page automatically falls back to per-device local mode. */
  let inventory = Object.fromEntries(C.prizes.map(p => [p.id, p.stock]));
  let claimLog = [];
  let SERVER_MODE = null; // null = probing, true = shared API, false = local

  /* on GitHub Pages the API lives on a separate host (C.apiBase);
     anywhere else (same-origin hosting) use relative /api/* */
  const API_BASE = (location.hostname.endsWith('.github.io') && C.apiBase) ? C.apiBase : '';

  async function api(path, body, timeoutMs = 12000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(API_BASE + '/api/' + path, body ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal,
      } : { signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { status: res.status, data });
      return data;
    } finally { clearTimeout(timer); }
  }

  /* ----- local (per-device) fallback mode ----- */
  function localLoad() {
    try { const v = JSON.parse(localStorage.getItem('luckyBridge.inv.v3')); if (v) inventory = v; } catch {}
    try { const a = JSON.parse(localStorage.getItem('luckyBridge.log.v3')); if (Array.isArray(a)) claimLog = a; } catch {}
    if (!inventory || C.prizes.some(p => !Number.isFinite(inventory[p.id]))) {
      inventory = Object.fromEntries(C.prizes.map(p => [p.id, p.stock]));
    }
  }
  function localPersist() {
    localStorage.setItem('luckyBridge.inv.v3', JSON.stringify(inventory));
    localStorage.setItem('luckyBridge.log.v3', JSON.stringify(claimLog));
  }
  function enterLocalMode(notify) {
    if (SERVER_MODE === false) return;
    SERVER_MODE = false;
    localLoad();
    renderPrizeGrid();
    if (notify) toast('⚠️ Offline mode — this device keeps its own stock');
  }
  function localLogEntry(tier, lines) {
    claimLog.push({ t: new Date().toISOString(), tier, items: lines.map(({ p, qty }) => ({ name: p.name, qty, special: !!p.special })) });
    if (claimLog.length > 500) claimLog = claimLog.slice(-500);
  }

  async function refreshState() {
    if (SERVER_MODE === false) { localLoad(); renderPrizeGrid(); return; }
    try {
      const s = await api('state');
      SERVER_MODE = true;
      inventory = s.inv; claimLog = s.log;
      renderPrizeGrid();
    } catch {
      if (SERVER_MODE === true) return;  // transient hiccup — keep the cached view
      enterLocalMode(true);              // API unreachable → local mode
    }
  }

  function renderLog() {
    const log = [...claimLog].reverse(); // newest first
    const list = $('logList');
    list.innerHTML = '';
    if (!log.length) {
      list.innerHTML = '<div class="log-empty">No claims yet — pull the lever!</div>';
    }
    const totals = {};
    for (const rec of log) {
      const row = document.createElement('div');
      row.className = 'log-row';
      const when = new Date(rec.t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      const itemsTxt = rec.items.length
        ? rec.items.map(i => `${i.name}${i.special ? ' ⭐' : ''} ×${i.qty}`).join(', ')
        : '(nothing left to take)';
      for (const i of rec.items) totals[i.name] = (totals[i.name] || 0) + i.qty;
      row.innerHTML = `
        <span class="when">${when}</span>
        <span class="tierchip t-${rec.tier.split(' ')[0].toLowerCase()}">${rec.tier}</span>
        <span class="items">${itemsTxt}</span>`;
      list.appendChild(row);
    }
    const totalAll = Object.values(totals).reduce((s, n) => s + n, 0);
    $('logSummary').innerHTML = log.length
      ? `${log.length} claim${log.length > 1 ? 's' : ''} · <b>${totalAll}</b> prizes taken in total`
      : 'Every claim will be recorded here.';
  }

  /* ================= outcome logic ================= */

  /** Pure tier evaluation — the single source of truth for the rules. */
  function evaluateOutcome(ids) {
    const specialCount = ids.filter(x => x === C.special.id).length;
    if (specialCount === 3) return tier('grand');
    if (specialCount === 2) return tier('doubleHit');
    const [a, b, c] = ids;
    if (a === b && b === c) return tier('first');
    if (a === b || b === c || a === c) return tier('second');
    return tier('third');
  }

  const TIERS = {
    third:    { key: 'third',    chip: 'THIRD PRIZE',  title: 'A little something!',  normal: 1, special: 0, cls: 't3', winKind: 'third',
                reward: n => `Pick <b>${n}</b> regular prize${n > 1 ? 's' : ''}` },
    second:   { key: 'second',   chip: 'SECOND PRIZE', title: 'A matching pair!',     normal: 2, special: 0, cls: 't2', winKind: 'second',
                reward: n => `Pick <b>${n}</b> regular prizes` },
    first:    { key: 'first',    chip: 'FIRST PRIZE',  title: 'Three of a kind!',     normal: 3, special: 0, cls: 't1', winKind: 'first',
                reward: n => `Pick <b>${n}</b> regular prizes` },
    doubleHit:{ key: 'doubleHit',chip: 'SPECIAL PAIR', title: 'Double BRIDGE!',       normal: 2, special: 1, cls: 'td', winKind: 'doubleHit',
                reward: n => `Pick <b>2</b> regular prizes <b>+ 1 special prize</b>` },
    grand:    { key: 'grand',    chip: 'GRAND PRIZE',  title: 'ONE OF EACH!',         normal: 0, special: 0, cls: 'tg', winKind: 'grand',
                reward: () => `Take <b>one of each</b> prize!` },
  };
  const tier = (k) => TIERS[k];

  const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const rand = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rand(arr.length)];

  /** Decide the three reel symbols by weighted tier, then construct a matching combo. */
  function generateOutcome() {
    const entries = Object.entries(C.weights);
    const total = entries.reduce((s, [, w]) => s + w, 0);
    let r = Math.random() * total;
    let bucket = entries[0][0];
    for (const [k, w] of entries) { if ((r -= w) <= 0) { bucket = k; break; } }

    const N = C.symbols.map(s => s.id);
    const S = C.special.id;
    switch (bucket) {
      case 'grand':     return [S, S, S];
      case 'doubleHit': return shuffle([S, S, pick(N)]);
      case 'first':     { const a = pick(N); return [a, a, a]; }
      case 'second': {
        const a = pick(N);
        let b = pick(N); while (b === a) b = pick(N);
        if (Math.random() < C.specialFlavorChance) b = S;   // [a,a,S] — still a pair → second
        return shuffle([a, a, b]);
      }
      case 'third':
      default: {
        const three = shuffle(N).slice(0, 3);
        if (Math.random() < C.specialFlavorChance) three[rand(3)] = S; // [S,a,b] — still all-different → third
        return shuffle(three);
      }
    }
  }

  /** Which reels deserve the winner glow. */
  function winnerIndices(ids, t) {
    if (t.key === 'grand' || t.key === 'first') return [0, 1, 2];
    if (t.key === 'doubleHit') return ids.map((x, i) => x === C.special.id ? i : -1).filter(i => i >= 0);
    if (t.key === 'second') {
      const pairId = ids.find(x => ids.filter(y => y === x).length === 2);
      return ids.map((x, i) => x === pairId ? i : -1).filter(i => i >= 0);
    }
    return [];
  }

  /* ================= confetti ================= */
  const confetti = (() => {
    const canvas = $('confetti');
    const ctx = canvas.getContext('2d');
    const COLORS = ['#53DBD3', '#F4C76B', '#FF8A7A', '#6E7BEB', '#2D5A7F', '#C3B7FF', '#17B7AE'];
    let pieces = [];
    let running = false;

    function resize() { canvas.width = innerWidth; canvas.height = innerHeight; }
    addEventListener('resize', resize); resize();

    function burst({ x = innerWidth / 2, y = innerHeight * .35, n = 90, spread = Math.PI, up = 11 } = {}) {
      for (let i = 0; i < n; i++) {
        const ang = -Math.PI / 2 + (Math.random() - .5) * spread;
        const v = up * (.4 + Math.random() * .8);
        pieces.push({
          x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v,
          w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
          rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .3,
          color: COLORS[rand(COLORS.length)], life: 1, decay: .005 + Math.random() * .004,
        });
      }
      run();
    }
    function rain(n = 26) {
      for (let i = 0; i < n; i++) {
        pieces.push({
          x: Math.random() * innerWidth, y: -20 - Math.random() * 80,
          vx: (Math.random() - .5) * 2, vy: 2 + Math.random() * 3,
          w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
          rot: Math.random() * Math.PI, vr: (Math.random() - .5) * .25,
          color: COLORS[rand(COLORS.length)], life: 1, decay: .004,
        });
      }
      run();
    }
    function run() {
      if (running) return;
      running = true;
      (function loop() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        pieces = pieces.filter(p => p.life > 0 && p.y < canvas.height + 40);
        for (const p of pieces) {
          p.vy += .18; p.vx *= .992;
          p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= p.decay;
          ctx.save();
          ctx.translate(p.x, p.y); ctx.rotate(p.rot);
          ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.4));
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
        if (pieces.length) requestAnimationFrame(loop);
        else { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); }
      })();
    }
    return { burst, rain };
  })();

  /* ================= UI helpers ================= */
  const toastEl = $('toast');
  let toastT = null;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }

  const symById = (id) => id === C.special.id ? C.special : C.symbols.find(s => s.id === id);

  function renderPrizeGrid() {
    const grid = $('prizeGrid');
    grid.innerHTML = '';
    for (const p of C.prizes) {
      const left = inventory[p.id];
      const card = document.createElement('div');
      card.className = 'card prize-card';
      card.innerHTML = `
        ${p.special ? '<span class="badge-special">⭐ SPECIAL</span>' : ''}
        <div class="ph"><img src="${p.img}" alt="${p.name}" loading="lazy"></div>
        <h3>${p.name}</h3>
        <div class="stock ${left === 0 ? 'out' : ''}">${left === 0 ? 'All claimed 🎉' : `<b>${left}</b> left`}</div>`;
      grid.appendChild(card);
    }
  }

  function renderRules() {
    const S = C.special, syms = Object.fromEntries(C.symbols.map(s => [s.id, s]));
    const rules = [
      { cls: 't3', chip: 'THIRD PRIZE',  icons: [syms.proud, S, syms.shocked],                     cond: '3 DIFFERENT', pick: 'PICK 1' },
      { cls: 't2', chip: 'SECOND PRIZE', icons: [syms.anxious, syms.anxious, syms.confused],       cond: 'A PAIR',      pick: 'PICK 2' },
      { cls: 't1', chip: 'FIRST PRIZE',  icons: [syms.greeting, syms.greeting, syms.greeting],     cond: '3 OF A KIND', pick: 'PICK 3' },
      { cls: 'td', chip: 'SPECIAL PAIR', icons: [S, S, syms.back],                                  cond: '2 EMBLEMS',   pick: '2 + 1 ⭐' },
      { cls: 'tg', chip: 'GRAND PRIZE',  icons: [S, S, S],                                          cond: '3 EMBLEMS',   pick: 'Take All' },
    ];
    const grid = $('rulesGrid');
    grid.innerHTML = '';
    for (const r of rules) {
      const div = document.createElement('div');
      div.className = 'card rule-card';
      div.innerHTML = `
        <div class="sym">${r.icons.map(x => `<img src="${x.img}" alt="${x.name}">`).join('')}</div>
        <div class="rule-txt">
          <span class="tier ${r.cls}">${r.chip}</span>
          <div class="rule-cond">${r.cond}</div>
          <div class="rule-pick">${r.pick}</div>
        </div>`;
      grid.appendChild(div);
    }
  }

  /* ================= overlays ================= */
  function showOverlay(el) { el.classList.add('show'); }
  function hideOverlay(el) { el.classList.remove('show'); }

  function showWinModal(ids, t) {
    const chip = $('winChip');
    chip.textContent = t.chip;
    chip.style.cssText = {
      third: 'background:var(--data-cyan);color:var(--bridge-navy)',
      second: 'background:var(--cell-mist);color:var(--deep-sea)',
      first: 'background:var(--soft-lavender);color:#3d2f8f',
      doubleHit: 'background:rgba(244,199,107,.35);color:#8a5a00',
      grand: '',
    }[t.key];
    $('winTitle').textContent = t.title;
    $('winReward').innerHTML = t.reward(t.normal);
    const line = $('winSymbols');
    line.innerHTML = '';
    for (const id of ids) {
      const img = new Image();
      img.src = symById(id).img; img.alt = symById(id).name;
      line.appendChild(img);
    }
    $('winPickBtn').onclick = () => { hideOverlay($('winOverlay')); openPicker(t); };
    showOverlay($('winOverlay'));
  }

  /* ---------- picker ---------- */
  let pickState = null;

  function openPicker(t) {
    const normalBudget = t.normal, specialBudget = t.special;
    pickState = { t, sel: {}, normalBudget, specialBudget };

    function buildCard(p, kind) {
      const left = inventory[p.id];
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'pick-item';
      el.innerHTML = `
        <span class="count" data-count>0</span>
        <div class="ph"><img src="${p.img}" alt="${p.name}"></div>
        <h4>${p.name}${p.special ? ' ⭐' : ''}</h4>
        <div class="left">${left} left</div>`;
      el.disabled = left === 0;
      el.onclick = () => {
        const cur = pickState.sel[p.id] || 0;
        const usedNormal = normalUsed();
        const usedSpecial = specialUsed();
        if (kind === 'normal' ? usedNormal >= normalBudget : usedSpecial >= specialBudget) {
          toast(kind === 'normal' ? `You can pick ${normalBudget} regular prizes` : 'Only 1 special prize per win');
          return;
        }
        if (cur >= left) { toast(`Only ${left} × ${p.name} left`); return; }
        pickState.sel[p.id] = cur + 1;
        refresh();
      };
      return el;
    }

    const normalUsed = () => C.prizes.filter(p => !p.special).reduce((s, p) => s + (pickState.sel[p.id] || 0), 0);
    const specialUsed = () => C.prizes.filter(p => p.special).reduce((s, p) => s + (pickState.sel[p.id] || 0), 0);

    function refresh() {
      const nGrid = $('pickNormal'), sGrid = $('pickSpecial');
      nGrid.innerHTML = ''; sGrid.innerHTML = '';
      for (const p of C.prizes) {
        const el = buildCard(p, p.special ? 'special' : 'normal');
        const sel = pickState.sel[p.id] || 0;
        if (sel > 0) { el.classList.add('selected'); el.querySelector('[data-count]').textContent = sel; }
        (p.special ? sGrid : nGrid).appendChild(el);
      }
      $('pickSpecialSection').style.display = specialBudget > 0 ? '' : 'none';
      const usedN = normalUsed(), usedS = specialUsed();
      $('pickBudget').innerHTML = specialBudget
        ? `Regular <span class="n">${usedN} / ${normalBudget}</span> &nbsp;·&nbsp; Special <span class="n">${usedS} / ${specialBudget}</span>`
        : `Selected <span class="n">${usedN} / ${normalBudget}</span>`;

      const availN = C.prizes.filter(p => !p.special).reduce((s, p) => s + inventory[p.id], 0);
      const availS = C.prizes.filter(p => p.special).reduce((s, p) => s + inventory[p.id], 0);
      // complete = picked as much as the budget allows given remaining stock
      // (when stock is exhausted, confirm stays available so the flow can end gracefully)
      const complete = usedN >= Math.min(normalBudget, availN) && usedS >= Math.min(specialBudget, availS);
      $('pickConfirm').disabled = !complete;
    }

    $('pickConfirm').onclick = () => { claimSelection(); };
    refresh();
    showOverlay($('pickOverlay'));
  }

  async function claimSelection() {
    const lines = [];
    const items = [];
    for (const p of C.prizes) {
      const n = pickState.sel[p.id] || 0;
      if (n > 0) { lines.push({ p, qty: n }); items.push({ id: p.id, qty: n }); }
    }
    if (SERVER_MODE === false) {           // local mode: mutate this device's copy
      for (const it of items) inventory[it.id] = Math.max(0, (inventory[it.id] || 0) - it.qty);
      localLogEntry(pickState.t.chip, lines);
      localPersist(); renderPrizeGrid();
      hideOverlay($('pickOverlay'));
      showReceipt(lines);
      return;
    }
    try {
      const r = await api('claim', { tier: pickState.t.chip, items });
      inventory = r.inv; claimLog = r.log; renderPrizeGrid();
      hideOverlay($('pickOverlay'));
      showReceipt(lines);
    } catch (e) {
      if (e.status === 409) {
        await refreshState();
        toast('Someone just claimed that prize — stock refreshed, pick again!');
        openPicker(pickState.t);
      } else {
        toast('Cannot reach the prize table — check the connection');
      }
    }
  }

  function showReceipt(lines) {
    const list = $('receiptList');
    list.innerHTML = '';
    if (!lines.length) {
      list.innerHTML = '<div class="receipt-note">All prizes have been claimed — ask our staff to restock the table!</div>';
    }
    for (const { p, qty } of lines) {
      const row = document.createElement('div');
      row.className = 'receipt-row';
      row.innerHTML = `<img src="${p.img}" alt=""><span class="name">${p.name}${p.special ? ' ⭐' : ''}</span><span class="qty">× ${qty}</span>`;
      list.appendChild(row);
    }
    showOverlay($('receiptOverlay'));
  }

  /* ---------- grand ---------- */
  function showGrand() {
    const items = $('grandItems');
    items.innerHTML = '';
    const available = C.prizes.filter(p => inventory[p.id] > 0);
    if (!available.length) {
      items.innerHTML = '<p class="sub">…though the table is empty right now. Legendary luck, terrible timing!</p>';
    }
    available.forEach((p, i) => {
      const div = document.createElement('div');
      div.className = 'g-item';
      div.style.animationDelay = `${.25 + i * .18}s`;
      div.innerHTML = `
        <div class="ph"><img src="${p.img}" alt="${p.name}"><span class="qty">× 1</span></div>
        <h4>${p.name}${p.special ? ' ⭐' : ''}</h4>`;
      items.appendChild(div);
    });
    $('grandClaim').onclick = async () => {
      if (SERVER_MODE === false) {
        const lines = C.prizes.filter(p => inventory[p.id] > 0).map(p => ({ p, qty: 1 }));
        for (const l of lines) inventory[l.p.id] -= 1;
        localLogEntry('GRAND PRIZE', lines);
        localPersist(); renderPrizeGrid();
        $('grandOverlay').classList.remove('show');
        showReceipt(lines);
        return;
      }
      try {
        const r = await api('claimAll', { tier: 'GRAND PRIZE' });
        const lines = (r.claimed || []).map(c => ({ p: C.prizes.find(p => p.id === c.id), qty: c.qty }));
        inventory = r.inv; claimLog = r.log; renderPrizeGrid();
        $('grandOverlay').classList.remove('show');
        showReceipt(lines);
      } catch {
        toast('Cannot reach the prize table — check the connection');
      }
    };
    $('grandOverlay').classList.add('show');
    LB_AUDIO.grand();
    confetti.burst({ x: innerWidth * .2, y: innerHeight * .75, n: 130, spread: 1.4, up: 15 });
    confetti.burst({ x: innerWidth * .8, y: innerHeight * .75, n: 130, spread: 1.4, up: 15 });
    let bursts = 0;
    const iv = setInterval(() => {
      confetti.rain(24);
      if (++bursts > 8) clearInterval(iv);
    }, 550);
  }

  /* ================= spin flow ================= */
  let spinning = false;
  const spinBtn = $('spinBtn');
  const statusEl = $('status');

  function setStatus(html) { statusEl.innerHTML = html; }

  function spin(forcedIds) {
    if (spinning) return;
    spinning = true;
    spinBtn.disabled = true;
    LB_AUDIO.unlock();
    setStatus('Good luck<span class="dots"></span>');

    LB_SLOT.pullLever(() => {
      const ids = forcedIds ? [...forcedIds] : generateOutcome();
      LB_SLOT.spinTo(ids.map(symById), {
        onReelStop: () => {},
        onDone: () => {
          const t = evaluateOutcome(ids);
          const glowIdx = winnerIndices(ids, t);
          LB_SLOT.markWinners(glowIdx);
          // neon-flash ONLY the matched frames: the pair for two-of-a-kind,
          // all three for a triple; all-different wins flash nothing.
          if (t.key !== 'third') LB_SLOT.flashReels(glowIdx);
          if (t.key === 'grand') {
            setStatus('🌟 <b>GRAND PRIZE!</b> One of each prize!');
          } else {
            setStatus(`🎉 ${t.chip} — ${t.reward(t.normal).replace(/<[^>]+>/g, '')}`);
            LB_AUDIO.win(t.winKind);
            confetti.burst({ n: t.key === 'third' ? 60 : 110 });
          }
          // matched results blink ~2.4s before the dialog; no-match wins
          // come up after a short beat
          const delay = t.key === 'third' ? 800 : 2400;
          setTimeout(() => {
            LB_SLOT.stopFlash();
            spinning = false;
            spinBtn.disabled = false;
            if (t.key === 'grand') showGrand();
            else showWinModal(ids, t);
          }, delay);
        },
      });
    });
  }

  spinBtn.addEventListener('click', () => spin());
  LB_SLOT.onLeverPull(() => spin());

  /* ================= misc controls ================= */
  const muteBtn = $('muteBtn');
  function renderMute() { muteBtn.textContent = LB_AUDIO.isMuted() ? '🔇' : '🔊'; }
  muteBtn.addEventListener('click', () => { LB_AUDIO.unlock(); LB_AUDIO.toggleMute(); renderMute(); });
  renderMute();

  /* staff reset — the PIN is verified SERVER-side */
  let pinBuf = '';
  const pinModal = $('pinOverlay');

  function renderPin() {
    [...$('pinDots').children].forEach((dot, i) => dot.classList.toggle('on', i < pinBuf.length));
  }
  function openPin() {
    pinBuf = '';
    renderPin();
    $('pinError').textContent = '';
    showOverlay(pinModal);
  }
  function wrongPin() {
    $('pinError').textContent = 'Wrong PIN — try again';
    const box = pinModal.querySelector('.pin-modal');
    box.classList.remove('shake');
    void box.offsetWidth; /* restart the shake animation */
    box.classList.add('shake');
    pinBuf = '';
    setTimeout(renderPin, 220);
  }
  async function submitPin() {
    const pin = pinBuf;
    pinBuf = '';
    if (SERVER_MODE === false) {           // local mode: compare against the local PIN
      if (pin !== String(C.localPin)) { wrongPin(); return; }
      inventory = Object.fromEntries(C.prizes.map(p => [p.id, p.stock]));
      claimLog = [];
      localPersist(); renderPrizeGrid();
      hideOverlay(pinModal);
      toast('Prize stock & claim log have been reset ✅');
      return;
    }
    try {
      const r = await api('reset', { pin });
      inventory = r.inv; claimLog = r.log; renderPrizeGrid();
      hideOverlay(pinModal);
      toast('Prize stock & claim log have been reset ✅');
    } catch (e) {
      if (e.status === 403) wrongPin();
      else { hideOverlay(pinModal); toast('Cannot reach the prize table — check the connection'); }
    }
  }
  function pinKey(k) {
    if (k === 'C') pinBuf = '';
    else if (k === 'B') pinBuf = pinBuf.slice(0, -1);
    else if (/^[0-9]$/.test(k) && pinBuf.length < 4) {
      pinBuf += k;
      renderPin();
      if (pinBuf.length === 4) setTimeout(submitPin, 140);
      return;
    }
    renderPin();
  }

  $('resetBtn').addEventListener('click', openPin);
  $('keypad').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-key]');
    if (btn) pinKey(btn.dataset.key);
  });
  document.addEventListener('keydown', (e) => {
    if (!pinModal.classList.contains('show')) return;
    if (/^[0-9]$/.test(e.key)) pinKey(e.key);
    else if (e.key === 'Backspace') pinKey('B');
    else if (e.key === 'Escape') hideOverlay(pinModal);
  });

  $('receiptDone').addEventListener('click', () => {
    hideOverlay($('receiptOverlay'));
    setStatus('Press <b>SPIN</b> or pull the lever to play again');
  });

  /* claim log UI — always fetch fresh state before showing */
  $('logBtn').addEventListener('click', async () => { await refreshState(); renderLog(); showOverlay($('logOverlay')); });
  $('logClose').addEventListener('click', () => hideOverlay($('logOverlay')));
  $('logClear').addEventListener('click', () => {
    toast('Use the staff reset (footer) to clear the log');
  });

  /* X buttons + Esc close any dialog (closing a picker/receipt skips the flow) */
  document.addEventListener('click', (e) => {
    const x = e.target.closest('.modal-x');
    if (!x) return;
    const overlay = x.closest('.overlay, .grand');
    if (!overlay) return;
    overlay.classList.remove('show');
    if (overlay.id === 'pickOverlay' || overlay.id === 'receiptOverlay') {
      setStatus('Press <b>SPIN</b> or pull the lever to play again');
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.overlay.show, .grand.show')].pop();
    if (open) {
      open.classList.remove('show');
      if (open.id === 'pickOverlay' || open.id === 'receiptOverlay') {
        setStatus('Press <b>SPIN</b> or pull the lever to play again');
      }
    }
  });

  /* ================= boot ================= */
  LB_SLOT.setIdle();
  renderPrizeGrid();
  renderRules();
  refreshState();
  /* keep the shared pool fresh on screen */
  setInterval(refreshState, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshState(); });

  /* ================= test hooks ================= */
  window.__lb = {
    spin,
    force: (ids) => spin(ids),
    evaluate: evaluateOutcome,
    generate: generateOutcome,
    inventory: () => ({ ...inventory }),
    log: () => [...claimLog],
    mode: () => SERVER_MODE,
    async reset(pin) {
      if (SERVER_MODE === false) {
        inventory = Object.fromEntries(C.prizes.map(p => [p.id, p.stock]));
        claimLog = [];
        localPersist(); renderPrizeGrid();
        return { inv: inventory, log: claimLog };
      }
      const r = await api('reset', { pin });
      inventory = r.inv; claimLog = r.log; renderPrizeGrid();
      return r;
    },
    refresh: refreshState,
    confetti,
    runTest() {
      const N = C.symbols.map(s => s.id), S = C.special.id;
      const all = [...N, S];
      let pass = 0, fail = 0;
      const counts = {};
      for (const a of all) for (const b of all) for (const c of all) {
        const t = evaluateOutcome([a, b, c]);
        counts[t.key] = (counts[t.key] || 0) + 1;
        // independent oracle
        const sp = [a, b, c].filter(x => x === S).length;
        let expect;
        if (sp === 3) expect = 'grand';
        else if (sp === 2) expect = 'doubleHit';
        else if (a === b && b === c) expect = 'first';
        else if (a === b || b === c || a === c) expect = 'second';
        else expect = 'third';
        if (expect === t.key) pass++; else { fail++; console.error('FAIL', [a, b, c], 'expected', expect, 'got', t.key); }
      }
      console.log(`evaluateOutcome: ${pass} pass / ${fail} fail of ${all.length ** 3} combos`);
      console.table(counts);
      // weight sanity over 100k samples
      const dist = {};
      const R = 100000;
      for (let i = 0; i < R; i++) { const t = evaluateOutcome(generateOutcome()); dist[t.key] = (dist[t.key] || 0) + 1; }
      console.log('sampled distribution over 100k spins (%):');
      console.table(Object.fromEntries(Object.entries(dist).map(([k, v]) => [k, (100 * v / R).toFixed(2)])));
      return fail === 0;
    },
  };
  if (new URLSearchParams(location.search).get('test')) window.__lb.runTest();
})();
