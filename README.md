# 🎰 Lucky BRIDGE — Slot Machine Lucky Draw

A showy arcade-style slot machine lucky-draw web app for the **iGEM 2026 CSU-China (BRIDGE)** team — pull the lever, match the mascots, take home the merch.

![-](assets/symbols/special.png)

## ✨ Features

- **One-armed bandit lever** — a gold side-axis press lever (mount slab + straight rod + glossy red ball, faithful to the classic form) that swings down in a real arc
- **Weighted outcomes, everyone wins** — three different / a pair / three of a kind / two BRIDGE emblems / three emblems (Grand Prize: one of each prize)
- **Neon suspense** — winning frames blink casino-neon for ~2.4 s before the result dialog opens
- **Shared inventory** — a Node backend owns the prize pool & claim log; every device playing the same link deducts from one pool (server-side atomic checks, no over-claiming)
- **Staff tools** — 4-digit PIN-protected reset (server-verified), live claim log, per-prize stock display
- **Synthesised sound** — lever thunk, reel ticks, per-tier jingles and a grand-prize fanfare (WebAudio, no audio files)
- **Mobile-ready** — responsive breakpoints down to 320 px, touch-friendly keypad and cards

## 🚀 Run locally

```bash
node server/server.mjs          # serves the site + API on http://localhost:3000
```

Requires Node 18+. Static-only mode (`python3 -m http.server`) works for browsing, but claims need the API server.

## 🔧 Configuration

| What | Where |
|---|---|
| Reel symbols, prize list, outcome weights | `js/lb-settings.js` |
| Initial stock, staff PIN (`STAFF_PIN`, default `2026`) | `server/server.mjs` |
| State persistence | `data/state.json` (auto-created) |

## 🧱 Project layout

```
index.html            page shell (machine, sections, dialogs)
css/tokens.css        BRIDGE design tokens (iGEM 2026 CSU-China palette)
css/main.css          cabinet, lever, reels, dialogs, responsive rules
js/lb-settings.js     symbols / prizes / weights config
js/audio.js           WebAudio sound engine
js/slot.js            reel animation engine + lever mechanics
js/game.js            game logic, shared-state API client, dialogs
server/server.mjs     static hosting + shared inventory API (zero deps)
tools/                asset-processing scripts (trim/compress artwork)
```

## 📜 Prize rules

| Result | Prize |
|---|---|
| 3 different mascots | pick **1** regular prize |
| a matching pair | pick **2** regular prizes |
| 3 of a kind | pick **3** regular prizes |
| 2 BRIDGE emblems | 2 regular **+ 1 special** (coaster) |
| 3 BRIDGE emblems | **one of each prize** 🎉 |

A single BRIDGE emblem counts as a normal symbol.

---

Built with ❤️ by BRIDGE · iGEM 2026 · CSU-China

## 🌐 Hosting

**Frontend — GitHub Pages** (this repo): <https://yuhengz429.github.io/lucky-bridge/>
The `gh-pages` branch holds the static build; update it after changing the frontend.

**Shared-inventory backend — Render free tier:**
1. Sign up at [render.com](https://render.com) with your GitHub account
2. New → **Web Service** → connect this repo
3. Name it exactly `lucky-bridge-api` · Branch `main` · Build command *(empty)* · Start command `node server/server.mjs` · Instance **Free**
4. Open `https://lucky-bridge-api.onrender.com/api/state` — JSON means it's alive

The page auto-detects the backend: shared pool when reachable, per-device local mode otherwise (a toast announces it). Free instances sleep after 15 min idle — open the link once before an event; the 15 s stock poll keeps it awake while anyone plays.

> A one-command static rebuild for `gh-pages`:
> ```bash
> git worktree add /tmp/lb-pages gh-pages && cd /tmp/lb-pages \
>   && git checkout gh-pages -- . && git pull
> # copy index.html css js assets → commit → git push
> ```
