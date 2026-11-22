/* global io */
import { createScene } from './scene3d.js';
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const socket = io();
let myId = null;
try { myId = localStorage.getItem('lg-id'); } catch (e) { /* ignore */ }
if (!myId) { myId = 'p' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { localStorage.setItem('lg-id', myId); } catch (e) { /* ignore */ } }

let CFG = null;        // infos statiques envoyées par le serveur
let S = null;          // dernier état reçu
let clockOffset = 0;
const me = { x: 1200, y: 900 };
const others = new Map(); // id -> {x,y,tx,ty}
let visible = new Set();
const bubbles = new Map(); // id -> {text, until}
const keys = new Set();
let joined = false;

// ------------------------------------------------------------ connexion
if (!window.isSecureContext) $('#secureHint').hidden = false;
try { $('#nameIn').value = localStorage.getItem('lg-name') || ''; } catch (e) { /* ignore */ }
// ---- salons : code dans l'URL (?salon=ABCD) pour inviter ses amis
let roomCode = (new URLSearchParams(location.search).get('salon') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
if (roomCode) {
  $('#codeIn').value = roomCode;
  $('#inviteHint').hidden = false;
  $('#inviteHint').textContent = `🎟️ Vous êtes invité dans le salon ${roomCode} : entrez votre pseudo puis cliquez sur « Rejoindre ».`;
}
function loginError(msg) { const el = $('#loginErr'); el.textContent = msg; el.hidden = !msg; }
function getName() {
  const name = $('#nameIn').value.trim();
  if (!name) { loginError('Choisissez d\'abord un pseudo.'); $('#nameIn').focus(); return null; }
  try { localStorage.setItem('lg-name', name); } catch (e) { /* ignore */ }
  return name;
}
function join(code) {
  const name = getName();
  if (!name) return;
  code = String(code || '').toUpperCase().replace(/[^A-Z]/g, '');
  if (code.length !== 4) { loginError('Le code d\'un salon fait 4 lettres.'); return $('#codeIn').focus(); }
  loginError('');
  roomCode = code;
  joined = true;
  socket.emit('join', { id: myId, name, room: code });
}
$('#nameIn').addEventListener('keydown', e => { if (e.key === 'Enter') (roomCode ? join(roomCode) : $('#createBtn').click()); });
$('#codeIn').addEventListener('keydown', e => { if (e.key === 'Enter') join($('#codeIn').value); });
$('#codeIn').addEventListener('input', e => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
$('#joinBtn').onclick = () => join($('#codeIn').value);
$('#createBtn').onclick = () => {
  if (!getName()) return;
  socket.emit('create-room', res => {
    if (!res || res.error) return loginError(res ? res.error : 'Erreur du serveur.');
    join(res.code);
  });
};
socket.on('join-error', msg => { joined = false; loginError(msg); });
socket.on('connect', () => { if (joined) socket.emit('join', { id: myId, name: $('#nameIn').value.trim(), room: roomCode }); });
function inviteLink() { return `${location.origin}${location.pathname}?salon=${roomCode}`; }
$('#roomBtn').onclick = async () => {
  try { await navigator.clipboard.writeText(inviteLink()); $('#roomBtn').textContent = '✅ Lien copié !'; }
  catch (e) { prompt('Lien d\'invitation :', inviteLink()); }
  setTimeout(() => { $('#roomBtn').textContent = `🔑 Salon ${roomCode} · 📋 Copier le lien`; }, 2000);
};
$('#leaveBtn').onclick = () => { if (confirm('Quitter ce salon ?')) location.href = location.pathname; };
socket.on('welcome', cfg => {
  CFG = cfg;
  roomCode = cfg.room;
  history.replaceState(null, '', `?salon=${roomCode}`);
  $('#roomBtn').textContent = `🔑 Salon ${roomCode} · 📋 Copier le lien`;
  document.title = `Salon ${roomCode} — Les Loups de Brumeval`;
  $('#login').hidden = true;
  $('#game').hidden = false;
  if (!scene3d) scene3d = createScene(cv, cfg, { onPick: id => {
    // pendant le vote : cliquer sur un joueur = voter contre lui
    if (S && S.phase === 'vote' && S.me.alive && id !== myId && P(id)?.alive) socket.emit('vote', id);
  } });
  window.dbg = { get S() { return S; }, me, voice, get visible() { return visible; }, emit: (...a) => socket.emit(...a) };
});
socket.on('teleport', p => {
  me.x = p.x; me.y = p.y;
  if (scene3d) p.look === 'circle' ? scene3d.faceCenterFrom(p.x, p.y) : scene3d.faceHouseFrom(p.x, p.y);
});
socket.on('pos', list => {
  visible = new Set();
  for (const [id, x, y] of list) {
    visible.add(id);
    if (id === myId) continue;
    const o = others.get(id);
    if (!o || Math.hypot(o.x - x, o.y - y) > 400) others.set(id, { x, y, tx: x, ty: y });
    else { o.tx = x; o.ty = y; }
  }
});
socket.on('state', st => {
  const prevPhase = S && S.phase;
  S = st;
  clockOffset = st.serverNow - Date.now();
  if (prevPhase !== st.phase) { cupidSel = []; witchSel = { save: false, kill: null }; }
  renderAll();
});
socket.on('chat', m => {
  addLog(`<b style="color:${esc(m.color)}">${m.ghost ? '👻 ' : ''}${m.wolf ? '🐺 ' : ''}${esc(m.name)}</b> : ${esc(m.text)}`, m.ghost ? 'ghost' : m.wolf ? 'wolf' : '');
  bubbles.set(m.from, { text: m.text, until: Date.now() + 4500 + m.text.length * 50 });
});
socket.on('sys', m => addLog(esc(m.text), m.kind === 'warn' ? 'sys warnm' : 'sys ' + m.kind));
socket.on('announce', m => showModal(m.title, m.text));

function addLog(html, cls = '') {
  const log = $('#chatlog');
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  log.appendChild(d);
  while (log.children.length > 150) log.firstChild.remove();
  log.scrollTop = log.scrollHeight;
}
let modalTimer = null;
function showModal(title, text) {
  $('#modalTitle').textContent = title;
  $('#modalText').textContent = text;
  $('#modal').hidden = false;
  clearTimeout(modalTimer);
  modalTimer = setTimeout(() => { $('#modal').hidden = true; }, 9000);
}
$('#modalOk').onclick = () => { $('#modal').hidden = true; };

// ---------------------------------------------------------------- chat
const chatIn = $('#chatIn');
chatIn.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const t = chatIn.value.trim();
    if (t) socket.emit('chat', t);
    chatIn.value = '';
    chatIn.blur();
  } else if (e.key === 'Escape') chatIn.blur();
  e.stopPropagation();
});
window.addEventListener('keydown', e => {
  if (!joined || document.activeElement === $('#nameIn')) return;
  if (document.activeElement && ['INPUT', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === 'Enter') { chatIn.focus(); e.preventDefault(); return; }
  if (e.key.toLowerCase() === 'e' && !e.repeat) togglePeek();
  keys.add(e.key.toLowerCase());
  if (e.key.startsWith('Arrow')) e.preventDefault();
});
window.addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
window.addEventListener('blur', () => keys.clear());

// ------------------------------------------------------- Petite Fille
let peekAngle = Math.PI / 2, lastPeekSend = 0, lastPeekKey = '';
const isGirlNight = () => S && S.me.role === 'petitefille' && S.me.alive && isNightPhase();
function togglePeek() {
  if (!isGirlNight() || S.spotted) return;
  S.peek = !S.peek;
  sendPeek(true);
  lastPanelKey = ''; renderPanel();
}
function sendPeek(force) {
  const k = `${S.peek ? 1 : 0}:${peekAngle.toFixed(2)}`;
  const now = performance.now();
  if (k === lastPeekKey || (!force && now - lastPeekSend < 80)) return;
  lastPeekKey = k; lastPeekSend = now;
  socket.emit('peek', { open: !!S.peek, angle: peekAngle });
}
window.addEventListener('mousemove', e => {
  if (!isGirlNight() || !scene3d) return;
  const g = scene3d.mouseGround(e.clientX, e.clientY), h = myHouse();
  if (!g || !h) return;
  // on regarde par la porte : angle limité devant la façade
  let a = Math.atan2(g.y - h.y, g.x - h.x), da = Math.atan2(Math.sin(a - h.face), Math.cos(a - h.face));
  da = Math.max(-1.2, Math.min(1.2, da));
  peekAngle = h.face + da;
  if (S.peek) sendPeek(false);
});

// -------------------------------------------------------------- helpers
const P = id => S && S.players.find(p => p.id === id);
const R = role => (CFG && CFG.roleInfo[role]) || null;
const meP = () => S && P(myId);
const isNightPhase = () => S && (S.phase === 'night' || S.phase === 'witch');
const amWolf = () => S && S.me.role === 'loup';
function canMoveClient() {
  if (!S) return false;
  if (S.phase === 'lobby' || S.phase === 'end' || !S.me.alive) return true;
  if (isNightPhase()) return amWolf();
  if (S.phase === 'vote') return false; // on ne quitte pas le cercle du conseil
  return true;
}
function posOf(id) {
  if (id === myId) return me;
  if (!visible.has(id)) return null;
  return others.get(id) || null;
}
function timeLeft() { return S && S.timerEnd ? Math.max(0, Math.ceil((S.timerEnd - (Date.now() + clockOffset)) / 1000)) : null; }

// --------------------------------------------------------- panneaux UI
let cupidSel = [];
let witchSel = { save: false, kill: null };
let lastPanelKey = '';
let lastListKey = '';

function renderAll() {
  if (!S || !CFG) return;
  const PH = { lobby: '🏡 Salle d\'attente', night: `🌙 Nuit ${S.day}`, witch: `🧪 Nuit ${S.day} — la sorcière`,
    hunter: '🏹 Le chasseur vise…', day: `☀️ Jour ${S.day} — débat`, vote: `🗳️ Jour ${S.day} — vote`, end: '🏁 Fin de partie' };
  $('#phaseLbl').textContent = PH[S.phase] || S.phase;
  // carte de rôle
  const rc = $('#rolecard');
  const r = R(S.me.role);
  if (r) {
    rc.hidden = false;
    const lover = S.me.lover && P(S.me.lover);
    rc.innerHTML = `<div class="rn">${r.icon} ${esc(r.name)}${S.me.alive ? '' : ' <small>(mort)</small>'}</div>
      ${lover ? `<div>💘 Amoureux de <b>${esc(lover.name)}</b></div>` : ''}<div class="rd">${esc(r.desc)}</div>`;
  } else rc.hidden = true;
  renderPanel();
  renderList();
}
$('#rolecard').onclick = () => $('#rolecard').classList.toggle('small');

function targetBtns(list, act, opts = {}) {
  if (!list.length) return '<p>Aucune cible possible.</p>';
  return `<div class="targets">${list.map(p => `<button data-act="${act}" data-id="${p.id}" class="${opts.sel && opts.sel(p) ? 'sel' : ''}" ${opts.disabled && opts.disabled(p) ? 'disabled' : ''}>
    <span><span style="color:${esc(p.color)}">●</span> ${esc(p.name)}</span><span>${opts.extra ? opts.extra(p) : ''}</span></button>`).join('')}</div>`;
}

function renderPanel() {
  const isHost = S.hostId === myId;
  const living = S.players.filter(p => p.alive);
  const others = living.filter(p => p.id !== myId);
  let h = '';
  const ph = S.phase;
  if (ph === 'lobby') {
    const st = S.settings;
    const n = S.players.length;
    const autoW = Math.max(1, Math.floor(n / 4));
    h += `<h4>Salle d'attente (${n} joueur${n > 1 ? 's' : ''})</h4>
      <p class="roomcode">Code du salon : <b>${esc(roomCode)}</b><br><small>Partagez ce code ou le lien (bouton en haut) à vos amis.</small></p>`;
    if (isHost) {
      h += `<p>Vous êtes l'hôte 👑. Réglez la partie puis lancez-la (3 joueurs minimum).</p>
      <div class="row"><label>Loups-garous</label><select data-set="wolves">
        <option value="0" ${st.wolves === 0 ? 'selected' : ''}>Auto (${autoW})</option>
        ${[1, 2, 3, 4, 5, 6].map(k => `<option value="${k}" ${st.wolves === k ? 'selected' : ''}>${k}</option>`).join('')}
      </select></div>
      ${['voyante', 'sorciere', 'chasseur', 'cupidon', 'petitefille'].map(rk => `<div class="row"><label>${R(rk).icon} ${R(rk).name}</label>
        <input type="checkbox" data-role="${rk}" ${st.roles[rk] ? 'checked' : ''}></div>`).join('')}
      <p><b>Chronos (secondes)</b></p>
      ${[['night', 'Nuit (actions)'], ['witch', 'Sorcière'], ['day', 'Débat'], ['vote', 'Vote'], ['hunter', 'Chasseur']].map(([k, l]) =>
        `<div class="row"><label>${l}</label><input type="number" min="10" max="600" data-timer="${k}" value="${st.timers[k]}"></div>`).join('')}
      <button class="primary" data-act="start" ${n < 3 ? 'disabled' : ''} style="width:100%;margin-top:8px">▶ Lancer la partie</button>`;
    } else {
      h += `<p>En attente que l'hôte (${esc(P(S.hostId)?.name || '?')}) lance la partie…</p>
      <p>Rôles : ${S.settings.wolves || 'auto'} loup(s)${Object.entries(S.settings.roles).filter(([, v]) => v).map(([k]) => ', ' + R(k).name).join('')}.</p>
      <p>Promenez-vous et discutez en attendant !</p>`;
    }
  } else if (ph === 'night') {
    const role = S.me.role;
    if (!S.me.alive) h += `<h4>👻 Vous êtes un fantôme</h4><p>Vous voyez tout. Les loups votent :</p>${wolfVotesHtml()}`;
    else if (role === 'loup') {
      const mine = S.wolfVotes && S.wolfVotes[myId];
      h += `<h4>🐺 Choisissez votre victime</h4><p>Sortez discrètement de chez vous et retrouvez la meute (tanière en haut à gauche). Votre voix est déformée cette nuit. Gare aux portes entrouvertes : la Petite Fille espionne peut-être !</p>
        ${mine ? '' : '<p class="warn">⚠ Vous n\'avez pas encore voté !</p>'}
        ${targetBtns(living.filter(p => p.role !== 'loup'), 'wolf-vote', { sel: p => mine === p.id, extra: p => wolfCount(p.id) })}`;
    } else if (role === 'voyante') {
      if (S.seerTarget) { const t = P(S.seerTarget); h += `<h4>🔮 Vision</h4><p class="done">${esc(t.name)} est ${R(t.role)?.icon} ${esc(R(t.role)?.name || '?')}.</p><p>Rendormez-vous…</p>`; }
      else h += `<h4>🔮 Qui voulez-vous sonder ?</h4><p class="warn">⚠ Choisissez avant la fin de la nuit !</p>${targetBtns(others, 'seer', { extra: p => p.role ? R(p.role).icon : '' })}`;
    } else if (role === 'petitefille') {
      h += girlPanel();
    } else if (role === 'cupidon' && S.day === 1) {
      if (S.cupid) h += `<h4>💘 C'est fait</h4><p class="done">${esc(P(S.cupid[0]).name)} ❤ ${esc(P(S.cupid[1]).name)}</p>`;
      else h += `<h4>💘 Choisissez deux amoureux</h4><p class="warn">⚠ Avant la fin de la nuit !</p>${targetBtns(living, 'cupid-pick', { sel: p => cupidSel.includes(p.id) })}
        <button class="primary" data-act="cupid-ok" ${cupidSel.length === 2 ? '' : 'disabled'} style="width:100%;margin-top:6px">Unir ces deux cœurs</button>`;
    } else h += `<h4>💤 Vous dormez</h4><p>Les créatures de la nuit s'agitent… Vous ne pouvez ni bouger ni parler.</p>`;
  } else if (ph === 'witch') {
    if (S.witch && S.me.alive) {
      const w = S.witch, v = w.victim && P(w.victim);
      if (w.done) h += `<h4>🧪 C'est fait</h4><p class="done">Vous vous rendormez.</p>`;
      else {
        h += `<h4>🧪 Sorcière, réveillez-vous</h4><p>${v ? `Les loups ont attaqué <b>${esc(v.name)}</b>.` : 'Les loups n\'ont attaqué personne.'}</p>`;
        if (v && w.potions.life) h += `<button data-act="w-save" class="${witchSel.save ? 'sel' : ''}" style="width:100%">💚 Potion de vie : sauver ${esc(v.name)}</button>`;
        else h += `<p><i>${w.potions.life ? '' : 'Potion de vie déjà utilisée.'}</i></p>`;
        if (w.potions.death) h += `<p>☠️ Potion de mort (optionnel) :</p>${targetBtns(others, 'w-kill', { sel: p => witchSel.kill === p.id })}`;
        else h += '<p><i>Potion de mort déjà utilisée.</i></p>';
        h += `<button class="primary" data-act="w-ok" style="width:100%;margin-top:8px">Valider</button>`;
      }
    } else if (!S.me.alive) h += `<h4>🧪 La sorcière se réveille</h4><p>Victime des loups : ${esc(P(S.wolfVictim)?.name || '?')}</p>${wolfVotesHtml()}`;
    else if (S.me.role === 'petitefille') h += girlPanel();
    else h += `<h4>💤 Vous dormez</h4><p>La sorcière prépare ses potions…</p>`;
  } else if (ph === 'hunter') {
    const hu = P(S.hunterId);
    if (S.hunterId === myId) h += `<h4>🏹 Dernière balle !</h4><p class="warn">Choisissez vite qui emporter avec vous.</p>${targetBtns(living, 'hunter-shoot')}`;
    else h += `<h4>🏹 ${esc(hu?.name || 'Le chasseur')} vise…</h4><p>Le chasseur choisit sa cible.</p>`;
  } else if (ph === 'day') {
    const ready = S.ready || [];
    const nAlive = living.length;
    h += `<h4>☀️ Débat</h4><p>Déplacez-vous vers les autres pour leur parler : seuls les joueurs dans votre cercle vous entendent. Accusez, défendez-vous !</p>`;
    if (S.me.alive) h += `<button data-act="ready-vote" class="${ready.includes(myId) ? 'sel' : ''}" style="width:100%">${ready.includes(myId) ? '✔ Prêt à voter' : 'Passer au vote'} (${ready.length}/${Math.floor(nAlive / 2) + 1})</button>`;
    else h += '<p>👻 Vous êtes mort : vous écoutez les vivants proches et parlez aux autres fantômes.</p>';
  } else if (ph === 'vote') {
    const votes = S.votes || {};
    const mine = votes[myId];
    const count = id => Object.values(votes).filter(t => t === id).length;
    const voters = id => Object.entries(votes).filter(([, t]) => t === id).map(([v]) => P(v)?.name).filter(Boolean).join(', ');
    h += `<h4>🗳️ Conseil du village</h4><p>Tout le village est réuni en cercle autour du feu : chacun entend tout le monde. <b>Cliquez sur un joueur</b> (ou sur la liste) pour voter contre lui.</p>`;
    if (S.me.alive) h += `${mine ? '' : '<p class="warn">⚠ Vous n\'avez pas voté.</p>'}${targetBtns(others, 'vote', { sel: p => mine === p.id, extra: p => count(p.id) ? `${count(p.id)} 🗳️` : '' })}`;
    h += `<div style="margin-top:8px;font-size:12px">${living.filter(p => count(p.id)).map(p => `<div><b>${esc(p.name)}</b> ← ${esc(voters(p.id))}</div>`).join('')}</div>`;
  } else if (ph === 'end') {
    const W = { village: '🏡 Victoire du village !', loups: '🐺 Victoire des loups-garous !', amoureux: '💘 Victoire des amoureux !', personne: '☠️ Aucun survivant' };
    h += `<h4>${W[S.winner] || 'Fin'}</h4><p>Tous les rôles sont révélés dans la liste.</p>`;
    if (isHost) h += `<button class="primary" data-act="restart" style="width:100%">🔁 Retour à la salle d'attente</button>`;
  }
  if (isHost && ph !== 'lobby' && ph !== 'end') h += `<button class="skip" data-act="skip" style="width:100%">⏭ (Hôte) Terminer cette phase maintenant</button>`;

  const key = h;
  if (key === lastPanelKey) return;
  // ne pas détruire un champ en cours d'édition
  if (document.activeElement && $('#panelBody').contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && ph === 'lobby') return;
  lastPanelKey = key;
  $('#panelBody').innerHTML = h;
}
function girlPanel() {
  if (S.spotted) return `<h4>👧 Repérée !</h4><p class="warn">Les loups vous ont vue. Votre porte reste fermée jusqu'au matin.</p>`;
  return `<h4>👧 Espionner les loups</h4>
    <p>Entrouvrez la porte puis visez avec la souris : vous voyez un cône étroit. Les loups lointains sont des silhouettes ; vous ne les reconnaissez que s'ils passent tout près… mais alors ils risquent de vous repérer !</p>
    <button data-act="peek" class="${S.peek ? 'sel' : ''}" style="width:100%">${S.peek ? '🚪 Refermer la porte (E)' : '🚪 Entrouvrir la porte (E)'}</button>
    <div id="detectWrap" style="margin-top:8px">Risque d'être repérée : <div style="height:8px;background:#2a3040;border-radius:4px;overflow:hidden"><div id="detectBar" style="height:100%;width:0;background:#e5533c"></div></div></div>`;
}
function wolfCount(id) {
  if (!S.wolfVotes) return '';
  const n = Object.values(S.wolfVotes).filter(t => t === id).length;
  return n ? '🐺'.repeat(n) : '';
}
function wolfVotesHtml() {
  if (!S.wolfVotes) return '';
  const e = Object.entries(S.wolfVotes);
  if (!e.length) return '<p><i>Aucun vote pour l\'instant.</i></p>';
  return e.map(([w, t]) => `<div>🐺 ${esc(P(w)?.name)} → ${esc(P(t)?.name)}</div>`).join('');
}

$('#panelBody').addEventListener('click', e => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled) return;
  const id = b.dataset.id, act = b.dataset.act;
  switch (act) {
    case 'peek': togglePeek(); break;
    case 'start': case 'skip': case 'restart': case 'ready-vote': socket.emit(act); break;
    case 'wolf-vote': case 'seer': case 'guard': case 'vote': case 'hunter-shoot': socket.emit(act, id); break;
    case 'cupid-pick':
      cupidSel = cupidSel.includes(id) ? cupidSel.filter(x => x !== id) : [...cupidSel, id].slice(-2);
      renderPanel(); break;
    case 'cupid-ok': socket.emit('cupid', cupidSel); break;
    case 'w-save': witchSel.save = !witchSel.save; renderPanel(); break;
    case 'w-kill': witchSel.kill = witchSel.kill === id ? null : id; renderPanel(); break;
    case 'w-ok': socket.emit('witch', witchSel); break;
  }
});
$('#panelBody').addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.set === 'wolves') socket.emit('settings', { wolves: +t.value });
  if (t.dataset.role) socket.emit('settings', { roles: { [t.dataset.role]: t.checked } });
  if (t.dataset.timer) socket.emit('settings', { timers: { [t.dataset.timer]: +t.value } });
});

