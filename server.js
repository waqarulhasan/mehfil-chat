// Mehfil Chat: single-room, no-registration chat.
// No packages needed: plain Node.js + Server-Sent Events.
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HISTORY = 60;           // messages kept for people who join
const MAX_LEN = 400;          // characters per message
const RATE = { count: 6, per: 8000 }; // max 6 messages per 8 seconds
// Add words to block here (lowercase). They are replaced with ***.
const BAD_WORDS = ['badword1', 'badword2'];
// Admin password. Set ADMIN_PASSWORD in your host's environment settings.
// If it isn't set, admin login is turned off.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const BAN_HOURS = 24;

// ---- Moderator accounts ----
// Saved in data/moderators.json (passwords are hashed, never stored as plain text).
// You can also set MODERATORS="Sara:password1,Ali:password2" in the host's environment
// settings; those accounts survive restarts even on hosts that wipe files.
const DATA_DIR = path.join(__dirname, 'data');
const MODS_FILE = path.join(DATA_DIR, 'moderators.json');
function hash(pw, salt = crypto.randomBytes(16).toString('hex')) { return { salt, hash: crypto.scryptSync(String(pw), salt, 32).toString('hex') }; }
function checkHash(pw, m) { const h = crypto.scryptSync(String(pw), m.salt, 32); return crypto.timingSafeEqual(h, Buffer.from(m.hash, 'hex')); }
let mods = [];
function loadMods() {
  try { mods = JSON.parse(fs.readFileSync(MODS_FILE, 'utf8')).filter(m => m.name && m.salt && m.hash).map(m => ({ ...m, source: 'panel' })); } catch { mods = []; }
  for (const pair of String(process.env.MODERATORS || '').split(',')) {
    const i = pair.indexOf(':'); if (i < 1) continue;
    const name = pair.slice(0, i).trim(), pw = pair.slice(i + 1).trim();
    if (name && pw && !mods.some(m => m.name.toLowerCase() === name.toLowerCase())) mods.push({ name, ...hash(pw), source: 'env' });
  }
}
function saveMods() {
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(MODS_FILE, JSON.stringify(mods.filter(m => m.source === 'panel').map(({ name, salt, hash }) => ({ name, salt, hash })), null, 2)); return true; }
  catch (e) { console.error('Could not save moderators:', e.message); return false; }
}
function findMod(nick) { return mods.find(m => m.name.toLowerCase() === String(nick).toLowerCase()); }
loadMods();

const users = new Map();      // id -> { id, token, nick, color, res, sent: [] }
const history = [];
const bans = new Map();       // ip or nick -> expiry time
const COLORS = ['#E4007C', '#0A8F6A', '#D9480F', '#5F3DC4', '#1971C2', '#C2255C', '#2B8A3E', '#E67700'];

