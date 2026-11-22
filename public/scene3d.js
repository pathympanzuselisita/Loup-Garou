// =====================================================================
//  Rendu 3D du village (Three.js)
//  Coordonnées du serveur en « px » : X = x/20, Z = y/20 (1 unité ≈ 1 m)
// =====================================================================
import * as THREE from 'three';

const SC = 1 / 20;
const toW = (x, y) => new THREE.Vector3(x * SC, 0, y * SC);

// ------------------------------------------------------------ textures
function seeded(seed) { return () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; }
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function noiseFill(g, s, base, cols, n, rand, wmin = 2, wmax = 6) {
  g.fillStyle = base; g.fillRect(0, 0, s, s);
  for (let i = 0; i < n; i++) { g.fillStyle = cols[Math.floor(rand() * cols.length)]; g.fillRect(rand() * s, rand() * s, wmin + rand() * (wmax - wmin), wmin + rand() * (wmax - wmin)); }
}
function makeTextures() {
  const r = seeded(7);
  return {
    grass: canvasTex(256, (g, s) => noiseFill(g, s, '#4a7a3a', ['#55883f', '#3f6d32', '#5c9146', '#466f36'], 1800, r, 1, 4), 40),
    dirt: canvasTex(256, (g, s) => noiseFill(g, s, '#9c8160', ['#8d7354', '#a98d6a', '#7e664a'], 1400, r, 1, 5), 6),
    cobble: canvasTex(512, (g, s) => {
      g.fillStyle = '#6e6a62'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 32) for (let x = (y / 32) % 2 ? -16 : 0; x < s; x += 32) {
        const v = 120 + Math.floor(r() * 40); g.fillStyle = `rgb(${v},${v - 4},${v - 12})`;
        g.beginPath(); g.roundRect(x + 2, y + 2, 28, 28, 7); g.fill();
      }
    }, 6),
    plaster: canvasTex(256, (g, s) => noiseFill(g, s, '#e3d6b8', ['#d9caa8', '#ece2c8', '#d4c3a0'], 900, r, 1, 4), 1),
    stone: canvasTex(256, (g, s) => {
      g.fillStyle = '#5d5a55'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 28) for (let x = (y / 28) % 2 ? -22 : 0; x < s; x += 44) {
        const v = 110 + Math.floor(r() * 50); g.fillStyle = `rgb(${v},${v - 3},${v - 8})`;
        g.beginPath(); g.roundRect(x + 2, y + 2, 40, 24, 5); g.fill();
      }
    }, 1),
    roof: canvasTex(256, (g, s) => {
      g.fillStyle = '#7a3324'; g.fillRect(0, 0, s, s);
      for (let y = 0; y < s; y += 16) for (let x = (y / 16) % 2 ? -12 : 0; x < s; x += 24) {
        const v = Math.floor(r() * 30); g.fillStyle = `rgb(${150 + v},${70 + v / 2},${50})`;
        g.beginPath(); g.roundRect(x + 1, y + 1, 22, 15, [0, 0, 8, 8]); g.fill();
      }
    }, 1),
    wood: canvasTex(128, (g, s) => {
      g.fillStyle = '#6b4a2b'; g.fillRect(0, 0, s, s);
      for (let i = 0; i < 60; i++) { g.strokeStyle = r() < .5 ? '#5a3d22' : '#7a5634'; g.beginPath(); const y = r() * s; g.moveTo(0, y); g.lineTo(s, y + r() * 6 - 3); g.stroke(); }
    }, 1),
  };
}

// --------------------------------------------------------- sprites texte
function textSprite(lines, opt = {}) {
  const font = opt.font || '600 34px system-ui, sans-serif';
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = font;
  const lh = opt.lh || 42, pad = opt.pad || 14;
  const w = Math.min(900, Math.max(...lines.map(l => g.measureText(l).width)) + pad * 2);
  const h = lines.length * lh + pad * 1.4;
  c.width = Math.ceil(w); c.height = Math.ceil(h + (opt.tail ? 18 : 0));
  g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  if (opt.bg) {
    g.fillStyle = opt.bg; g.beginPath(); g.roundRect(0, 0, w, h, 16); g.fill();
    if (opt.tail) { g.beginPath(); g.moveTo(w / 2 - 12, h); g.lineTo(w / 2 + 12, h); g.lineTo(w / 2, h + 18); g.fill(); }
  }
  lines.forEach((l, i) => {
    if (opt.stroke) { g.strokeStyle = opt.stroke; g.lineWidth = 7; g.strokeText(l, w / 2, pad * 0.7 + lh * (i + 0.5)); }
    g.fillStyle = opt.color || '#fff'; g.fillText(l, w / 2, pad * 0.7 + lh * (i + 0.5));
  });
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: opt.depthTest ?? true, transparent: true, fog: false }));
  const k = (opt.scale || 0.011);
  sp.scale.set(c.width * k, c.height * k, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = opt.renderOrder || 5;
  return sp;
}
function wrap(text, max = 26) {
  const words = text.split(' '), lines = []; let cur = '';
  for (const w of words) { if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  lines.push(cur);
  return lines.slice(0, 4);
}
function disposeObj(o) {
  o.traverse(c => { if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } });
}