function renderList() {
  const lovers = S.lovers || [];
  const html = S.players.map(p => {
    const r = p.role && R(p.role);
    const badges = (p.id === S.hostId ? '👑' : '') + (lovers.includes(p.id) ? '💘' : '') + (p.id === myId ? ' (vous)' : '');
    return `<li class="${p.alive ? '' : 'dead'} ${p.connected ? '' : 'off'}"><span class="dot" style="background:${esc(p.color)}"></span>
      <span class="nm">${esc(p.name)} ${badges}</span><span class="rl">${r && S.phase !== 'lobby' ? r.icon + ' ' + esc(r.name) : ''}</span></li>`;
  }).join('');
  $('#pcount').textContent = `(${S.players.filter(p => p.alive && !p.spectator).length} en vie)`;
  if (html !== lastListKey) { lastListKey = html; $('#plist').innerHTML = html; }
}

// ------------------------------------------------------------- rendu 3D
const cv = $('#cv');
let scene3d = null;
function myHouse() { const p = meP(); return p && p.house; }

let lastSend = 0, lastSent = '';
let lastT = performance.now();
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (t - lastT) / 1000); lastT = t;
  if (!CFG || !S || !scene3d) return;
  // déplacement relatif à la caméra
  if (canMoveClient() && document.activeElement !== chatIn) {
    let dx = 0, dy = 0;
    if (keys.has('z') || keys.has('w') || keys.has('arrowup')) dy--;
    if (keys.has('s') || keys.has('arrowdown')) dy++;
    if (keys.has('q') || keys.has('a') || keys.has('arrowleft')) dx--;
    if (keys.has('d') || keys.has('arrowright')) dx++;
    if (dx || dy) {
      const l = Math.hypot(dx, dy), sp = (S.me.alive ? 230 : 320) * dt, yaw = scene3d.yaw;
      const mx = (Math.cos(yaw) * dx - Math.sin(yaw) * -dy) / l, my = (-Math.sin(yaw) * dx - Math.cos(yaw) * -dy) / l;
      let to = { x: Math.max(20, Math.min(CFG.world.w - 20, me.x + mx * sp)), y: Math.max(20, Math.min(CFG.world.h - 20, me.y + my * sp)) };
      if (S.me.alive) to = scene3d.collide(me, to); // les fantômes traversent les murs
      me.x = to.x; me.y = to.y;
    }
  }
  const k = `${me.x | 0},${me.y | 0}`;
  if (t - lastSend > 50 && k !== lastSent) { lastSend = t; lastSent = k; socket.emit('move', { x: me.x, y: me.y }); }
  for (const o of others.values()) { o.x += (o.tx - o.x) * Math.min(1, dt * 12); o.y += (o.ty - o.y) * Math.min(1, dt * 12); }

  // timer
  const tl = timeLeft();
  const tLbl = $('#timerLbl');
  tLbl.textContent = tl != null && S.phase !== 'lobby' && S.phase !== 'end' ? `⏳ ${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}` : '';
  tLbl.classList.toggle('urgent', tl != null && tl <= 10 && needsAction());

  // message central
  let msg = '';
  if (isNightPhase() && S.me.alive && !amWolf()) {
    msg = isGirlNight() ? (S.spotted ? '😱 Repérée ! Porte fermée.' : S.peek ? (voice.danger ? '⚠ Un loup est tout près !' : '') : '👧 Appuyez sur E pour entrouvrir la porte')
      : needsAction() ? '🌙 Agissez avant la fin de la nuit ! →' : '💤 Vous dormez dans votre maison…';
  }
  const cm = $('#centerMsg');
  if (cm.textContent !== msg) cm.textContent = msg;
  cm.hidden = !msg;

  // entités visibles
  const now = Date.now();
  const entities = [];
  for (const p of S.players) {
    if (!(visible.has(p.id) || p.id === myId)) continue;
    const pos = posOf(p.id) || me;
    const b = bubbles.get(p.id);
    entities.push({ id: p.id, name: p.name, color: p.color, alive: p.alive, role: S.phase === 'lobby' ? null : p.role, x: pos.x, y: pos.y,
      isMe: p.id === myId, speaking: (voice.levels.get(p.id) || 0) > 0.04, bubble: b && b.until > now ? b.text : null,
      votes: S.phase === 'vote' ? Object.values(S.votes || {}).filter(t => t === p.id).length : 0 });
  }
  for (const id of visible) if (id.startsWith('anon_') && others.get(id)) {
    const o = others.get(id), b = bubbles.get(id);
    entities.push({ id, anon: true, name: '?', color: '#202026', alive: true, role: 'loup', x: o.x, y: o.y, bubble: b && b.until > now ? b.text : null });
  }
  const owners = {};
  for (const p of S.players) if (p.house) owners[p.house.i] = p;
  scene3d.frame(dt, {
    phase: S.phase, night: isNightPhase(), myVote: S.phase === 'vote' ? (S.votes || {})[myId] : null, alive: S.me.alive, wolf: amWolf(), me, entities, owners,
    peek: isGirlNight() && S.peek ? { angle: peekAngle, half: CFG.peek.half, range: CFG.peek.range } : null,
    ajar: voice.ajar && isNightPhase() ? voice.ajar : null,
    showRing: S.phase !== 'lobby' && S.phase !== 'end' && (!isNightPhase() || amWolf() || !S.me.alive),
  });
}
function needsAction() {
  if (!S.me.alive) return false;
  const r = S.me.role;
  if (S.phase === 'night') return (r === 'loup' && !(S.wolfVotes || {})[myId]) || (r === 'voyante' && !S.seerTarget) || (r === 'cupidon' && S.day === 1 && !S.cupid);
  if (S.phase === 'witch') return !!(S.witch && !S.witch.done);
  if (S.phase === 'vote') return !(S.votes || {})[myId];
  if (S.phase === 'hunter') return S.hunterId === myId;
  return false;
}
requestAnimationFrame(frame);