function send(res, event, data) { res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); }
function broadcast(event, data) { for (const u of users.values()) if (u.res) send(u.res, event, data); }
function online() { return [...users.values()].filter(u => u.res).map(u => ({ id: u.id, nick: u.nick, color: u.color, admin: !!u.admin, owner: !!u.owner })); }
function push(msg) { history.push(msg); if (history.length > HISTORY) history.shift(); broadcast('msg', msg); }
function sys(text) { push({ type: 'sys', text, at: Date.now() }); }
function clean(t) {
  let s = String(t).replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '').trim().slice(0, MAX_LEN);
  for (const w of BAD_WORDS) s = s.replace(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '***');
  return s;
}
function body(req) {
  return new Promise((ok, no) => {
    let d = ''; req.on('data', c => { d += c; if (d.length > 4096) { no(new Error('too big')); req.destroy(); } });
    req.on('end', () => { try { ok(JSON.parse(d || '{}')); } catch (e) { no(e); } });
  });
}
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function ipOf(req) { return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim(); }
function banned(ip, nick) {
  const now = Date.now();
  for (const [k, t] of bans) if (t < now) bans.delete(k);
  return bans.has('ip:' + ip) || bans.has('nick:' + String(nick).toLowerCase());
}
function sameSecret(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function remove(u, event, text) {
  users.delete(u.id); clearTimeout(u.bye);
  if (u.res) { send(u.res, event, { text }); u.res.end(); u.res = null; }
}
function auth(q) { const u = users.get(q.id); return u && u.token === q.token ? u : null; }

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  // Join with a nickname
  if (req.method === 'POST' && url.pathname === '/api/join') {
    try {
      const b = await body(req);
      const nick = clean(b.nick || '').replace(/\s+/g, ' ').slice(0, 18);
      if (nick.length < 2) return json(res, 400, { error: 'Nickname must be at least 2 characters.' });
      const ip = ipOf(req);
      if (banned(ip, nick)) return json(res, 403, { error: 'You have been banned from this chat for breaking the rules.' });
      let admin = false, owner = false;
      const mod = findMod(nick);
      if (b.adminPass) {
        if (ADMIN_PASSWORD && sameSecret(b.adminPass, ADMIN_PASSWORD)) { admin = true; owner = true; }
        else if (mod && checkHash(b.adminPass, mod)) { admin = true; }
        else return json(res, 403, { error: mod ? 'Wrong password for this moderator.' : 'Wrong password. Moderators must use their own nickname.' });
      }
      if (!admin && mod) return json(res, 400, { error: 'That nickname belongs to a moderator. Try another one.' });
      if (!admin && /admin|moderator|^mod$/i.test(nick)) return json(res, 400, { error: 'That nickname is reserved. Try another one.' });
      if ([...users.values()].some(u => u.nick.toLowerCase() === nick.toLowerCase())) return json(res, 409, { error: 'That nickname is taken. Try another one.' });
      const id = crypto.randomBytes(6).toString('hex');
      const token = crypto.randomBytes(16).toString('hex');
      const u = { id, token, nick, color: admin ? '#0B3D2E' : COLORS[users.size % COLORS.length], res: null, sent: [], joined: false, admin, owner, ip };
      users.set(id, u);
      // forget people who join but never open the chat
      u.bye = setTimeout(() => { if (!u.res && !u.joined) users.delete(id); }, 30000);
      return json(res, 200, { id, token, nick, admin, owner });
    } catch { return json(res, 400, { error: 'Bad request.' }); }
  }

  // Public online count for the landing page
  if (req.method === 'GET' && url.pathname === '/api/count') return json(res, 200, { online: online().length });

  // Is my session still valid?
  if (req.method === 'GET' && url.pathname === '/api/check') {
    return json(res, auth(Object.fromEntries(url.searchParams)) ? 200 : 401, {});
  }

  // Live stream of messages
  if (req.method === 'GET' && url.pathname === '/api/stream') {
    const u = auth(Object.fromEntries(url.searchParams));
    if (!u) { res.writeHead(401); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (u.res) u.res.end();
    u.res = res; clearTimeout(u.bye);
    send(res, 'hello', { history, online: online(), me: u.id });
    if (!u.joined) { u.joined = true; sys(`${u.nick} joined the chat`); }
    broadcast('online', online());
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      if (u.res === res) u.res = null;
      // allow a few seconds to reconnect (e.g. phone switching network)
      u.bye = setTimeout(() => { if (!u.res && users.has(u.id)) { users.delete(u.id); sys(`${u.nick} left the chat`); broadcast('online', online()); } }, 8000);
    });
    return;
  }

  // Send a message
  if (req.method === 'POST' && url.pathname === '/api/send') {
    try {
      const b = await body(req); const u = auth(b);
      if (!u) return json(res, 401, { error: 'Please join again.' });
      if (!u.admin && banned(u.ip, u.nick)) { remove(u, 'kicked', 'You have been banned from this chat.'); return json(res, 403, { error: 'Banned.' }); }
      const now = Date.now(); u.sent = u.sent.filter(t => now - t < RATE.per);
      if (!u.admin && u.sent.length >= RATE.count) return json(res, 429, { error: 'Slow down a little, you are sending messages too fast.' });
      const text = clean(b.text || ''); if (!text) return json(res, 400, { error: 'Empty message.' });
      u.sent.push(now);
      push({ type: 'msg', id: crypto.randomBytes(5).toString('hex'), from: u.id, nick: u.nick, color: u.color, admin: !!u.admin, text, at: now });
      return json(res, 200, { ok: true });
    } catch { return json(res, 400, { error: 'Bad request.' }); }
  }

  // Moderator accounts (main admin only)
  if (req.method === 'POST' && url.pathname === '/api/mods') {
    try {
      const b = await body(req); const a = auth(b);
      if (!a || !a.owner) return json(res, 403, { error: 'Only the main admin can manage moderators.' });
      const list = () => mods.map(m => ({ name: m.name, source: m.source }));
      if (b.action === 'list') return json(res, 200, { mods: list() });
      if (b.action === 'add') {
        const name = clean(b.name || '').replace(/\s+/g, ' ').slice(0, 18);
        if (name.length < 2) return json(res, 400, { error: 'Nickname must be at least 2 characters.' });
        if (String(b.password || '').length < 6) return json(res, 400, { error: 'Password must be at least 6 characters.' });
        if (findMod(name)) return json(res, 409, { error: 'There is already a moderator with that nickname.' });
        mods.push({ name, ...hash(b.password), source: 'panel' });
        const saved = saveMods();
        return json(res, 200, { mods: list(), warning: saved ? '' : 'Added, but it could not be saved to disk. It will be lost when the server restarts.' });
      }
      if (b.action === 'remove') {
        const m = findMod(b.name);
        if (!m) return json(res, 404, { error: 'Moderator not found.' });
        if (m.source === 'env') return json(res, 400, { error: 'This moderator is set in the MODERATORS environment setting. Remove them there.' });
        mods = mods.filter(x => x !== m); saveMods();
        for (const u of users.values()) if (!u.owner && u.admin && u.nick.toLowerCase() === m.name.toLowerCase()) { u.admin = false; if (u.res) send(u.res, 'role', { admin: false }); sys(`${u.nick} is no longer a moderator`); broadcast('online', online()); }
        return json(res, 200, { mods: list() });
      }
      return json(res, 400, { error: 'Unknown action.' });
    } catch { return json(res, 400, { error: 'Bad request.' }); }
  }

  // Admin actions: delete a message, kick, ban, clear chat
  if (req.method === 'POST' && url.pathname === '/api/admin') {
    try {
      const b = await body(req); const a = auth(b);
      if (!a || !a.admin) return json(res, 403, { error: 'Admins only.' });
      if (b.action === 'delete') {
        const i = history.findIndex(m => m.id === b.msgId); if (i > -1) history.splice(i, 1);
        broadcast('delete', { id: b.msgId }); return json(res, 200, { ok: true });
      }
      if (b.action === 'clear') {
        history.length = 0; broadcast('clear', {}); sys('The chat was cleared by an admin'); return json(res, 200, { ok: true });
      }
      const t = users.get(b.target);
      if (!t) return json(res, 404, { error: 'That person has already left.' });
      // Make someone an admin, or take it away. Only the main admin (logged in with the password) can do this.
      if (b.action === 'promote' || b.action === 'demote') {
        if (!a.owner) return json(res, 403, { error: 'Only the main admin can change who is an admin.' });
        if (t.owner) return json(res, 400, { error: "You can't change the main admin." });
        t.admin = b.action === 'promote';
        if (t.res) send(t.res, 'role', { admin: t.admin });
        sys(t.admin ? `${t.nick} is now an admin` : `${t.nick} is no longer an admin`);
        broadcast('online', online()); return json(res, 200, { ok: true });
      }
      if (t.admin) return json(res, 400, { error: "You can't remove another admin. Take away their admin role first." });
      if (b.action === 'kick') {
        remove(t, 'kicked', 'You were removed from the chat by an admin.');
        sys(`${t.nick} was removed by an admin`); broadcast('online', online()); return json(res, 200, { ok: true });
      }
      if (b.action === 'ban') {
        const until = Date.now() + BAN_HOURS * 3600 * 1000;
        bans.set('ip:' + t.ip, until); bans.set('nick:' + t.nick.toLowerCase(), until);
        for (let i = history.length - 1; i >= 0; i--) if (history[i].from === t.id) { broadcast('delete', { id: history[i].id }); history.splice(i, 1); }
        remove(t, 'kicked', `You have been banned from this chat for ${BAN_HOURS} hours.`);
        sys(`${t.nick} was banned by an admin`); broadcast('online', online()); return json(res, 200, { ok: true });
      }
      return json(res, 400, { error: 'Unknown action.' });
    } catch { return json(res, 400, { error: 'Bad request.' }); }
  }

  // Leave
  if (req.method === 'POST' && url.pathname === '/api/leave') {
    try { const b = await body(req); const u = auth(b); if (u) { users.delete(u.id); if (u.res) u.res.end(); sys(`${u.nick} left the chat`); broadcast('online', online()); } } catch {}
    return json(res, 200, { ok: true });
  }

  // Static files
  let p = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[\/\\])+/, '');
  if (p === '/' || p === '\\') p = '/index.html';
  const file = path.join(__dirname, 'public', p);
  if (!file.startsWith(path.join(__dirname, 'public'))) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => console.log(`Mehfil Chat running on http://localhost:${PORT}`));
