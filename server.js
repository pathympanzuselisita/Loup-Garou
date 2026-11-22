'use strict';
// =====================================================================
//  Les Loups de Brumeval — jeu de loups-garous multijoueur
//  avec chat de proximité (texte + voix) et actions de nuit chronométrées
// =====================================================================
const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Server } = require('socket.io');
const { openAccounts } = require('./accounts');
let accounts = null; // ouvert au démarrage

const PORT = +process.env.PORT || 3000;
const HTTPS_PORT = +process.env.HTTPS_PORT || 3443;

// ---------------------------------------------------------------- monde
const WORLD = { w: 2400, h: 1800 };
const CENTER = { x: 1200, y: 900 };
const DEN = { x: 330, y: 280 };          // tanière des loups
const VILLAGE_RADIUS = 620;               // rayon du cercle de maisons
const HOUSE_COUNT = 16;                  // maisons du village (= joueurs max)
const HOUSE_RING = { rx: VILLAGE_RADIUS, ry: VILLAGE_RADIUS };
// maisons fixes, disposées en cercle, porte tournée vers la place
const HOUSES = Array.from({ length: HOUSE_COUNT }, (_, i) => {
  const a = -Math.PI / 2 + i * 2 * Math.PI / HOUSE_COUNT;
  const x = Math.round(CENTER.x + Math.cos(a) * VILLAGE_RADIUS), y = Math.round(CENTER.y + Math.sin(a) * VILLAGE_RADIUS);
  return { i, x, y, face: Math.atan2(CENTER.y - y, CENTER.x - x) };
});
const COUNCIL_RADIUS = 150;              // cercle du conseil (vote) sur la place
// chaque joueur a sa place dans le cercle, du côté de sa maison
const seatOf = h => { const a = Math.atan2(h.y - CENTER.y, h.x - CENTER.x); return { x: CENTER.x + Math.cos(a) * COUNCIL_RADIUS, y: CENTER.y + Math.sin(a) * COUNCIL_RADIUS }; };
const doorstep = (h, d = 80) => ({ x: h.x + Math.cos(h.face) * d, y: h.y + Math.sin(h.face) * d });
const HEAR_RADIUS = 280;                 // portée du chat de proximité (px)
const PEEK_RANGE = 520;                  // portée de vue de la Petite Fille
const PEEK_HALF_ANGLE = 0.33;            // demi-angle du cône (rad, ~19°)
const PEEK_IDENTIFY = 150;               // distance sous laquelle elle reconnaît un loup
const AJAR_SEEN = 340;                   // un loup à cette distance voit la porte entrouverte
const DETECT_RADIUS = 230;               // un loup à cette distance la repère peu à peu
const DETECT_TIME = 2;                   // secondes cumulées pour être repérée

const ROLE_INFO = {
  loup:       { name: 'Loup-Garou', team: 'loups', icon: '🐺',
                desc: "Chaque nuit, sortez discrètement de votre maison, rejoignez la meute (la tanière est un bon point de rendez-vous) et choisissez une victime avant la fin du chrono. La nuit, votre voix est déformée pour qu'on ne vous reconnaisse pas. Méfiez-vous de la Petite Fille : une porte entrouverte trahit sa présence !" },
  villageois: { name: 'Villageois', team: 'village', icon: '🧑‍🌾',
                desc: "Vous n'avez aucun pouvoir, mais votre voix compte : discutez, démasquez les loups et votez pour les éliminer." },
  voyante:    { name: 'Voyante', team: 'village', icon: '🔮',
                desc: "Chaque nuit, vous pouvez découvrir le vrai rôle d'un joueur. Attention : il faut agir avant la fin de la nuit !" },
  sorciere:   { name: 'Sorcière', team: 'village', icon: '🧪',
                desc: "Vous avez une potion de vie (sauver la victime des loups) et une potion de mort (tuer quelqu'un). Chacune ne sert qu'une fois dans la partie." },
  chasseur:   { name: 'Chasseur', team: 'village', icon: '🏹',
                desc: "Si vous mourez, vous avez quelques secondes pour tirer une dernière balle et emporter quelqu'un avec vous." },
  cupidon:    { name: 'Cupidon', team: 'village', icon: '💘',
                desc: "La première nuit, désignez deux amoureux. Si l'un meurt, l'autre meurt de chagrin. Si ce sont les deux derniers survivants, ils gagnent ensemble." },
  petitefille:{ name: 'Petite Fille', team: 'village', icon: '👧',
                desc: "La nuit, entrouvrez votre porte (touche E) pour espionner : vous voyez un cône étroit dans la direction de votre souris et entendez les loups proches (voix déformées). Vous ne reconnaissez un loup que s'il passe tout près. Attention : si un loup s'approche trop pendant que la porte est ouverte, il vous repère !" },
  spectateur: { name: 'Spectateur', team: '-', icon: '👻',
                desc: "Vous êtes arrivé en cours de partie : vous regardez en fantôme." },
};
const SPECIAL_ROLES = ['voyante', 'sorciere', 'chasseur', 'cupidon', 'petitefille'];
const COLORS = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6',
  '#bcf60c', '#fabebe', '#008080', '#e6beff', '#9a6324', '#fffac8', '#aaffc3', '#ffd8b1', '#808000', '#ffffff'];

