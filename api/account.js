// Accounts for "מהרחוב למשמרת": register / login / save / public profiles for friends.
const { put, list, del } = require('@vercel/blob');
const crypto = require('crypto');

const norm = u => String(u || '').trim().toLowerCase();
const okName = u => /^[a-z0-9_֐-׿]{3,16}$/.test(u);
const okPin = p => /^\d{4,8}$/.test(String(p || ''));
const hash = (u, p) => crypto.createHash('sha256').update('fts|' + u + '|' + p).digest('hex').slice(0, 40);
const accPrefix = (u, p) => `accounts/${u}~${hash(u, p)}~`;
const profPrefix = u => `profiles/${u}~`;

async function blobs(prefix) {
  const r = await list({ prefix, limit: 100 });
  return r.blobs.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));
}
async function readJSON(prefix) {
  const b = await blobs(prefix);
  if (!b.length) return null;
  const res = await fetch(b[0].url, { cache: 'no-store' });
  return res.ok ? res.json() : null;
}
async function write(prefix, obj) {
  const old = await blobs(prefix);
  await put(prefix + '.json', JSON.stringify(obj), { access: 'public', addRandomSuffix: true, contentType: 'application/json' });
  if (old.length) await del(old.map(b => b.url));
}
function profileOf(u, stats) {
  const s = stats || {};
  return { user: u, name: String(s.name || u).slice(0, 30), day: s.day | 0, money: s.money | 0, job: String(s.job || '').slice(0, 40),
    city: String(s.city || '').slice(0, 30), spouse: String(s.spouse || '').slice(0, 30), kids: s.kids | 0, updatedAt: Date.now() };
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method === 'GET') {
    try { await list({ prefix: 'profiles/', limit: 1 }); return res.json({ ok: true, storage: true }); }
    catch (e) { return res.status(500).json({ ok: false, storage: false, message: String(e && e.message || e).slice(0, 200) }); }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  if (JSON.stringify(b).length > 900000) return res.status(413).json({ error: 'too_big' });
  const u = norm(b.user), p = String(b.pin || '');
  try {
    if (b.action === 'profile') {
      const out = [];
      for (const f of (Array.isArray(b.users) ? b.users : [b.user]).slice(0, 30)) {
        const pr = await readJSON(profPrefix(norm(f)));
        out.push(pr || { user: norm(f), missing: true });
      }
      return res.json({ ok: true, profiles: out });
    }
    if (!okName(u)) return res.status(400).json({ error: 'bad_name' });
    if (!okPin(p)) return res.status(400).json({ error: 'bad_pin' });
    if (b.action === 'register') {
      if ((await blobs(profPrefix(u))).length) return res.status(409).json({ error: 'taken' });
      await write(accPrefix(u, p), { user: u, save: b.save || null, createdAt: Date.now(), updatedAt: Date.now() });
      await write(profPrefix(u), profileOf(u, b.stats));
      return res.json({ ok: true, user: u });
    }
    if (b.action === 'login') {
      const a = await readJSON(accPrefix(u, p));
      if (!a) return res.status(401).json({ error: 'wrong' });
      return res.json({ ok: true, user: u, save: a.save, updatedAt: a.updatedAt });
    }
    if (b.action === 'save') {
      if (!(await blobs(accPrefix(u, p))).length) return res.status(401).json({ error: 'wrong' });
      await write(accPrefix(u, p), { user: u, save: b.save || null, updatedAt: Date.now() });
      await write(profPrefix(u), profileOf(u, b.stats));
      return res.json({ ok: true });
    }
    return res.status(400).json({ error: 'action' });
  } catch (e) {
    return res.status(500).json({ error: 'server', message: String(e && e.message || e).slice(0, 200) });
  }
};
