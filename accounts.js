'use strict';
// =====================================================================
//  Comptes joueurs : pseudo + mot de passe, sessions, XP et niveaux.
//  Stockage : PostgreSQL si DATABASE_URL est défini (en ligne),
//             sinon un fichier JSON local (data/accounts.json).
// =====================================================================
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SESSION_DAYS = 30;

// ----------------------------------------------------------- niveaux
// XP nécessaire pour passer du niveau n au niveau n+1 : 100 + 50 × (n − 1)
function levelInfo(xp) {
  let level = 1, need = 100, rest = xp;
  while (rest >= need) { rest -= need; level++; need = 100 + 50 * (level - 1); }
  return { level, xp, into: rest, need };
}
// Gains d'XP en fin de partie
const XP = { played: 20, win: 40, survived: 10 };

// Skins (à compléter plus tard) : chaque skin se débloque à un niveau.
const SKINS = [
  { id: 'classique', name: 'Classique', level: 1 },
];

// ------------------------------------------------------ mots de passe
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { hash, salt };
}
function checkPassword(password, user) {
  const { hash } = hashPassword(password, user.salt);
  const a = Buffer.from(hash, 'hex'), b = Buffer.from(user.hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ----------------------------------------------------------- stockage
function fileStore() {
  const dir = path.join(__dirname, 'data'), file = path.join(dir, 'accounts.json');
  let db = { users: {}, sessions: {} };
  try { db = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { /* nouveau fichier */ }
  let saveTimer = null;
  const save = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file + '.tmp', JSON.stringify(db));
      fs.renameSync(file + '.tmp', file);
    }, 200);
  };
  return {
    kind: 'fichier local',
    async userByName(nameLower) { return Object.values(db.users).find(u => u.name_lower === nameLower) || null; },
    async userById(id) { return db.users[id] || null; },
    async createUser(u) { db.users[u.id] = u; save(); return u; },
    async updateUser(id, f) { Object.assign(db.users[id], f); save(); },
    async createSession(token, userId, expires) { db.sessions[token] = { user_id: userId, expires_at: expires }; save(); },
    async session(token) { const s = db.sessions[token]; return s && new Date(s.expires_at) > new Date() ? s : null; },
    async deleteSession(token) { delete db.sessions[token]; save(); },
  };
}

async function pgStore(url) {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: url, max: 5 });
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_lower TEXT UNIQUE NOT NULL,
    hash TEXT NOT NULL, salt TEXT NOT NULL, xp INTEGER NOT NULL DEFAULT 0,
    games INTEGER NOT NULL DEFAULT 0, wins INTEGER NOT NULL DEFAULT 0,
    skin TEXT NOT NULL DEFAULT 'classique', created_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
  await pool.query(`CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL)`);
  await pool.query('DELETE FROM sessions WHERE expires_at < now()');
  const one = async (q, v) => (await pool.query(q, v)).rows[0] || null;
  return {
    kind: 'PostgreSQL',
    userByName: n => one('SELECT * FROM users WHERE name_lower = $1', [n]),
    userById: id => one('SELECT * FROM users WHERE id = $1', [id]),
    async createUser(u) {
      await pool.query('INSERT INTO users (id, name, name_lower, hash, salt) VALUES ($1,$2,$3,$4,$5)', [u.id, u.name, u.name_lower, u.hash, u.salt]);
      return u;
    },
    async updateUser(id, f) {
      const keys = Object.keys(f).filter(k => ['xp', 'games', 'wins', 'skin'].includes(k));
      if (!keys.length) return;
      await pool.query(`UPDATE users SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map(k => f[k])]);
    },
    async createSession(token, userId, expires) { await pool.query('INSERT INTO sessions VALUES ($1,$2,$3)', [token, userId, expires]); },
    session: t => one('SELECT * FROM sessions WHERE token = $1 AND expires_at > now()', [t]),
    async deleteSession(t) { await pool.query('DELETE FROM sessions WHERE token = $1', [t]); },
  };
}

// ------------------------------------------------------------- API
async function openAccounts() {
  const store = process.env.DATABASE_URL ? await pgStore(process.env.DATABASE_URL) : fileStore();

  const publicUser = u => ({ id: u.id, name: u.name, skin: u.skin || 'classique', games: u.games || 0, wins: u.wins || 0, ...levelInfo(u.xp || 0) });
  async function newSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    await store.createSession(token, user.id, new Date(Date.now() + SESSION_DAYS * 864e5).toISOString());
    return { token, user: publicUser(user) };
  }

  // anti-force brute : 10 échecs max par adresse IP / 10 min
  const fails = new Map();
  const blocked = ip => { const f = fails.get(ip); return f && f.n >= 10 && Date.now() - f.t < 10 * 60e3; };
  const fail = ip => { const f = fails.get(ip); if (!f || Date.now() - f.t > 10 * 60e3) fails.set(ip, { n: 1, t: Date.now() }); else f.n++; };

  return {
    kind: store.kind,
    SKINS,
    levelInfo,
    async register(name, password, ip) {
      name = String(name || '').trim();
      password = String(password || '');
      if (!/^[A-Za-zÀ-ÿ0-9_-]{3,16}$/.test(name)) throw new Error('Pseudo : 3 à 16 caractères (lettres, chiffres, - ou _).');
      if (password.length < 6 || password.length > 100) throw new Error('Mot de passe : au moins 6 caractères.');
      if (blocked(ip)) throw new Error('Trop de tentatives, réessayez dans quelques minutes.');
      if (await store.userByName(name.toLowerCase())) throw new Error('Ce pseudo est déjà pris.');
      const { hash, salt } = hashPassword(password);
      const user = await store.createUser({ id: 'u' + crypto.randomBytes(9).toString('hex'), name, name_lower: name.toLowerCase(), hash, salt, xp: 0, games: 0, wins: 0, skin: 'classique' });
      return newSession(user);
    },
    async login(name, password, ip) {
      if (blocked(ip)) throw new Error('Trop de tentatives, réessayez dans quelques minutes.');
      const user = await store.userByName(String(name || '').trim().toLowerCase());
      if (!user || !checkPassword(String(password || ''), user)) { fail(ip); throw new Error('Pseudo ou mot de passe incorrect.'); }
      return newSession(user);
    },
    async resume(token) {
      const s = token && await store.session(String(token));
      const user = s && await store.userById(s.user_id);
      return user ? publicUser(user) : null;
    },
    async logout(token) { if (token) await store.deleteSession(String(token)); },
    // fin de partie : ajoute l'XP et renvoie { user, gained, levelUp }
    async reward(userId, { won, survived }) {
      const u = await store.userById(userId);
      if (!u) return null;
      const gained = XP.played + (won ? XP.win : 0) + (survived ? XP.survived : 0);
      const before = levelInfo(u.xp || 0).level;
      const f = { xp: (u.xp || 0) + gained, games: (u.games || 0) + 1, wins: (u.wins || 0) + (won ? 1 : 0) };
      await store.updateUser(userId, f);
      const user = publicUser({ ...u, ...f });
      return { user, gained, levelUp: user.level > before };
    },
  };
}

module.exports = { openAccounts, levelInfo };