// --------------------------------------------------------------- serveur
const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/three', express.static(path.join(__dirname, 'node_modules', 'three', 'build')));
const io = new Server({ maxHttpBufferSize: 2e5 });
const httpServer = http.createServer(app);
io.attach(httpServer);

// =====================================================================
//  SALONS : chaque salon (code à 4 lettres) a son propre village et sa partie.
//  Tout le code ci-dessous jusqu'à « fin du salon » est propre à un salon.
// =====================================================================
const rooms = new Map();
const CODE_LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // sans I ni O (confusion avec 1 et 0)
function newCode() {
  let c;
  do { c = Array.from({ length: 4 }, () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)]).join(''); } while (rooms.has(c));
  return c;
}

function createRoom(code) {
let lastActive = Date.now();
// ----------------------------------------------------------------- état
const game = {
  phase: 'lobby', // lobby | night | witch | hunter | day | vote | end
  players: new Map(),
  hostId: null,
  settings: {
    wolves: 0, // 0 = automatique
    roles: { voyante: true, sorciere: true, chasseur: true, cupidon: false, petitefille: true },
    timers: { night: 45, witch: 25, day: 150, vote: 45, hunter: 20 },
  },
  day: 0,
  timer: null, timerFn: null, timerEnd: 0,
  night: null,
  potions: { life: true, death: true },
  lovers: null,
  votes: {},
  readyVote: new Set(),
  hunter: null,
  hunterQueue: [],
  winner: null,
};

const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const all = () => [...game.players.values()];
const alive = () => all().filter(p => p.alive);
const get = id => game.players.get(id);
const isWolf = p => p && p.role === 'loup';
const isNight = () => game.phase === 'night' || game.phase === 'witch';
const isGirl = p => p && p.role === 'petitefille';
const peeking = p => isGirl(p) && p.alive && isNight() && p.peek && p.peek.open;
function inCone(girl, t) {
  const dx = t.x - girl.x, dy = t.y - girl.y, d = Math.hypot(dx, dy);
  if (d > PEEK_RANGE) return false;
  if (d < 40) return true;
  let da = Math.atan2(dy, dx) - girl.peek.angle;
  da = Math.atan2(Math.sin(da), Math.cos(da));
  return Math.abs(da) <= PEEK_HALF_ANGLE;
}
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const roleName = r => (ROLE_INFO[r] ? ROLE_INFO[r].icon + ' ' + ROLE_INFO[r].name : '?');

// ------------------------------------------------------- règles d'écoute
// Peut-on entendre/lire « speaker » quand on est « listener » ?
function canHear(listener, speaker) {
  if (listener.id === speaker.id) return false;
  if (game.phase === 'lobby' || game.phase === 'end') return true;
  const near = dist(listener, speaker) <= HEAR_RADIUS;
  if (!speaker.alive) return !listener.alive;          // les fantômes ne parlent qu'aux fantômes
  if (!listener.alive) return near;                     // les fantômes entendent les vivants proches
  if (isNight()) return isWolf(speaker) && near && (isWolf(listener) || peeking(listener)); // la nuit, seuls les loups parlent (et la Petite Fille écoute)
  if (game.phase === 'vote') return true; // au conseil, tout le cercle s'entend
  return near;
}
// Peut-on voir « target » sur la carte ?
function canSee(viewer, target) {
  if (viewer.id === target.id) return true;
  if (game.phase === 'lobby' || game.phase === 'end') return true;
  if (!viewer.alive) return true;
  if (!target.alive) return false;
  if (isNight()) {
    if (isWolf(viewer)) return true; // les loups rôdent et voient le village
    if (peeking(viewer)) return isWolf(target) && inCone(viewer, target);
    return false; // les villageois dorment chez eux
  }
  return true;
}
function canMove(p) {
  if (game.phase === 'lobby' || game.phase === 'end' || !p.alive) return true;
  if (isNight()) return isWolf(p);
  if (game.phase === 'vote') return false; // on ne quitte pas le cercle du conseil
  return true;
}

// --------------------------------------------------------------- timers
function setTimer(sec, fn) {
  clearTimeout(game.timer);
  game.timerEnd = Date.now() + sec * 1000;
  game.timerFn = fn;
  game.timer = setTimeout(() => { game.timerFn = null; fn(); }, sec * 1000);
}
function clearTimer() { clearTimeout(game.timer); game.timer = null; game.timerFn = null; game.timerEnd = 0; }

// ----------------------------------------------------------- messages
function sys(text, kind = 'info', to = null) {
  const msg = { text, kind };
  if (to) { const p = get(to); if (p && p.connected) io.to(p.socketId).emit('sys', msg); }
  else io.to(code).emit('sys', msg);
}
function announce(title, text, to = null) {
  const msg = { title, text };
  if (to) { const p = get(to); if (p && p.connected) io.to(p.socketId).emit('announce', msg); }
  else io.to(code).emit('announce', msg);
}
function teleport(p, x, y, look = null) {
  p.x = x; p.y = y;
  if (p.connected) io.to(p.socketId).emit('teleport', { x, y, look });
}

// ------------------------------------------------------ vue par joueur
function knownRole(viewer, q) {
  if (q.id === viewer.id || game.phase === 'end' || !viewer.alive || !q.alive) return q.role;
  if (isWolf(viewer) && isWolf(q)) return 'loup';
  if (viewer.seen[q.id]) return viewer.seen[q.id];
  return null;
}
function viewFor(p) {
  const v = {
    phase: game.phase, day: game.day, timerEnd: game.timerEnd, serverNow: Date.now(),
    hostId: game.hostId, settings: game.settings, winner: game.winner,
    me: { id: p.id, role: p.role, alive: p.alive, lover: p.lover, spectator: p.spectator },
    players: all().map(q => ({
      id: q.id, name: q.name, color: q.color, alive: q.alive, connected: q.connected,
      spectator: q.spectator, house: q.house, role: knownRole(p, q), level: q.level || 1,
    })),
  };
  const seeAll = game.phase === 'end' || !p.alive;
  if (game.lovers && (seeAll || p.role === 'cupidon' || game.lovers.includes(p.id))) v.lovers = game.lovers;
  const n = game.night;
  if (isNight() && n && p.alive) {
    if (isWolf(p)) v.wolfVotes = n.wolfVotes;
    if (p.role === 'voyante') v.seerTarget = n.seer;
    if (isGirl(p)) { v.peek = !!(p.peek && p.peek.open); v.spotted = !!n.spotted; }
    if (p.role === 'cupidon' && game.day === 1) v.cupid = n.cupid;
    if (p.role === 'sorciere' && game.phase === 'witch') v.witch = { victim: n.victim, potions: game.potions, done: n.witchDone };
  }
  if (isNight() && n && !p.alive) { v.wolfVotes = n.wolfVotes; v.wolfVictim = n.victim; } // les fantômes suivent tout
  if (game.phase === 'vote') v.votes = game.votes;
  if (game.phase === 'day') v.ready = [...game.readyVote];
  if (game.phase === 'hunter' && game.hunter) v.hunterId = game.hunter.id;
  return v;
}
let stateQueued = false;
function broadcastState() {
  if (stateQueued) return;
  stateQueued = true;
  setImmediate(() => {
    stateQueued = false;
    for (const p of all()) if (p.connected) io.to(p.socketId).emit('state', viewFor(p));
  });
}

// --------------------------------------------------------- déroulement
function buildRoles(n) {
  const s = game.settings;
  let wolves = s.wolves > 0 ? s.wolves : Math.max(1, Math.floor(n / 4));
  wolves = Math.min(wolves, n - 1);
  const list = Array(wolves).fill('loup');
  for (const r of SPECIAL_ROLES) if (s.roles[r] && list.length < n) list.push(r);
  while (list.length < n) list.push('villageois');
  return shuffle(list);
}

function startGame() {
  for (const p of all()) if (!p.connected) game.players.delete(p.id);
  const shuffled = shuffle(all());
  const players = shuffled.slice(0, HOUSE_COUNT);
  for (const p of shuffled.slice(HOUSE_COUNT)) Object.assign(p, { alive: false, spectator: true, role: 'spectateur', house: null });
  if (players.length < 3) return sys('Il faut au moins 3 joueurs pour commencer.', 'warn', game.hostId);
  const roles = buildRoles(players.length);
  players.forEach((p, i) => {
    p.house = HOUSES[Math.round(i * HOUSE_COUNT / players.length) % HOUSE_COUNT];
    p.role = roles[i]; p.alive = true; p.spectator = false; p.lover = null; p.seen = {};
  });
  Object.assign(game, { day: 0, potions: { life: true, death: true }, lovers: null,
    votes: {}, hunterQueue: [], hunter: null, winner: null });
  game.readyVote.clear();
  for (const p of players) {
    const r = ROLE_INFO[p.role];
    let extra = '';
    if (isWolf(p)) {
      const others = players.filter(q => isWolf(q) && q.id !== p.id).map(q => q.name);
      extra = others.length ? `\n\nVos frères loups : ${others.join(', ')}.` : '\n\nVous êtes le seul loup.';
    }
    announce(`Vous êtes ${r.icon} ${r.name}`, r.desc + extra, p.id);
  }
  sys(`La partie commence avec ${players.length} joueurs. Composition : ${countRoles(roles)}.`, 'phase');
  startNight();
}
function countRoles(roles) {
  const c = {};
  roles.forEach(r => c[r] = (c[r] || 0) + 1);
  return Object.entries(c).map(([r, k]) => `${k} ${ROLE_INFO[r].name}`).join(', ');
}

function startNight() {
  game.day++;
  game.phase = 'night';
  game.night = { wolfVotes: {}, seer: null, seerDone: false, cupid: null, victim: null,
    witchSave: false, witchKill: null, witchDone: false, detect: 0, spotted: false, anon: new Map() };
  // chacun rentre chez soi pour la nuit (les loups devront sortir discrètement)
  for (const p of all()) p.peek = { open: false, angle: Math.PI / 2 };
  for (const p of alive()) teleport(p, p.house.x, p.house.y);
  sys(`🌙 Nuit ${game.day} : chacun rentre chez soi et le village s'endort. Chaque rôle doit agir avant la fin du chrono !`, 'phase');
  setTimer(game.settings.timers.night, endNightMain);
  broadcastState();
}

function nightMainDone() {
  const n = game.night, a = alive();
  if (a.filter(isWolf).some(w => !(w.id in n.wolfVotes))) return false;
  if (a.some(p => p.role === 'voyante') && !n.seerDone) return false;
  if (game.day === 1 && a.some(p => p.role === 'cupidon') && !n.cupid) return false;
  return true;
}
function checkNightEarly() { if (game.phase === 'night' && nightMainDone()) setTimer(3, endNightMain); }

function endNightMain() {
  const n = game.night;
  // victime des loups : majorité, égalité tirée au sort
  const tally = {};
  for (const [w, t] of Object.entries(n.wolfVotes)) { const wp = get(w); if (wp && wp.alive && t) tally[t] = (tally[t] || 0) + 1; }
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter(t => tally[t] === max);
  n.victim = max > 0 ? top[Math.floor(Math.random() * top.length)] : null;
  for (const p of alive()) if (isWolf(p)) {
    sys(n.victim ? `🐺 La meute a choisi : ${get(n.victim).name}.` : '🐺 La meute n\'a choisi personne cette nuit…', 'wolf', p.id);
  }
  // Cupidon
  if (n.cupid && !game.lovers) {
    const [a, b] = n.cupid.map(get);
    a.lover = b.id; b.lover = a.id; game.lovers = [a.id, b.id];
    announce('💘 Vous êtes amoureux !', `Cupidon vous a lié à ${b.name}. Si l'un de vous meurt, l'autre meurt de chagrin.`, a.id);
    announce('💘 Vous êtes amoureux !', `Cupidon vous a lié à ${a.name}. Si l'un de vous meurt, l'autre meurt de chagrin.`, b.id);
  }
  const witch = alive().find(p => p.role === 'sorciere');
  if (witch && (game.potions.life || game.potions.death)) {
    game.phase = 'witch';
    sys('🧪 La sorcière se réveille…', 'phase');
    setTimer(game.settings.timers.witch, resolveNight);
    broadcastState();
  } else resolveNight();
}

function kill(id, cause, deaths) {
  const p = get(id);
  if (!p || !p.alive) return;
  p.alive = false;
  deaths.push({ id, name: p.name, role: p.role, cause });
  if (p.role === 'chasseur') game.hunterQueue.push(id);
  if (p.lover) kill(p.lover, 'amour', deaths);
}
const CAUSES = { loups: 'dévoré par les loups', poison: 'empoisonné', vote: 'éliminé par le village',
  chasseur: 'abattu par le chasseur', amour: 'mort de chagrin' };
function deathText(deaths) {
  return deaths.map(d => `💀 ${d.name} (${roleName(d.role)}) — ${CAUSES[d.cause]}`).join('\n');
}

function resolveNight() {
  const n = game.night, deaths = [];
  if (n.victim && !n.witchSave) kill(n.victim, 'loups', deaths);
  if (n.witchKill) kill(n.witchKill, 'poison', deaths);
  // au réveil, tout le monde sort de chez soi
  for (const p of all()) p.peek = { open: false, angle: 0 };
  for (const p of alive()) { const d = doorstep(p.house); teleport(p, d.x, d.y); }
  const text = deaths.length ? deathText(deaths) : 'Miracle : personne n\'est mort cette nuit.';
  announce(`☀️ Jour ${game.day} : le village se réveille`, text);
  sys(`☀️ Le village se réveille. ${deaths.length ? deaths.map(d => d.name + ' est mort(e)').join(', ') : 'Personne n\'est mort.'}`, 'phase');
  game.phase = 'day'; // pour que les joueurs puissent bouger pendant un éventuel tir du chasseur
  afterDeaths(startDay);
}

function afterDeaths(next) {
  if (game.hunterQueue.length) return startHunter(next);
  if (checkWin()) return;
  next();
}
function startHunter(next) {
  const hid = game.hunterQueue.shift();
  const h = get(hid);
  game.phase = 'hunter';
  game.hunter = { id: hid, next };
  sys(`🏹 ${h.name} était chasseur ! Il/elle a ${game.settings.timers.hunter} s pour tirer une dernière balle…`, 'phase');
  setTimer(game.settings.timers.hunter, () => {
    sys(`🏹 ${h.name} n'a pas tiré.`, 'info');
    game.hunter = null;
    afterDeaths(next);
  });
  broadcastState();
}

function startDay() {
  game.phase = 'day';
  game.readyVote.clear();
  sys('🗣️ Débat : déplacez-vous pour parler aux autres (chat de proximité). Le vote suivra.', 'phase');
  setTimer(game.settings.timers.day, startVote);
  broadcastState();
}
function startVote() {
  game.phase = 'vote';
  game.votes = {};
  // tous les vivants se réunissent en cercle sur la place
  for (const p of alive()) if (p.house) { const s = seatOf(p.house); teleport(p, s.x, s.y, 'circle'); }
  sys('🗳️ Le conseil du village se réunit sur la place ! Personne ne quitte le cercle avant la fin du vote. Cliquez sur un joueur pour voter contre lui.', 'phase');
  setTimer(game.settings.timers.vote, resolveVote);
  broadcastState();
}
function resolveVote() {
  const tally = {};
  for (const [v, t] of Object.entries(game.votes)) { const vp = get(v); if (vp && vp.alive && t) tally[t] = (tally[t] || 0) + 1; }
  const max = Math.max(0, ...Object.values(tally));
  const top = Object.keys(tally).filter(t => tally[t] === max);
  const deaths = [];
  if (max === 0) announce('🗳️ Résultat du vote', 'Personne n\'a voté. Personne n\'est éliminé.');
  else if (top.length > 1) announce('🗳️ Résultat du vote', `Égalité entre ${top.map(t => get(t).name).join(' et ')}. Personne n'est éliminé.`);
  else {
    kill(top[0], 'vote', deaths);
    announce('🗳️ Résultat du vote', `${get(top[0]).name} est éliminé(e) avec ${max} voix.\n\n${deathText(deaths)}`);
  }
  sys(deaths.length ? `🗳️ ${deaths.map(d => `${d.name} (${roleName(d.role)})`).join(', ')} quitte(nt) la partie.` : '🗳️ Personne n\'est éliminé.', 'phase');
  game.phase = 'day';
  afterDeaths(startNight);
}

function checkWin() {
  const a = alive(), w = a.filter(isWolf).length;
  let winner = null;
  if (a.length === 0) winner = 'personne';
  else if (w === 0) winner = 'village';
  else if (w === a.length) winner = 'loups';
  else if (a.length === 2 && a[0].lover === a[1].id) winner = 'amoureux';
  if (!winner) return false;
  endGame(winner);
  return true;
}
function endGame(winner) {
  clearTimer();
  game.phase = 'end';
  game.winner = winner;
  const T = { village: '🏡 Le village a gagné !', loups: '🐺 Les loups-garous ont gagné !',
    amoureux: '💘 Les amoureux ont gagné !', personne: '☠️ Tout le monde est mort…' };
  const recap = all().filter(p => p.role && !p.spectator).map(p => `${p.alive ? '✅' : '💀'} ${p.name} : ${roleName(p.role)}`).join('\n');
  announce(T[winner], recap);
  sys(T[winner], 'phase');
  broadcastState();
  // XP : chaque joueur de la partie gagne de l'expérience
  for (const p of all()) {
    if (!p.role || p.spectator) continue;
    const won = winner === 'village' ? ROLE_INFO[p.role].team === 'village'
      : winner === 'loups' ? isWolf(p) : winner === 'amoureux' ? !!(game.lovers && game.lovers.includes(p.id)) : false;
    accounts.reward(p.id, { won, survived: p.alive }).then(r => {
      if (!r) return;
      p.level = r.user.level;
      sys(`⭐ +${r.gained} XP${won ? ' (victoire !)' : ''} — niveau ${r.user.level} (${r.user.into}/${r.user.need} XP)`, 'seer', p.id);
      if (r.levelUp) announce(`🎉 Niveau ${r.user.level} !`, `Bravo ${p.name}, vous passez au niveau ${r.user.level} !`, p.id);
      if (p.connected) io.to(p.socketId).emit('account', r.user);
      broadcastState();
    }).catch(e => console.error('XP', e.message));
  }
}
function backToLobby() {
  clearTimer();
  for (const p of all()) if (!p.connected) game.players.delete(p.id);
  Object.assign(game, { phase: 'lobby', day: 0, night: null, lovers: null, winner: null, hunter: null, hunterQueue: [] });
  for (const p of all()) {
    Object.assign(p, { role: null, alive: true, spectator: false, lover: null, seen: {}, house: null });
    teleport(p, CENTER.x + rnd(-120, 120), CENTER.y + rnd(-120, 120));
  }
  broadcastState();
}

// ------------------------------------------------------------ sockets
function attach(socket, joinData) {
  let me = null;
  socket.join(code);
  lastActive = Date.now();

  const onJoin = () => {
    const user = socket.data.user; // compte connecté
    const id = user.id, name = user.name;
    me = get(id);
    if (me) {
      if (me.connected && me.socketId !== socket.id) io.sockets.sockets.get(me.socketId)?.disconnect(true);
      me.level = user.level;
    } else {
      const used = new Set(all().map(p => p.color));
      me = { id, name, color: COLORS.find(c => !used.has(c)) || COLORS[game.players.size % COLORS.length],
        x: CENTER.x + rnd(-120, 120), y: CENTER.y + rnd(-120, 120), alive: true, role: null,
        house: null, lover: null, seen: {}, spectator: false, voice: false, level: user.level };
      if (game.phase !== 'lobby') { me.alive = false; me.spectator = true; me.role = 'spectateur'; }
      game.players.set(id, me);
      sys(`${name} rejoint le village.`);
    }
    me.socketId = socket.id;
    me.connected = true;
    me.voice = false;
    if (!game.hostId || !get(game.hostId)?.connected) game.hostId = id;
    socket.emit('welcome', { id, room: code, roleInfo: ROLE_INFO, world: WORLD, center: CENTER, den: DEN,
      ring: HOUSE_RING, houses: HOUSES, hearRadius: HEAR_RADIUS, councilRadius: COUNCIL_RADIUS, peek: { range: PEEK_RANGE, half: PEEK_HALF_ANGLE } });
    socket.emit('teleport', { x: me.x, y: me.y });
    broadcastState();
  };

  const guard = fn => (...args) => { if (me && game.players.get(me.id) === me) { try { fn(...args); } catch (e) { console.error(e); } } };
  const isHost = () => me && game.hostId === me.id;

  socket.on('move', guard(({ x, y } = {}) => {
    if (!canMove(me) || !Number.isFinite(x) || !Number.isFinite(y)) return;
    me.x = Math.max(20, Math.min(WORLD.w - 20, x));
    me.y = Math.max(20, Math.min(WORLD.h - 20, y));
  }));

  socket.on('chat', guard(text => {
    text = String(text || '').trim().slice(0, 300);
    if (!text) return;
    const msg = { from: me.id, name: me.name, color: me.color, text, ghost: !me.alive,
      wolf: isNight() && isWolf(me) && me.alive };
    if (isNight() && me.alive && !isWolf(me)) return sys('Vous dormez… impossible de parler la nuit.', 'warn', me.id);
    for (const q of all()) {
      if (!q.connected || !(q.id === me.id || canHear(q, me))) continue;
      if (msg.wolf && peeking(q) && dist(q, me) > PEEK_IDENTIFY) io.to(q.socketId).emit('chat', { ...msg, from: anonId(me), name: 'Loup ?', color: '#888888' });
      else io.to(q.socketId).emit('chat', msg);
    }
  }));

  // --- lobby / hôte
  socket.on('settings', guard(s => {
    if (!isHost() || game.phase !== 'lobby' || !s) return;
    const st = game.settings;
    if (Number.isInteger(s.wolves)) st.wolves = Math.max(0, Math.min(6, s.wolves));
    if (s.roles) for (const r of SPECIAL_ROLES) if (r in s.roles) st.roles[r] = !!s.roles[r];
    if (s.timers) for (const k of Object.keys(st.timers)) if (Number.isFinite(+s.timers[k])) st.timers[k] = Math.max(10, Math.min(600, Math.round(+s.timers[k])));
    broadcastState();
  }));
  socket.on('start', guard(() => { if (isHost() && game.phase === 'lobby') startGame(); }));
  socket.on('skip', guard(() => {
    if (!isHost() || !game.timerFn) return;
    const fn = game.timerFn; clearTimer(); fn();
  }));
  socket.on('restart', guard(() => { if (isHost() && game.phase === 'end') backToLobby(); }));

  // --- actions de nuit
  const nightActor = role => game.phase === 'night' && me.alive && me.role === role;
  const aliveTarget = t => { const p = get(t); return p && p.alive ? p : null; };

  socket.on('wolf-vote', guard(t => {
    if (!nightActor('loup')) return;
    const p = aliveTarget(t);
    if (!p || isWolf(p)) return;
    game.night.wolfVotes[me.id] = p.id;
    for (const w of alive()) if (isWolf(w) && w.id !== me.id) sys(`🐺 ${me.name} veut dévorer ${p.name}.`, 'wolf', w.id);
    broadcastState(); checkNightEarly();
  }));
  socket.on('seer', guard(t => {
    if (!nightActor('voyante') || game.night.seerDone) return;
    const p = aliveTarget(t);
    if (!p || p.id === me.id) return;
    game.night.seer = p.id; game.night.seerDone = true;
    me.seen[p.id] = p.role;
    sys(`🔮 Votre boule de cristal révèle : ${p.name} est ${roleName(p.role)}.`, 'seer', me.id);
    broadcastState(); checkNightEarly();
  }));
  socket.on('peek', guard(({ open, angle } = {}) => {
    if (!isNight() || !me.alive || !isGirl(me) || game.night.spotted) return;
    const was = me.peek && me.peek.open;
    me.peek = { open: !!open, angle: Number.isFinite(angle) ? angle : 0 };
    if (was !== me.peek.open) broadcastState();
  }));
  socket.on('cupid', guard(ids => {
    if (!nightActor('cupidon') || game.day !== 1 || game.night.cupid || !Array.isArray(ids)) return;
    const ps = [...new Set(ids)].map(aliveTarget).filter(Boolean);
    if (ps.length !== 2) return;
    game.night.cupid = ps.map(p => p.id);
    sys(`💘 ${ps[0].name} et ${ps[1].name} sont désormais amoureux.`, 'seer', me.id);
    broadcastState(); checkNightEarly();
  }));
  socket.on('witch', guard(({ save, kill: k } = {}) => {
    if (game.phase !== 'witch' || !me.alive || me.role !== 'sorciere' || game.night.witchDone) return;
    const n = game.night;
    if (save && game.potions.life && n.victim) { n.witchSave = true; game.potions.life = false; }
    if (k && game.potions.death) {
      const p = aliveTarget(k);
      if (p && p.id !== me.id) { n.witchKill = p.id; game.potions.death = false; }
    }
    n.witchDone = true;
    sys(`🧪 ${n.witchSave ? 'Vous avez utilisé la potion de vie. ' : ''}${n.witchKill ? `Vous avez empoisonné ${get(n.witchKill).name}.` : ''}${!n.witchSave && !n.witchKill ? 'Vous n\'avez rien fait.' : ''}`, 'seer', me.id);
    setTimer(2, resolveNight);
    broadcastState();
  }));

  // --- jour
  socket.on('ready-vote', guard(() => {
    if (game.phase !== 'day' || !me.alive) return;
    game.readyVote.has(me.id) ? game.readyVote.delete(me.id) : game.readyVote.add(me.id);
    const a = alive().filter(p => p.connected);
    if ([...game.readyVote].filter(id => get(id)?.alive).length > a.length / 2) return startVote();
    broadcastState();
  }));
  socket.on('vote', guard(t => {
    if (game.phase !== 'vote' || !me.alive) return;
    const p = aliveTarget(t);
    if (!p) return;
    game.votes[me.id] = p.id;
    broadcastState();
    const a = alive().filter(p => p.connected);
    if (a.every(p => game.votes[p.id])) setTimer(3, resolveVote);
  }));
  socket.on('hunter-shoot', guard(t => {
    if (game.phase !== 'hunter' || !game.hunter || game.hunter.id !== me.id) return;
    const p = aliveTarget(t);
    if (!p) return;
    const { next } = game.hunter;
    clearTimer();
    game.hunter = null;
    const deaths = [];
    kill(p.id, 'chasseur', deaths);
    announce('🏹 Le chasseur a tiré !', deathText(deaths));
    sys(`🏹 ${me.name} abat ${p.name} (${roleName(p.role)}).`, 'phase');
    game.phase = 'day';
    afterDeaths(next);
  }));

  // --- voix (signalisation WebRTC)
  socket.on('voice-join', guard(() => {
    me.voice = true;
    socket.emit('voice-peers', all().filter(q => q.voice && q.connected && q.id !== me.id).map(q => q.id));
  }));
  socket.on('rtc', guard(({ to, data } = {}) => {
    const q = get(to);
    if (q && q.connected && q.voice) io.to(q.socketId).emit('rtc', { from: me.id, data });
  }));

  socket.on('disconnect', () => {
    if (!me || me.socketId !== socket.id) return;
    me.connected = false;
    me.voice = false;
    io.to(code).emit('voice-gone', me.id);
    if (game.phase === 'lobby') { game.players.delete(me.id); sys(`${me.name} a quitté le village.`); }
    if (game.hostId === me.id) game.hostId = all().find(p => p.connected)?.id || null;
    lastActive = Date.now();
    broadcastState();
  });

  onJoin();
}

// position des joueurs visibles, 15 fois par seconde
function anonId(p) {
  const n = game.night;
  if (!n) return 'anon_x';
  if (!n.anon.has(p.id)) n.anon.set(p.id, 'anon_' + Math.random().toString(36).slice(2, 8));
  return n.anon.get(p.id);
}
const posTimer = setInterval(() => {
  const ps = all();
  for (const p of ps) {
    if (!p.connected) continue;
    const list = [];
    const girl = peeking(p);
    for (const q of ps) {
      if (!((q.connected || game.phase !== 'lobby') && canSee(p, q))) continue;
      // la Petite Fille ne voit qu'une silhouette, sauf si le loup passe tout près
      const id = girl && q.id !== p.id && dist(p, q) > PEEK_IDENTIFY ? anonId(q) : q.id;
      list.push([id, q.x | 0, q.y | 0]);
    }
    io.to(p.socketId).emit('pos', list);
  }
}, 66);

// routage de la voix (calculé par le serveur, qui connaît tous les rôles)
// + détection de la Petite Fille, 5 fois par seconde
const hearTimer = setInterval(() => {
  const ps = all();
  const n = game.night;
  const girl = ps.find(peeking);
  let danger = 0;
  if (girl && n && !n.spotted) {
    for (const w of alive().filter(isWolf)) if (dist(w, girl) < DETECT_RADIUS) danger++;
    if (danger) n.detect += 0.2 * danger;
    if (n.detect >= DETECT_TIME) {
      n.spotted = true;
      girl.peek.open = false;
      for (const w of alive().filter(isWolf)) {
        w.seen[girl.id] = girl.role;
        sys(`👀 Vous avez surpris la Petite Fille qui vous espionnait : c'est ${girl.name} !`, 'wolf', w.id);
      }
      sys('😱 Les loups vous ont repérée ! Vous refermez vite la porte… mais ils savent qui vous êtes.', 'warn', girl.id);
      broadcastState();
    }
  }
  for (const p of ps) {
    if (!p.connected) continue;
    const msg = { out: [], in: {}, disguise: isNight() && isWolf(p) && p.alive };
    if (p.voice) for (const q of ps) {
      if (!q.connected || !q.voice || q.id === p.id) continue;
      if (canHear(q, p)) msg.out.push(q.id);
      if (canHear(p, q)) {
        let vol = 1;
        const global = game.phase === 'lobby' || game.phase === 'end' || (!p.alive && !q.alive) || (game.phase === 'vote' && p.alive && q.alive);
        if (!global) vol = Math.max(0, Math.min(1, 1.25 * (1 - dist(p, q) / HEAR_RADIUS)));
        if (vol > 0) msg.in[q.id] = +vol.toFixed(2);
      }
    }
    // les loups proches voient la lumière d'une porte entrouverte
    if (girl && isWolf(p) && p.alive && dist(p, girl) < AJAR_SEEN) msg.ajar = { x: girl.house.x, y: girl.house.y, a: girl.peek.angle };
    if (p === girl && n) { msg.detect = Math.min(1, n.detect / DETECT_TIME); msg.danger = danger; }
    io.to(p.socketId).emit('hear', msg);
  }
}, 200);

function connectedCount() { return all().filter(p => p.connected).length; }
function destroy() { clearInterval(posTimer); clearInterval(hearTimer); clearTimer(); }
return { code, attach, destroy, connectedCount, get lastActive() { return lastActive; }, get game() { return game; } };
} // ------------------------------------------------------- fin du salon

