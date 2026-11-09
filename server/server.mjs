/* ============================================================
   LUCKY BRIDGE — shared-state server (pure Node, zero deps)
   Serves the static frontend from ./public and owns the ONE
   authoritative inventory + claim log. Every device playing
   the public link deducts from this same pool.
   API:
     GET  /api/state      → { inv, log }
     POST /api/claim      { tier, items:[{id,qty}] } → 200 { inv, log } | 409 insufficient
     POST /api/claimAll   { tier }                   → 200 { inv, log, claimed }
     POST /api/reset      { pin }                    → 200 { inv, log } | 403 wrong pin
   ============================================================ */
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/* works both as a deployed stage (frontend in ./public next to this file)
   and straight from the repo (frontend at the repo root) */
const PUBLIC = existsSync(path.join(__dirname, 'public'))
  ? path.join(__dirname, 'public')
  : path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const PIN = process.env.STAFF_PIN || '2026';
const PORT = +(process.env.PORT || 3000);

const PRIZES = [
  { id: 'keychain',     name: 'Keychain',     stock: 90,  special: false },
  { id: 'postcard',     name: 'Postcard',     stock: 90,  special: false },
  { id: 'stickersheet', name: 'Sticker Pack', stock: 120, special: false },
  { id: 'coaster',      name: 'Coaster',      stock: 50,  special: true  },
];
const NAMES = Object.fromEntries(PRIZES.map(p => [p.id, p.name]));

/* ---------- state (persisted across restarts when possible) ---------- */
let state = { inv: Object.fromEntries(PRIZES.map(p => [p.id, p.stock])), log: [] };
try {
  await mkdir(DATA_DIR, { recursive: true });
  const raw = JSON.parse(await readFile(STATE_FILE, 'utf8'));
  if (raw && typeof raw.inv === 'object' && Array.isArray(raw.log)) {
    state = { inv: {}, log: raw.log.slice(-500) };
    for (const p of PRIZES) state.inv[p.id] = Math.max(0, Math.min(p.stock * 10, Math.floor(+raw.inv[p.id] || 0)));
  }
} catch { /* fresh start */ }
const persist = () => writeFile(STATE_FILE, JSON.stringify(state)).catch(() => {});

/* ---------- helpers ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
/* CORS: the static frontend lives on GitHub Pages and calls this API
   cross-origin. Allow any *.github.io origin + localhost for dev. */
const corsHeaders = (req) => {
  const origin = req.headers.origin || '';
  if (!/^https:\/\/[\w-]+\.github\.io$/.test(origin) &&
      !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};
const json = (res, code, obj, extra = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra });
  res.end(JSON.stringify(obj));
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 1e6) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
const validQty = q => Number.isInteger(q) && q >= 1 && q <= 50;
const logEntry = (tier, items) => ({
  t: new Date().toISOString(),
  tier: String(tier || '').slice(0, 40),
  items: items.map(({ id, qty }) => ({ name: NAMES[id] || id, qty, special: !!(PRIZES.find(p => p.id === id) || {}).special })),
});

/* ---------- API (single-threaded → each mutation is atomic) ---------- */
async function handleApi(req, res, pathname) {
  const cors = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    return res.end();
  }
  if (req.method === 'GET' && pathname === '/api/state') {
    return json(res, 200, { inv: state.inv, log: state.log }, cors);
  }
  if (req.method === 'POST' && pathname === '/api/claim') {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items.filter(it => it && NAMES[it.id] && validQty(it.qty)) : [];
    if (!items.length) return json(res, 400, { error: 'no valid items' }, cors);
    for (const it of items) if ((state.inv[it.id] || 0) < it.qty) {
      return json(res, 409, { error: 'insufficient', inv: state.inv }, cors);
    }
    for (const it of items) state.inv[it.id] -= it.qty;
    state.log.push(logEntry(body.tier, items));
    if (state.log.length > 500) state.log = state.log.slice(-500);
    persist();
    return json(res, 200, { inv: state.inv, log: state.log }, cors);
  }
  if (req.method === 'POST' && pathname === '/api/claimAll') {
    const body = await readBody(req).catch(() => ({}));
    const claimed = PRIZES.filter(p => state.inv[p.id] > 0).map(p => ({ id: p.id, qty: state.inv[p.id] }));
    for (const p of PRIZES) state.inv[p.id] = 0;
    state.log.push(logEntry(body.tier || 'GRAND PRIZE', claimed));
    if (state.log.length > 500) state.log = state.log.slice(-500);
    persist();
    return json(res, 200, { inv: state.inv, log: state.log, claimed }, cors);
  }
  if (req.method === 'POST' && pathname === '/api/reset') {
    const body = await readBody(req).catch(() => ({}));
    if (String(body.pin) !== PIN) return json(res, 403, { error: 'wrong pin' }, cors);
    state = { inv: Object.fromEntries(PRIZES.map(p => [p.id, p.stock])), log: [] };
    persist();
    return json(res, 200, { inv: state.inv, log: state.log }, cors);
  }
  return json(res, 404, { error: 'not found' }, cors);
}

/* ---------- static frontend ---------- */
async function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC, rel));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  try {
    const data = await readFile(file);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': /\.html$|\.css$|\.js$|\.mjs$|\.json$/.test(file) ? 'no-cache' : 'public, max-age=3600',
      ...corsHeaders(req),
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found');
  }
}

http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname;
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method' });
    return await serveStatic(req, res, pathname);
  } catch (e) {
    return json(res, 400, { error: e.message || 'bad request' });
  }
}).listen(PORT, '0.0.0.0', () => console.log(`Lucky BRIDGE serving on :${PORT} (state: ${STATE_FILE})`));
