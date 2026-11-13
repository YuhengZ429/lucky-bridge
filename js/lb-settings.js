/* ============================================================
   LUCKY BRIDGE — configuration
   Edit this file to tweak symbols, prizes, stock and odds.
   ============================================================ */

const LB_CONFIG = {
  /* ----- reel symbols (normal) ----- */
  symbols: [
    { id: 'greeting',  name: 'Greeting',  img: 'assets/symbols/greeting.png?v=8f8d3fd'  },
    { id: 'proud',     name: 'Proud',     img: 'assets/symbols/proud.png?v=8f8d3fd'     },
    { id: 'shocked',   name: 'Shocked',   img: 'assets/symbols/shocked.png?v=8f8d3fd'   },
    { id: 'anxious',   name: 'Anxious',   img: 'assets/symbols/anxious.png?v=8f8d3fd'   },
    { id: 'confused',  name: 'Confused',  img: 'assets/symbols/confused.png?v=8f8d3fd'  },
    { id: 'back',      name: 'Peek',      img: 'assets/symbols/back.png?v=8f8d3fd'      },
  ],

  /* ----- the special symbol ----- */
  special: { id: 'special', name: 'BRIDGE', img: 'assets/symbols/special.png?v=8f8d3fd' },

  /* ----- prizes -----
     stock is the initial inventory; live counts persist in
     localStorage so a page refresh never resets the table. */
  prizes: [
    { id: 'keychain',    name: 'Keychain',       img: 'assets/prizes/keychain.jpg?v=8f8d3fd',    stock: 90, special: false },
    { id: 'postcard',    name: 'Postcard',       img: 'assets/prizes/postcard.jpg?v=8f8d3fd',    stock: 90, special: false },
    { id: 'stickersheet',name: 'Sticker Pack',   img: 'assets/prizes/stickersheet.jpg?v=8f8d3fd',stock: 120, special: false },
    { id: 'coaster',     name: 'Coaster',        img: 'assets/prizes/coaster.jpg?v=8f8d3fd',     stock: 50, special: true  },
  ],

  /* ----- outcome weights (%), "generous" tuning -----
     grand      : 3 emblems  -> take everything
     doubleHit  : 2 emblems  -> 2 regular + 1 special
     first      : 3 of a kind -> 3 regular picks
     second     : one pair    -> 2 regular picks
     third      : all different -> 1 regular pick
     (each spin lands in exactly one bucket; a lone emblem
      simply acts as a normal symbol within the bucket) */
  weights: {
    grand:    10.0,
    doubleHit: 10.0,
    first:    10.0,
    second:   30.0,
    third:    40.0,
  },

  /* chance that a "third"/"second" outcome shows one emblem
     as its odd-one-out symbol (visual spice, tier unchanged) */
  specialFlavorChance: 0.28,

  /* reel timing (ms) */
  spin: {
    baseDuration: 3400,   // reel 1 total travel time
    reelStagger:  520,    // extra delay per subsequent reel
    settleMs:     260,    // final bounce duration
    overshotPx:   14,     // bounce overshoot
  },

  muteKey: 'luckyBridge.muted.v1',

  /* ----- hosting / shared-inventory API -----
     apiBase is used ONLY when the page is hosted on GitHub Pages
     (same-origin deployments ignore it and use relative /api/*).
     Point it at the Render service URL. If the API cannot be reached,
     the page automatically falls back to per-device local mode. */
  apiBase: 'https://lucky-bridge-api.onrender.com',

  /* PIN used in local/offline mode (no server to verify it) */
  localPin: '2026',
};