// ============================================================= VOIX
// Maillage WebRTC : chaque client se connecte aux autres. On n'envoie
// notre micro qu'aux joueurs autorisés à nous entendre (règles du jeu),
// et le volume de réception dépend de la distance.
const voice = { on: false, track: null, wolfTrack: null, muted: false, peers: new Map(), levels: new Map(), actx: null, localAn: null,
  out: new Set(), in: {}, disguise: false, ajar: null, danger: 0 };
socket.on('hear', m => {
  voice.out = new Set(m.out); voice.in = m.in; voice.disguise = m.disguise; voice.ajar = m.ajar || null; voice.danger = m.danger || 0;
  const bar = document.getElementById('detectBar');
  if (bar) bar.style.width = Math.round((m.detect || 0) * 100) + '%';
  routeVoice();
});

// Déformation de la voix des loups (pitch plus grave + grondement), via AudioWorklet
const DISGUISE_WORKLET = `
class Disguise extends AudioWorkletProcessor {
  constructor() { super(); this.size = 8192; this.buf = new Float32Array(this.size); this.w = 0; this.win = 1400; this.ph = 0; this.ratio = 0.7; this.t = 0; }
  read(pos) { pos = ((pos % this.size) + this.size) % this.size; const i = Math.floor(pos), f = pos - i; return this.buf[i] * (1 - f) + this.buf[(i + 1) % this.size] * f; }
  process(inputs, outputs) {
    const inp = inputs[0] && inputs[0][0], outs = outputs[0];
    if (!outs || !outs[0]) return true;
    const out = outs[0];
    for (let i = 0; i < out.length; i++) {
      this.buf[this.w] = inp ? inp[i] : 0;
      this.ph += (1 - this.ratio) / this.win; if (this.ph >= 1) this.ph -= 1;
      const p1 = this.ph, p2 = (this.ph + 0.5) % 1;
      let y = this.read(this.w - p1 * this.win - 1) * (1 - Math.abs(2 * p1 - 1)) + this.read(this.w - p2 * this.win - 1) * (1 - Math.abs(2 * p2 - 1));
      this.t += 1 / sampleRate;
      y *= 0.7 + 0.3 * Math.sin(2 * Math.PI * 38 * this.t);
      out[i] = Math.tanh(y * 1.8) * 0.9;
      this.w = (this.w + 1) % this.size;
    }
    for (let c = 1; c < outs.length; c++) outs[c].set(out);
    return true;
  }
}
registerProcessor('disguise', Disguise);`;
async function buildDisguise(stream) {
  try {
    const url = URL.createObjectURL(new Blob([DISGUISE_WORKLET], { type: 'application/javascript' }));
    await voice.actx.audioWorklet.addModule(url);
    const src = voice.actx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(voice.actx, 'disguise', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    const lp = voice.actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const dest = voice.actx.createMediaStreamDestination();
    src.connect(node).connect(lp).connect(dest);
    voice.wolfTrack = dest.stream.getAudioTracks()[0];
  } catch (e) { console.warn('déformation indisponible', e); }
}
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

$('#voiceBtn').onclick = async () => {
  if (voice.on) return;
  voice.actx = new (window.AudioContext || window.webkitAudioContext)();
  try {
    if (!navigator.mediaDevices) throw new Error('insecure');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    voice.track = stream.getAudioTracks()[0];
    voice.localAn = analyser(stream);
    await buildDisguise(stream);
    $('#muteBtn').hidden = false;
    addLog('🎙️ Vocal activé : les joueurs proches vous entendent.', 'sys');
  } catch (e) {
    addLog(window.isSecureContext ? '🎙️ Micro refusé ou introuvable : mode écoute seule.' : '🎙️ Micro impossible sans HTTPS : mode écoute seule. Utilisez l\'adresse https://…:3443 du serveur.', 'sys warnm');
  }
  voice.on = true;
  $('#voiceBtn').textContent = voice.track ? '🎙️ Vocal actif' : '🎧 Écoute seule';
  $('#voiceBtn').disabled = true;
  socket.emit('voice-join');
};
$('#muteBtn').onclick = () => {
  voice.muted = !voice.muted;
  $('#muteBtn').textContent = voice.muted ? '🔇 Micro coupé' : '🔊 Micro ouvert';
  $('#muteBtn').classList.toggle('off', voice.muted);
};
socket.on('connect', () => {
  // reconnexion : on reconstruit le maillage
  for (const id of [...voice.peers.keys()]) closePeer(id);
  if (voice.on) setTimeout(() => socket.emit('voice-join'), 500);
});

function analyser(stream) {
  try {
    const src = voice.actx.createMediaStreamSource(stream);
    const an = voice.actx.createAnalyser(); an.fftSize = 512;
    src.connect(an);
    return { an, buf: new Uint8Array(an.fftSize) };
  } catch (e) { return null; }
}
function level(a) {
  if (!a) return 0;
  a.an.getByteTimeDomainData(a.buf);
  let s = 0; for (const v of a.buf) { const d = (v - 128) / 128; s += d * d; }
  return Math.sqrt(s / a.buf.length);
}

function createPeer(id, initiator) {
  closePeer(id);
  const pc = new RTCPeerConnection(ICE);
  const audio = document.createElement('audio');
  audio.autoplay = true; audio.playsInline = true; audio.volume = 0;
  document.body.appendChild(audio);
  const peer = { pc, audio, sender: null, sending: null, pending: [], an: null };
  voice.peers.set(id, peer);
  pc.onicecandidate = e => { if (e.candidate) socket.emit('rtc', { to: id, data: { candidate: e.candidate } }); };
  pc.ontrack = e => {
    const st = e.streams[0] || new MediaStream([e.track]);
    audio.srcObject = st;
    audio.play().catch(() => {});
    peer.an = analyser(st);
  };
  pc.onconnectionstatechange = () => { if (pc.connectionState === 'failed') closePeer(id); };
  if (initiator) {
    const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    peer.sender = tr.sender;
    pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => socket.emit('rtc', { to: id, data: { sdp: pc.localDescription } })).catch(console.error);
  }
  return peer;
}
function closePeer(id) {
  const p = voice.peers.get(id);
  if (!p) return;
  try { p.pc.close(); } catch (e) { /* ignore */ }
  p.audio.remove();
  voice.peers.delete(id);
  voice.levels.delete(id);
}
socket.on('voice-peers', ids => { for (const id of ids) createPeer(id, true); });
socket.on('voice-gone', id => closePeer(id));
socket.on('rtc', async ({ from, data }) => {
  if (!voice.on) return;
  let peer = voice.peers.get(from);
  try {
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        peer = createPeer(from, false);
        await peer.pc.setRemoteDescription(data.sdp);
        const tr = peer.pc.getTransceivers()[0];
        tr.direction = 'sendrecv';
        peer.sender = tr.sender;
        await peer.pc.setLocalDescription(await peer.pc.createAnswer());
        socket.emit('rtc', { to: from, data: { sdp: peer.pc.localDescription } });
      } else if (peer) await peer.pc.setRemoteDescription(data.sdp);
      if (peer) { for (const c of peer.pending) await peer.pc.addIceCandidate(c).catch(() => {}); peer.pending = []; }
    } else if (data.candidate && peer) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      else peer.pending.push(data.candidate);
    }
  } catch (e) { console.error('rtc', e); }
});

// routage audio décidé par le serveur : à qui j'envoie ma voix, et à quel volume j'entends chacun.
// La nuit, un loup envoie sa voix déformée.
function routeVoice() {
  if (!voice.on) return;
  const myTrack = voice.disguise ? (voice.wolfTrack || voice.track) : voice.track;
  for (const [id, peer] of voice.peers) {
    const t = voice.track && !voice.muted && voice.out.has(id) ? myTrack : null;
    if (peer.sender && peer.sending !== t) {
      peer.sending = t;
      peer.sender.replaceTrack(t).catch(() => {});
    }
    peer.audio.volume = voice.in[id] || 0;
  }
}
setInterval(routeVoice, 500);
// niveaux sonores pour l'anneau "parle"
setInterval(() => {
  if (!voice.on) return;
  voice.levels.set(myId, voice.track && !voice.muted && canHearSelf() ? level(voice.localAn) : 0);
  for (const [id, peer] of voice.peers) voice.levels.set(id, peer.audio.volume > 0 ? level(peer.an) : 0);
}, 100);
function canHearSelf() { return !isNightPhase() || amWolf() || !S.me.alive; }