// ================================================================ scène
export function createScene(canvas, cfg, { onPick = null } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#87b6e0');
  scene.fog = new THREE.Fog('#87b6e0', 60, 160);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  const T = makeTextures();
  const C = toW(cfg.center.x, cfg.center.y);
  const VR = cfg.ring.rx * SC;

  // ---------------------------------------------------------- lumières
  const hemi = new THREE.HemisphereLight('#cfe6ff', '#4a5a30', 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff3dd', 2.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 150 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);
  const lantern = new THREE.PointLight('#ffcf8a', 0, 9, 1.6); // lanterne du joueur la nuit
  scene.add(lantern);
  const spot = new THREE.SpotLight('#dfe8ff', 0, 30, 0.3, 0.45, 1.2); // regard de la Petite Fille
  scene.add(spot, spot.target);
  const ajarLight = new THREE.PointLight('#ffc46b', 0, 10, 1.5); // porte entrouverte vue par les loups
  scene.add(ajarLight);

  // ------------------------------------------------------------ terrain
  const W = cfg.world.w * SC, H = cfg.world.h * SC;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W + 80, H + 80), new THREE.MeshStandardMaterial({ map: T.grass, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, 0, H / 2); ground.receiveShadow = true;
  scene.add(ground);
  const flat = (geo, mat, y, x = C.x, z = C.z) => { const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set(x, y, z); m.receiveShadow = true; scene.add(m); return m; };
  const dirtMat = new THREE.MeshStandardMaterial({ map: T.dirt, roughness: 1 });
  flat(new THREE.RingGeometry(VR - 6.2, VR - 3.4, 96), dirtMat, 0.02);            // chemin circulaire
  const SQ = 12; // rayon de la place
  flat(new THREE.CircleGeometry(SQ, 64), new THREE.MeshStandardMaterial({ map: T.cobble, roughness: .95 }), 0.04); // place
  for (let i = 0; i < 8; i++) { // allées vers la place
    const a = i * Math.PI / 4 + Math.PI / 8, len = VR - SQ - 3;
    const m = flat(new THREE.PlaneGeometry(2.4, len), dirtMat, 0.03, C.x + Math.cos(a) * (SQ + len / 2 - 1), C.z + Math.sin(a) * (SQ + len / 2 - 1));
    m.rotation.z = -a + Math.PI / 2;
  }
  // chemin vers la tanière
  const D = toW(cfg.den.x, cfg.den.y);
  {
    const a = Math.atan2(D.z - C.z, D.x - C.x), from = C.clone().add(new THREE.Vector3(Math.cos(a) * VR, 0, Math.sin(a) * VR));
    const len = from.distanceTo(D) - 6;
    const m = flat(new THREE.PlaneGeometry(2, len), dirtMat, 0.025, (from.x + D.x) / 2, (from.z + D.z) / 2);
    m.rotation.z = -a + Math.PI / 2;
  }

  // ------------------------------------------ cercle du conseil (vote)
  const stoneMat = new THREE.MeshStandardMaterial({ map: T.stone, roughness: .95 });
  const woodMat = new THREE.MeshStandardMaterial({ map: T.wood, roughness: .9 });
  const roofMatBase = new THREE.MeshStandardMaterial({ map: T.roof, roughness: .85 });
  const colliders = []; // {x,y,r} en px
  const CR = cfg.councilRadius * SC; // rayon où se tiennent les joueurs
  // dalle du conseil : anneau de pierre claire
  flat(new THREE.RingGeometry(CR - 1.1, CR + 1.1, 64), new THREE.MeshStandardMaterial({ color: '#b9ad95', roughness: .9 }), 0.05);
  flat(new THREE.RingGeometry(CR + 1.1, CR + 1.35, 64), new THREE.MeshStandardMaterial({ color: '#5d5346', roughness: .9 }), 0.055);
  // un siège de pierre derrière chaque place (une par maison)
  const seatGeo = new THREE.CylinderGeometry(.55, .65, .6, 10);
  for (const h of cfg.houses) {
    const a = Math.atan2(h.y - cfg.center.y, h.x - cfg.center.x), r = CR + 1.5;
    const st = new THREE.Mesh(seatGeo, stoneMat); st.position.set(C.x + Math.cos(a) * r, .3, C.z + Math.sin(a) * r);
    st.castShadow = true; st.receiveShadow = true; scene.add(st);
    colliders.push({ x: cfg.center.x + Math.cos(a) * r / SC, y: cfg.center.y + Math.sin(a) * r / SC, r: 14 });
  }
  // feu de camp au centre
  const fire = new THREE.Group(); fire.position.copy(C); scene.add(fire);
  {
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2, st = new THREE.Mesh(new THREE.DodecahedronGeometry(.35, 0), stoneMat);
      st.position.set(Math.cos(a) * 1.3, .2, Math.sin(a) * 1.3); st.castShadow = true; fire.add(st);
    }
    for (let i = 0; i < 5; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(.13, .15, 1.8, 6), woodMat);
      log.rotation.set(Math.PI / 2 - .5, i / 5 * Math.PI * 2, 0, 'YXZ'); log.position.y = .45; log.castShadow = true; fire.add(log);
    }
  }
  const flames = [];
  for (const [r, h, col, y] of [[.7, 1.8, '#ff6a1a', .9], [.45, 1.3, '#ffb020', 1], [.25, .8, '#fff1a0', 1]]) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: .85, fog: false }));
    f.position.y = y; fire.add(f); flames.push(f);
  }
  const fireLight = new THREE.PointLight('#ff8a3a', 0, 22, 1.4); fireLight.position.y = 2; fire.add(fireLight);
  colliders.push({ x: cfg.center.x, y: cfg.center.y, r: 40 });
  // barrière lumineuse : on ne quitte pas le cercle pendant le vote
  const barrier = new THREE.Mesh(new THREE.CylinderGeometry(CR + .8, CR + .8, 1.6, 64, 1, true),
    new THREE.MeshBasicMaterial({ color: '#ffcf6b', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, fog: false }));
  barrier.position.set(C.x, .8, C.z); scene.add(barrier);
  // marqueur rouge sous le joueur contre qui j'ai voté
  const voteMark = new THREE.Mesh(new THREE.RingGeometry(.75, 1.05, 32), new THREE.MeshBasicMaterial({ color: '#ff3b2f', transparent: true, opacity: .9, fog: false }));
  voteMark.rotation.x = -Math.PI / 2; voteMark.visible = false; scene.add(voteMark);

  // lanternes au bord de la place
  const lampBulbs = [], lampLights = [];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2 + Math.PI / 16, x = C.x + Math.cos(a) * (SQ - .6), z = C.z + Math.sin(a) * (SQ - .6);
    const post = new THREE.Mesh(new THREE.CylinderGeometry(.08, .1, 3, 8), new THREE.MeshStandardMaterial({ color: '#2a2a2a', metalness: .6, roughness: .4 }));
    post.position.set(x, 1.5, z); post.castShadow = true;
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(.35, .45, .35), new THREE.MeshStandardMaterial({ color: '#ffe0a0', emissive: '#ffb648', emissiveIntensity: 0 }));
    bulb.position.set(x, 3.1, z);
    const l = new THREE.PointLight('#ffb35a', 0, 11, 1.6); l.position.set(x, 3, z);
    scene.add(post, bulb, l); lampBulbs.push(bulb); lampLights.push(l);
    colliders.push({ x: x / SC, y: z / SC, r: 8 });
  }

  // --------------------------------------------------------------- arbres
  {
    const rand = seeded(42), pines = [], oaks = [];
    for (let i = 0; i < 700; i++) {
      const x = rand() * cfg.world.w, y = rand() * cfg.world.h;
      const dc = Math.hypot(x - cfg.center.x, y - cfg.center.y);
      if (dc < cfg.ring.rx + 230 || Math.hypot(x - cfg.den.x, y - cfg.den.y) < 240) continue;
      const da = Math.atan2(cfg.den.y - cfg.center.y, cfg.den.x - cfg.center.x), pa = Math.atan2(y - cfg.center.y, x - cfg.center.x);
      if (Math.abs(Math.atan2(Math.sin(pa - da), Math.cos(pa - da))) < 0.09 && dc < 1150) continue; // dégager le chemin de la tanière
      (rand() < .6 ? pines : oaks).push({ x, y, s: .8 + rand() * .7, r: rand() * 6.28 });
      colliders.push({ x, y, r: 16 });
    }
    // quelques arbres décoratifs entre les maisons
    for (let i = 0; i < cfg.houses.length; i++) {
      const a = -Math.PI / 2 + (i + 0.5) * 2 * Math.PI / cfg.houses.length, rr = cfg.ring.rx + 40;
      const x = cfg.center.x + Math.cos(a) * rr, y = cfg.center.y + Math.sin(a) * rr;
      oaks.push({ x, y, s: .7 + rand() * .3, r: rand() * 6.28 }); colliders.push({ x, y, r: 16 });
    }
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const inst = (geo, mat, list, y, sy = 1) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length); im.castShadow = true; im.receiveShadow = true;
      list.forEach((t, i) => { q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), t.r); m4.compose(v.set(t.x * SC, y * t.s, t.y * SC), q, sc.set(t.s, t.s * sy, t.s)); im.setMatrixAt(i, m4); });
      scene.add(im);
    };
    const trunk = new THREE.MeshStandardMaterial({ color: '#5b3d22', roughness: 1 });
    inst(new THREE.CylinderGeometry(.22, .32, 2, 6), trunk, pines, 1);
    inst(new THREE.ConeGeometry(1.8, 3.2, 7), new THREE.MeshStandardMaterial({ color: '#24502b', roughness: 1, flatShading: true }), pines, 3);
    inst(new THREE.ConeGeometry(1.3, 2.6, 7), new THREE.MeshStandardMaterial({ color: '#2c5f31', roughness: 1, flatShading: true }), pines, 4.6);
    inst(new THREE.CylinderGeometry(.25, .35, 2.4, 6), trunk, oaks, 1.2);
    inst(new THREE.IcosahedronGeometry(1.9, 0), new THREE.MeshStandardMaterial({ color: '#3d7a35', roughness: 1, flatShading: true }), oaks, 3.6);
  }

  // -------------------------------------------------------------- tanière
  {
    const rockMat = new THREE.MeshStandardMaterial({ color: '#6b655b', roughness: 1, flatShading: true });
    const rand = seeded(9);
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, r = 6.5 + rand() * 1.5;
      if (Math.abs(Math.atan2(Math.sin(a - 0.6), Math.cos(a - 0.6))) < 0.45) continue; // entrée côté village
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(1 + rand() * 1.3, 0), rockMat);
      rock.position.set(D.x + Math.cos(a) * r, .6, D.z + Math.sin(a) * r); rock.rotation.set(rand() * 3, rand() * 3, 0);
      rock.castShadow = true; scene.add(rock);
      colliders.push({ x: cfg.den.x + Math.cos(a) * r / SC, y: cfg.den.y + Math.sin(a) * r / SC, r: 26 });
    }
    const hill = new THREE.Mesh(new THREE.SphereGeometry(4.5, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), rockMat);
    hill.position.set(D.x - 2.5, 0, D.z - 3.5); hill.scale.y = .8; hill.castShadow = true; scene.add(hill);
    const cave = new THREE.Mesh(new THREE.CircleGeometry(1.8, 16, 0, Math.PI), new THREE.MeshBasicMaterial({ color: '#050505' }));
    cave.position.set(D.x - 1.2, 0.01, D.z - 0.3); cave.rotation.y = 0.6; scene.add(cave);
    flat(new THREE.CircleGeometry(7, 32), new THREE.MeshStandardMaterial({ color: '#5a5040', roughness: 1 }), 0.015, D.x, D.z);
    const bones = new THREE.Mesh(new THREE.CapsuleGeometry(.08, .7, 2, 6), new THREE.MeshStandardMaterial({ color: '#e8e0cc' }));
    bones.position.set(D.x + 1.5, .1, D.z + 1); bones.rotation.z = Math.PI / 2; scene.add(bones);
    const sign = textSprite(['🐺 Tanière'], { color: '#e8d9b8', stroke: '#000', scale: .02 });
    sign.position.set(D.x, 4.5, D.z); scene.add(sign);
    colliders.push({ x: cfg.den.x - 2.5 / SC, y: cfg.den.y - 3.5 / SC, r: 80 });
  }

  // -------------------------------------------------------------- maisons
  const ROOFS = ['#b55a3c', '#6d7a86', '#a8823e', '#8b3b2e', '#566b4a'];
  const WALLS = ['#e3d6b8', '#d8c7a4', '#efe5d0', '#cdb894'];
  const houses = cfg.houses.map((h, i) => buildHouse(h, i));
  function buildHouse(h, i) {
    const g = new THREE.Group();
    const p = toW(h.x, h.y); g.position.copy(p);
    g.rotation.y = Math.atan2(Math.cos(h.face), Math.sin(h.face)); // le +Z local regarde la place
    const w = 5.6, d = 4.6, wh = 3, t = .22;
    const wallMat = new THREE.MeshStandardMaterial({ map: T.plaster, color: WALLS[i % WALLS.length], roughness: .95 });
    const beamMat = new THREE.MeshStandardMaterial({ color: '#4a3220', roughness: .9 });
    const roofMat = roofMatBase.clone(); roofMat.color = new THREE.Color(ROOFS[i % ROOFS.length]).multiplyScalar(1.6);
    const body = new THREE.Group(); g.add(body);
    const add = (geo, mat, x, y, z, parent = body) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };
    // socle en pierre + plancher
    add(new THREE.BoxGeometry(w + .3, .4, d + .3), stoneMat, 0, .2, 0);
    add(new THREE.BoxGeometry(w - .2, .05, d - .2), woodMat, 0, .42, 0);
    // murs (façade avec ouverture de porte)
    add(new THREE.BoxGeometry(w, wh, t), wallMat, 0, .4 + wh / 2, -d / 2 + t / 2);       // arrière
    add(new THREE.BoxGeometry(t, wh, d), wallMat, -w / 2 + t / 2, .4 + wh / 2, 0);       // gauche
    add(new THREE.BoxGeometry(t, wh, d), wallMat, w / 2 - t / 2, .4 + wh / 2, 0);        // droite
    const dw = 1.2, dh = 2.1, side = (w - dw) / 2;
    add(new THREE.BoxGeometry(side, wh, t), wallMat, -(dw / 2 + side / 2), .4 + wh / 2, d / 2 - t / 2);
    add(new THREE.BoxGeometry(side, wh, t), wallMat, dw / 2 + side / 2, .4 + wh / 2, d / 2 - t / 2);
    add(new THREE.BoxGeometry(dw, wh - dh, t), wallMat, 0, .4 + dh + (wh - dh) / 2, d / 2 - t / 2);
    // colombages
    for (const x of [-w / 2, w / 2]) for (const z of [-d / 2, d / 2]) add(new THREE.BoxGeometry(.28, wh, .28), beamMat, x, .4 + wh / 2, z);
    for (const z of [-d / 2 - .01, d / 2 + .01]) add(new THREE.BoxGeometry(w + .1, .2, .1), beamMat, 0, .4 + wh - .1, z);
    add(new THREE.BoxGeometry(w + .1, .16, .1), beamMat, 0, .4 + 1.5, d / 2 + .02).scale.x = 1;
    // fenêtres (lumineuses la nuit)
    const winMat = new THREE.MeshStandardMaterial({ color: '#86a9c4', emissive: '#ffb347', emissiveIntensity: 0, roughness: .2 });
    const wins = [];
    const win = (x, z, ry) => {
      const fr = add(new THREE.BoxGeometry(1, 1, .12), beamMat, x, 2.1, z); fr.rotation.y = ry;
      const gl = add(new THREE.PlaneGeometry(.78, .78), winMat, x + Math.sin(ry) * .07, 2.1, z + Math.cos(ry) * .07); gl.rotation.y = ry; gl.castShadow = false;
      wins.push(gl);
    };
    win(-1.75, d / 2, 0); win(1.75, d / 2, 0); win(-w / 2, 0, -Math.PI / 2); win(w / 2, 0, Math.PI / 2);
    // pignons + toit
    const gable = new THREE.Shape(); gable.moveTo(-d / 2, 0); gable.lineTo(d / 2, 0); gable.lineTo(0, 2.1); gable.closePath();
    const gGeo = new THREE.ExtrudeGeometry(gable, { depth: w - .1, bevelEnabled: false });
    const gm = new THREE.Mesh(gGeo, wallMat); gm.rotation.y = Math.PI / 2; gm.position.set(-(w - .1) / 2, .4 + wh, 0); gm.castShadow = true;
    const roof = new THREE.Group(); g.add(roof); roof.add(gm);
    const slope = Math.atan2(2.1, d / 2), sl = Math.hypot(2.1, d / 2) + .55;
    for (const s of [-1, 1]) {
      const r = add(new THREE.BoxGeometry(w + .9, .2, sl), roofMat, 0, .4 + wh + 1.05 + .08, s * (d / 4 + .12), roof);
      r.rotation.x = s * slope;
    }
    add(new THREE.BoxGeometry(w + 1, .25, .3), roofMat, 0, .4 + wh + 2.15, 0, roof);
    add(new THREE.BoxGeometry(.6, 1.6, .6), stoneMat, w / 2 - 1.2, .4 + wh + 1.8, -d / 4, roof); // cheminée
    // porte (pivote sur ses gonds)
    const hinge = new THREE.Group(); hinge.position.set(-dw / 2, .4, d / 2 - t / 2); body.add(hinge);
    const doorMat = new THREE.MeshStandardMaterial({ map: T.wood, color: '#ffffff', roughness: .8 });
    const door = add(new THREE.BoxGeometry(dw, dh, .12), doorMat, dw / 2, dh / 2, 0, hinge);
    add(new THREE.SphereGeometry(.07, 8, 6), new THREE.MeshStandardMaterial({ color: '#c9a646', metalness: .8, roughness: .3 }), dw - .2, dh / 2, .1, hinge);
    // intérieur : lit, table, tapis
    add(new THREE.BoxGeometry(1.4, .45, 2.2), woodMat, -w / 2 + 1.05, .65, -d / 2 + 1.35);
    const sheet = add(new THREE.BoxGeometry(1.3, .12, 1.7), new THREE.MeshStandardMaterial({ color: '#c9d4e8' }), -w / 2 + 1.05, .93, -d / 2 + 1.6);
    add(new THREE.BoxGeometry(1, .18, .5), new THREE.MeshStandardMaterial({ color: '#f4f0e6' }), -w / 2 + 1.05, .98, -d / 2 + .55);
    add(new THREE.CylinderGeometry(.6, .6, .08, 16), woodMat, 1.3, 1.15, -.6);
    add(new THREE.CylinderGeometry(.08, .1, .7, 6), woodMat, 1.3, .77, -.6);
    const rug = new THREE.Mesh(new THREE.CircleGeometry(.9, 20), new THREE.MeshStandardMaterial({ color: '#8b2f2f' }));
    rug.rotation.x = -Math.PI / 2; rug.position.set(.3, .46, .5); body.add(rug);
    // pancarte avec le nom (mise à jour plus tard)
    const label = new THREE.Group(); label.position.set(0, .4 + wh + 2.9, 0); g.add(label);
    scene.add(g);
    colliders.push({ x: h.x, y: h.y, r: 62, house: i });
    return { g, roof, hinge, wins, winMat, doorMat, sheet, label, labelKey: '', owner: null, doorAngle: 0, doorTarget: 0, h };
  }

  // --------------------------------------------------------- personnages
  const chars = new Map(); // id -> objet
  const charGeo = {
    body: new THREE.CapsuleGeometry(.42, .7, 4, 12), head: new THREE.SphereGeometry(.36, 16, 12),
    eye: new THREE.SphereGeometry(.055, 8, 6), ear: new THREE.ConeGeometry(.13, .32, 6),
    ring: new THREE.RingGeometry(.65, .8, 32), shadow: new THREE.CircleGeometry(.5, 16),
  };
  const skinMat = new THREE.MeshStandardMaterial({ color: '#f1c9a5', roughness: .8 });
  function makeChar(e) {
    const g = new THREE.Group();
    const col = new THREE.Color(e.anon ? '#202026' : e.color);
    const bodyMat = new THREE.MeshStandardMaterial({ color: col, roughness: .7, transparent: true });
    const headMat = (e.anon ? new THREE.MeshStandardMaterial({ color: '#2a2a30', transparent: true }) : skinMat.clone());
    headMat.transparent = true;
    const eyeMat = new THREE.MeshStandardMaterial({ color: '#111', emissive: '#ff2a1a', emissiveIntensity: 0 });
    const inner = new THREE.Group(); g.add(inner);
    const body = new THREE.Mesh(charGeo.body, bodyMat); body.position.y = .85; body.castShadow = true; inner.add(body);
    const head = new THREE.Mesh(charGeo.head, headMat); head.position.y = 1.75; head.castShadow = true; inner.add(head);
    for (const s of [-1, 1]) { const ey = new THREE.Mesh(charGeo.eye, eyeMat); ey.position.set(s * .13, 1.8, .31); inner.add(ey); }
    const ears = new THREE.Group(); inner.add(ears);
    for (const s of [-1, 1]) { const ea = new THREE.Mesh(charGeo.ear, new THREE.MeshStandardMaterial({ color: e.anon ? '#202026' : '#5a4a40' })); ea.position.set(s * .22, 2.1, 0); ea.rotation.z = -s * .3; ears.add(ea); }
    const ring = new THREE.Mesh(charGeo.ring, new THREE.MeshBasicMaterial({ color: '#6cff8a', transparent: true, opacity: 0, fog: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .06; g.add(ring);
    const sh = new THREE.Mesh(charGeo.shadow, new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: .25 }));
    sh.rotation.x = -Math.PI / 2; sh.position.y = .03; g.add(sh);
    const c = { g, inner, body, head, bodyMat, headMat, eyeMat, ears, ring, sh, name: null, nameKey: '', bubble: null, bubbleKey: '',
      x: e.x, y: e.y, heading: 0, walk: 0 };
    scene.add(g);
    chars.set(e.id, c);
    return c;
  }
  function setName(c, text, color) {
    const key = text + color;
    if (c.nameKey === key) return;
    if (c.name) { c.g.remove(c.name); disposeObj(c.name); }
    c.name = textSprite([text], { color, stroke: '#000', scale: .009 }); c.name.position.y = 2.35;
    c.g.add(c.name); c.nameKey = key;
  }
  function setTag(c, text) {
    if (c.tagKey === (text || '')) return;
    if (c.tag) { c.g.remove(c.tag); disposeObj(c.tag); c.tag = null; }
    c.tagKey = text || '';
    if (text) { c.tag = textSprite([text], { bg: '#8b1d14e8', color: '#fff', font: '700 34px system-ui, sans-serif', scale: .009, renderOrder: 11 }); c.tag.position.y = 2.75; c.g.add(c.tag); }
  }
  function setBubble(c, text) {
    if (c.bubbleKey === (text || '')) return;
    if (c.bubble) { c.g.remove(c.bubble); disposeObj(c.bubble); c.bubble = null; }
    c.bubbleKey = text || '';
    if (text) { c.bubble = textSprite(wrap(text), { bg: '#fffffff2', color: '#111', font: '30px system-ui, sans-serif', lh: 36, tail: true, scale: .0085, renderOrder: 10 }); c.bubble.position.y = c.tag ? 3.3 : 2.75; c.g.add(c.bubble); }
  }

  // ring d'écoute
  const hearRing = new THREE.Mesh(new THREE.RingGeometry(cfg.hearRadius * SC - .12, cfg.hearRadius * SC, 96),
    new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .25, fog: false, depthWrite: false }));
  hearRing.rotation.x = -Math.PI / 2; hearRing.position.y = .07; scene.add(hearRing);

  // ------------------------------------------------------------- caméra
  const cam = { yaw: 0.6, pitch: 0.75, dist: 15, target: new THREE.Vector3(), curPitch: .75, curDist: 15 };
  let drag = null;
  canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, yaw: cam.yaw, pitch: cam.pitch }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    cam.yaw = drag.yaw - (e.clientX - drag.x) * 0.008;
    cam.pitch = Math.max(0.3, Math.min(1.35, drag.pitch + (e.clientY - drag.y) * 0.005));
  });
  canvas.addEventListener('pointerup', e => {
    if (drag && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6 && onPick) {
      const id = pick(e.clientX, e.clientY);
      if (id) onPick(id);
    }
    drag = null;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('wheel', e => { cam.dist = Math.max(6, Math.min(40, cam.dist * (e.deltaY > 0 ? 1.1 : 0.9))); e.preventDefault(); }, { passive: false });

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();

  // -------------------------------------------------- ambiance jour/nuit
  const AMB = {
    day:   { bg: '#87b6e0', fogN: 60, fogF: 170, hemi: .9, sun: 2.4, sunCol: '#fff3dd', lamps: 0, win: 0 },
    vote:  { bg: '#e39a64', fogN: 50, fogF: 150, hemi: .7, sun: 1.7, sunCol: '#ffb070', lamps: .6, win: .4 },
    wolf:  { bg: '#0b1426', fogN: 14, fogF: 55, hemi: .32, sun: .45, sunCol: '#8fa8ff', lamps: 1, win: 1 },
    sleep: { bg: '#020309', fogN: 2, fogF: 11, hemi: .05, sun: .0, sunCol: '#8fa8ff', lamps: 1, win: 1 },
    peek:  { bg: '#020309', fogN: 30, fogF: 75, hemi: .07, sun: .05, sunCol: '#8fa8ff', lamps: .35, win: 1 },
    ghost: { bg: '#141c33', fogN: 25, fogF: 90, hemi: .45, sun: .5, sunCol: '#9fb3ff', lamps: 1, win: 1 },
  };
  const amb = { ...AMB.day, bgC: new THREE.Color(AMB.day.bg), sunC: new THREE.Color(AMB.day.sunCol) };
  const tmpC = new THREE.Color();
  function blendAmbience(k, dt) {
    const t = AMB[k], f = Math.min(1, dt * 2.5);
    for (const key of ['fogN', 'fogF', 'hemi', 'sun', 'lamps', 'win']) amb[key] += (t[key] - amb[key]) * f;
    amb.bgC.lerp(tmpC.set(t.bg), f); amb.sunC.lerp(tmpC.set(t.sunCol), f);
    scene.background.copy(amb.bgC); scene.fog.color.copy(amb.bgC); scene.fog.near = amb.fogN; scene.fog.far = amb.fogF;
    hemi.intensity = amb.hemi; sun.intensity = amb.sun; sun.color.copy(amb.sunC);
    lampBulbs.forEach(b => { b.material.emissiveIntensity = amb.lamps * 2; });
    lampLights.forEach(l => { l.intensity = amb.lamps * 25; });
  }

  // -------------------------------------------------------------- utilitaires
  const ray = new THREE.Raycaster(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3();
  function mouseGround(clientX, clientY) {
    const v = new THREE.Vector2(clientX / window.innerWidth * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(v, camera);
    return ray.ray.intersectPlane(plane, hit) ? { x: hit.x / SC, y: hit.z / SC } : null;
  }
  // clic sur un personnage
  function pick(clientX, clientY) {
    const v = new THREE.Vector2(clientX / window.innerWidth * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    ray.setFromCamera(v, camera);
    const objs = []; for (const c of chars.values()) objs.push(c.body, c.head);
    const hits = ray.intersectObjects(objs, false);
    return hits.length ? hits[0].object.userData.pickId : null;
  }
  // déplacement avec collisions (maisons, arbres, feu) en px
  function collide(from, to) {
    let { x, y } = to;
    for (const c of colliders) {
      const dx = x - c.x, dy = y - c.y, d = Math.hypot(dx, dy);
      if (d >= c.r) continue;
      const d0 = Math.hypot(from.x - c.x, from.y - c.y);
      if (d0 < c.r && d >= d0) continue; // on sort d'une maison : autorisé
      if (d0 < c.r) return from;          // on reste coincé à l'intérieur sinon
      const k = c.r / (d || 1); x = c.x + dx * k; y = c.y + dy * k;
    }
    return { x, y };
  }

  // ================================================================ image
  function frame(dt, V) {
    // --- ambiance
    const night = V.night;
    let mood = 'day';
    if (V.phase === 'vote' || V.phase === 'hunter') mood = 'vote';
    if (night) mood = !V.alive ? 'ghost' : V.wolf ? 'wolf' : V.peek ? 'peek' : 'sleep';
    blendAmbience(mood, dt);

    const meW = toW(V.me.x, V.me.y);
    // maison où se trouve le joueur
    let inside = null;
    for (const h of houses) if (Math.hypot(V.me.x - h.h.x, V.me.y - h.h.y) < 62) inside = h;

    // --- maisons : nom, fenêtres, portes
    for (const h of houses) {
      const o = V.owners[h.h.i];
      const key = o ? `${o.name}|${o.alive}` : '';
      if (key !== h.labelKey) {
        h.labelKey = key;
        h.label.children.forEach(c => disposeObj(c)); h.label.clear();
        if (o) h.label.add(textSprite([(o.alive ? '' : '💀 ') + o.name], { bg: '#000000a8', color: o.alive ? '#fff' : '#aaa', scale: .0075 }));
        h.doorMat.color.set(o ? o.color : '#ffffff').lerp(tmpC.set('#ffffff'), .45);
      }
      const lit = o && o.alive ? amb.win : 0;
      h.winMat.emissiveIntensity = lit * 1.6;
      h.roof.visible = h !== inside;
      h.doorTarget = (V.peek && h === inside) ? -0.55 : (V.ajar && Math.hypot(V.ajar.x - h.h.x, V.ajar.y - h.h.y) < 5) ? -0.45 : 0;
      h.doorAngle += (h.doorTarget - h.doorAngle) * Math.min(1, dt * 4);
      h.hinge.rotation.y = h.doorAngle;
    }

    // --- personnages
    const seen = new Set();
    for (const e of V.entities) {
      seen.add(e.id);
      const c = chars.get(e.id) || makeChar(e);
      const dx = e.x - c.x, dy = e.y - c.y, moved = Math.hypot(dx, dy);
      c.x = e.x; c.y = e.y;
      if (moved > 0.5) { c.heading = Math.atan2(dx, dy); c.walk += moved * 0.06; }
      if (V.phase === 'vote' && e.alive && Math.hypot(e.x - cfg.center.x, e.y - cfg.center.y) < cfg.councilRadius + 30)
        c.heading = Math.atan2(cfg.center.x - e.x, cfg.center.y - e.y); // au conseil, tout le monde regarde le feu
      const cur = c.inner.rotation.y; let dh = c.heading - cur; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      c.inner.rotation.y = cur + dh * Math.min(1, dt * 10);
      const bob = moved > 0.5 ? Math.abs(Math.sin(c.walk)) * .12 : 0;
      const ghost = !e.alive;
      c.g.position.set(e.x * SC, (ghost ? .35 + Math.sin(performance.now() / 400) * .12 : 0) + bob, e.y * SC);
      const op = ghost ? .45 : 1;
      c.bodyMat.opacity = op; c.headMat.opacity = op;
      c.bodyMat.color.set(e.anon ? '#202026' : e.color);
      const wolfish = e.anon || e.role === 'loup';
      c.ears.visible = wolfish;
      c.eyeMat.emissiveIntensity = (e.anon || (e.role === 'loup' && night)) ? 3 : 0;
      c.ring.material.opacity = e.speaking ? .9 : 0;
      c.sh.visible = !ghost;
      setName(c, e.anon ? '?' : (ghost ? '👻 ' : '') + e.name, e.isMe ? '#ffe680' : '#ffffff');
      setTag(c, e.votes ? `🗳️ ${e.votes}` : '');
      setBubble(c, e.bubble);
      c.body.userData.pickId = c.head.userData.pickId = e.id;
    }
    // vote : marqueur sous ma cible, barrière du cercle
    const tgtC = V.myVote && chars.get(V.myVote);
    voteMark.visible = !!tgtC;
    if (tgtC) voteMark.position.set(tgtC.g.position.x, .09, tgtC.g.position.z);
    const voting = V.phase === 'vote';
    barrier.material.opacity += ((voting ? .18 + Math.sin(performance.now() / 300) * .05 : 0) - barrier.material.opacity) * Math.min(1, dt * 3);
    barrier.visible = barrier.material.opacity > .01;
    // feu : vif pendant le vote et la nuit, braises le jour
    const fireOn = voting || night || V.phase === 'hunter' ? 1 : .25, tt = performance.now() / 1000;
    flames.forEach((f, i) => { const k = fireOn * (1 + Math.sin(tt * (7 + i * 3) + i) * .12); f.scale.set(k, k * (1 + Math.sin(tt * 11 + i) * .1), k); });
    fireLight.intensity = fireOn * 60 * (1 + Math.sin(tt * 13) * .1);
    for (const [id, c] of chars) if (!seen.has(id)) { scene.remove(c.g); disposeObj(c.g); chars.delete(id); }

    // --- anneau d'écoute
    hearRing.visible = V.showRing;
    hearRing.position.set(meW.x, .07, meW.z);

    // --- lumières locales
    lantern.position.set(meW.x, 2.4, meW.z);
    lantern.intensity = night ? (V.wolf ? 6 : 14) : 0;
    if (V.peek && inside) {
      const f = inside.h.face, door = toW(inside.h.x + Math.cos(f) * 50, inside.h.y + Math.sin(f) * 50);
      spot.position.set(door.x, 1.6, door.z);
      spot.target.position.set(door.x + Math.cos(V.peek.angle) * 20, 0, door.z + Math.sin(V.peek.angle) * 20);
      spot.angle = V.peek.half; spot.distance = V.peek.range * SC * 1.1; spot.decay = 1; spot.penumbra = .25; spot.intensity = 900;
    } else spot.intensity = 0;
    if (V.ajar) {
      const h = cfg.houses.find(h => Math.hypot(V.ajar.x - h.x, V.ajar.y - h.y) < 5) || V.ajar;
      const f = h.face ?? 0, p = toW(h.x + Math.cos(f) * 70, h.y + Math.sin(f) * 70);
      ajarLight.position.set(p.x, 1.2, p.z); ajarLight.intensity = 30;
    } else ajarLight.intensity = 0;

    // --- caméra
    let wantPitch = cam.pitch, wantDist = cam.dist;
    const tgt = meW.clone();
    if (V.phase === 'vote' && V.alive) { // au conseil : vue d'ensemble du cercle
      wantPitch = Math.max(cam.pitch, .85); wantDist = Math.max(cam.dist, 17);
      tgt.lerp(C, .45);
    }
    if (inside && night && V.alive && !V.wolf) { // dans sa maison la nuit : vue plongeante
      wantPitch = V.peek ? 1.1 : 1.25; wantDist = V.peek ? 26 : 12;
      if (V.peek) tgt.add(new THREE.Vector3(Math.cos(V.peek.angle) * 10, 0, Math.sin(V.peek.angle) * 10));
    }
    cam.curPitch += (wantPitch - cam.curPitch) * Math.min(1, dt * 4);
    cam.curDist += (wantDist - cam.curDist) * Math.min(1, dt * 4);
    cam.target.lerp(tgt, Math.min(1, dt * 8));
    const cp = Math.cos(cam.curPitch);
    camera.position.set(cam.target.x + Math.sin(cam.yaw) * cam.curDist * cp, 1.2 + Math.sin(cam.curPitch) * cam.curDist, cam.target.z + Math.cos(cam.yaw) * cam.curDist * cp);
    camera.lookAt(cam.target.x, 1.2, cam.target.z);

    // ombre du soleil autour du joueur
    sun.position.set(meW.x + 25, 45, meW.z + 15); sun.target.position.copy(meW);

    // --- niveau de parole
    renderer.render(scene, camera);
  }

  // place la caméra côté place du village, face à la maison la plus proche
  function faceHouseFrom(x, y) {
    let best = null, bd = 1e9;
    for (const h of cfg.houses) { const d = Math.hypot(x - h.x, y - h.y); if (d < bd) { bd = d; best = h; } }
    if (best && bd < 160) cam.yaw = Math.atan2(Math.cos(best.face), Math.sin(best.face));
  }
  // au conseil : caméra derrière le joueur, tournée vers le feu
  function faceCenterFrom(x, y) { cam.yaw = Math.atan2(x - cfg.center.x, y - cfg.center.y); }
  return { frame, mouseGround, collide, faceHouseFrom, faceCenterFrom, get yaw() { return cam.yaw; }, houses: cfg.houses };
}