// connexion : créer un salon ou en rejoindre un avec son code
io.on('connection', socket => {
  const ip = String(socket.handshake.headers['x-forwarded-for'] || socket.handshake.address || '').split(',')[0].trim();
  const reply = (ack, p) => p.then(r => typeof ack === 'function' && ack(r)).catch(e => typeof ack === 'function' && ack({ error: e.message || 'Erreur du serveur.' }));
  const signedIn = res => { socket.data.user = res.user; if (res.token) socket.data.token = res.token; return res; };
  // ---- comptes
  socket.on('register', ({ name, password } = {}, ack) => reply(ack, accounts.register(name, password, ip).then(signedIn)));
  socket.on('login', ({ name, password } = {}, ack) => reply(ack, accounts.login(name, password, ip).then(signedIn)));
  socket.on('resume', (token, ack) => reply(ack, accounts.resume(token).then(user => {
    if (!user) return { error: 'Session expirée, reconnectez-vous.' };
    return signedIn({ user });
  })));
  socket.on('logout', (token, ack) => reply(ack, accounts.logout(token).then(() => { socket.data.user = null; return { ok: true }; })));

  // ---- salons (réservés aux joueurs connectés)
  socket.on('create-room', ack => {
    if (!socket.data.user) return typeof ack === 'function' && ack({ error: 'Connectez-vous d\'abord.' });
    if (rooms.size >= 500) return typeof ack === 'function' && ack({ error: 'Trop de salons ouverts, réessayez plus tard.' });
    const code = newCode();
    rooms.set(code, createRoom(code));
    console.log(`Salon ${code} créé (${rooms.size} salon(s))`);
    if (typeof ack === 'function') ack({ code });
  });
  socket.on('join', (data = {}) => {
    if (socket.data.room) return;
    if (!socket.data.user) return socket.emit('join-error', 'Connectez-vous d\'abord.');
    const code = String(data.room || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const room = rooms.get(code);
    if (!room) return socket.emit('join-error', `Le salon « ${code || '?'} » n'existe pas (ou a fermé). Vérifiez le code ou créez une nouvelle partie.`);
    if (room.connectedCount() >= 30) return socket.emit('join-error', 'Ce salon est plein.');
    socket.data.room = code;
    room.attach(socket, data);
  });
});

// fermeture des salons vides depuis 10 minutes
setInterval(() => {
  for (const [code, room] of rooms) {
    if (room.connectedCount() === 0 && Date.now() - room.lastActive > 10 * 60 * 1000) {
      room.destroy(); rooms.delete(code);
      console.log(`Salon ${code} fermé (inactif)`);
    }
  }
}, 60 * 1000);

// ----------------------------------------------------------- démarrage
function lanIPs() {
  return Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
}
async function startHttps() {
  try {
    const dir = path.join(__dirname, 'cert');
    const kp = path.join(dir, 'key.pem'), cp = path.join(dir, 'cert.pem');
    let key, cert;
    if (fs.existsSync(kp) && fs.existsSync(cp)) { key = fs.readFileSync(kp); cert = fs.readFileSync(cp); }
    else {
      const selfsigned = require('selfsigned');
      let pems = selfsigned.generate([{ name: 'commonName', value: 'loups-garous.local' }], { days: 3650, keySize: 2048 });
      if (pems && typeof pems.then === 'function') pems = await pems;
      key = pems.private; cert = pems.cert;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(kp, key); fs.writeFileSync(cp, cert);
    }
    const s = https.createServer({ key, cert }, app);
    io.attach(s);
    await new Promise((res, rej) => { s.once('error', rej); s.listen(HTTPS_PORT, res); });
    return true;
  } catch (e) {
    console.warn('HTTPS indisponible :', e.message);
    return false;
  }
}

(async () => {
  accounts = await openAccounts();
  console.log(`  Comptes joueurs : ${accounts.kind}`);
  if (!process.env.DATABASE_URL && process.env.RENDER) console.warn('  ⚠ Pas de DATABASE_URL : les comptes seront effacés à chaque redémarrage du serveur !');
  httpServer.listen(PORT, onListen);
})().catch(e => { console.error('Impossible d\'ouvrir la base des comptes :', e.message); process.exit(1); });
async function onListen() {
  const okHttps = await startHttps();
  const ips = lanIPs();
  console.log('\n  🐺  Les Loups de Brumeval — serveur lancé !\n');
  console.log(`  Sur cet ordinateur :      http://localhost:${PORT}`);
  if (okHttps) for (const ip of ips) console.log(`  Amis sur le même réseau : https://${ip}:${HTTPS_PORT}   (accepter l'avertissement de sécurité)`);
  else for (const ip of ips) console.log(`  Amis sur le même réseau : http://${ip}:${PORT}   (micro indisponible sans HTTPS)`);
  console.log('\n  Ctrl+C pour arrêter.\n');
}

