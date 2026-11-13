// Enemies: doodle humanoids (asdf-style stick figures with faces), flyers, bombers, shield bearers and a boss.
import * as THREE from 'three';
import { makeInkMaterial, setFill, INK } from './render.js';
import { makeBody, SEE_THROUGH } from './physics.js';
import { rand, randInt, clamp, damp, wrapAngle, angleLerp, choose, alignYAxis, TAU } from './util.js';
import { audio } from './audio.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0), _eye = new THREE.Vector3(), _goal = new THREE.Vector3();
const nxOf = (dx, d) => dx / (d || 1), nzOf = (dz, d) => dz / (d || 1);

export const BOSSES = ['boss', 'eraser', 'inkblot'];
export const STATE_CODES = { spawn: 0, hunt: 1, stunned: 2, dead: 3 }; export const STATE_NAMES = ['spawn', 'hunt', 'stunned', 'dead'];
export const TYPES = {
  grunt: { hp: 100, speed: 5.2, weapon: 'rifle', range: 28, stop: 16, keep: 7, burst: 3, burstInt: 0.15, cool: [1.6, 2.6], dmg: 6, spread: 0.055, pspeed: 36, score: 100, scale: 1.0, name: 'GRUNT', hat: 'cap', build: { bodyW: 1, headS: 1, limbR: 0.032 } },
  rusher: { hp: 70, speed: 7.6, weapon: 'blade', lunge: 2.9, reach: 3.0, standoff: 1.9, cool: [1.0, 1.5], dmg: 15, score: 120, scale: 0.95, name: 'RUSHER', hat: 'band', build: { bodyW: 0.82, headS: 0.95, limbR: 0.027 } },
  heavy: { hp: 320, speed: 3.0, weapon: 'shotgun', range: 18, stop: 9, keep: 5, pellets: 7, cool: [2.4, 3.2], dmg: 5, spread: 0.13, pspeed: 32, score: 260, scale: 1.25, name: 'HEAVY', hat: 'helmet', build: { bodyW: 1.55, headS: 0.88, limbR: 0.05 } },
  sniper: { hp: 60, speed: 3.6, weapon: 'sniper', range: 90, stop: 90, keep: 15, aimTime: 1.7, cool: [2.8, 3.8], dmg: 22, spread: 0.006, pspeed: 95, score: 180, scale: 1.05, name: 'SNIPER', stationary: true, hat: 'hood', build: { bodyW: 0.78, headS: 0.92, limbR: 0.026 } },
  shield: { hp: 150, speed: 3.8, weapon: 'pistol', range: 20, stop: 8, keep: 4, burst: 2, burstInt: 0.2, cool: [1.8, 2.6], dmg: 5, spread: 0.06, pspeed: 34, score: 200, scale: 1.05, name: 'SHIELDBEARER', hat: 'helmet', shield: true, build: { bodyW: 1.2, headS: 0.9, limbR: 0.042 } },
  bomber: { hp: 26, speed: 6.5, weapon: 'bomb', fuseRange: 3.4, fuse: 1.05, blast: 4.2, dmg: 24, score: 150, scale: 0.9, name: 'INK BOMB', ink: INK.BLACK, model: 'bomber' },
  flyer: { hp: 40, speed: 6.2, weapon: 'dive', dmg: 10, cool: [2.8, 4.2], score: 140, scale: 1.5, name: 'PAPER WASP', flying: true, model: 'flyer' },
  boss: { hp: 2600, speed: 3.2, weapon: 'boss', bossKind: 'doodler', range: 32, stop: 6, keep: 0, cool: [2.6, 3.6], dmg: 22, score: 2500, scale: 2.7, name: 'THE DOODLER', boss: true, ink: INK.BLACK, hat: 'crown', build: { bodyW: 1.35, headS: 1.15, limbR: 0.06 } },
  eraser: { hp: 3400, speed: 4.2, weapon: 'boss', bossKind: 'eraser', range: 30, stop: 8, keep: 0, cool: [2.2, 3.2], dmg: 26, score: 3200, scale: 2.6, name: 'THE ERASER', boss: true, ink: INK.PINK, model: 'blob', build: {} },
  inkblot: { hp: 3000, speed: 3.0, weapon: 'boss', bossKind: 'inkblot', range: 34, stop: 10, keep: 0, cool: [2.4, 3.4], dmg: 20, score: 3600, scale: 2.4, name: 'THE INKBLOT', boss: true, ink: INK.BLACK, model: 'blob', build: {} },
};

// ---------------- doodle model kit ----------------
// Everything below is drawn as pen strokes: limbs are slightly bowed tubes, bodies are
// flattened ovals and none of it is hatched, so enemies read as ink drawings on the page
// rather than as shaded 3D primitives.
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
function bx(w, h, d, x, y, z, mat, parent) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); parent.add(m); return m; }
function sph(r, x, y, z, mat, parent, seg = 8) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)), mat); m.position.set(x, y, z); parent.add(m); return m; }
// a flattened oval "drawn" body part
function blob(rx, ry, rz, x, y, z, mat, parent) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), mat); m.scale.set(rx, ry, rz); m.position.set(x, y, z); parent.add(m); return m; }
// a limb: one slightly bowed stroke hanging from its pivot, with a marker at its middle for hit tests
function noodle(len, r, mat, parent, x, y, z, bow = 0.05) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g);
  const c = new THREE.QuadraticBezierCurve3(V3(0, 0, 0), V3(rand(-bow, bow), -len * 0.5, rand(-bow, bow) + bow * 0.6), V3(0, -len, 0));
  g.add(new THREE.Mesh(new THREE.TubeGeometry(c, 5, r, 6, false), mat));
  const mid = new THREE.Object3D(); mid.position.y = -len * 0.55; g.add(mid);
  g.userData.mid = mid; g.userData.len = len; return g;
}
function mitten(r, mat, parent, y) { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 7, 5), mat); m.position.y = y; m.scale.set(1, 1.15, 0.8); parent.add(m); return m; }
function shoe(mat, parent, y, s = 1) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.1 * s, 7, 5), mat); m.position.set(0, y, 0.06 * s); m.scale.set(1, 0.62, 1.9); parent.add(m); return m; }
// dot eyes, angry brows and a curved mouth, all solid ink so they read at a glance
function doodleFace(headG, solid, opts = {}) {
  const eyes = new THREE.Group(); headG.add(eyes);
  const ex = opts.ex ?? 0.1, ey = opts.ey ?? 0.03, ez = opts.ez ?? 0.25, er = opts.er ?? 0.045;
  for (const sx of [-1, 1]) {
    const e = sph(er, sx * ex, ey, ez, solid, eyes, 6); e.scale.set(0.85, 1.15, 0.7);
    const b = bx(0.115, 0.026, 0.026, sx * ex, ey + 0.11, ez - 0.01, solid, eyes); b.rotation.z = sx * -0.5;
  }
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.085, 0.018, 4, 9, Math.PI * 0.9), solid);
  mouth.position.set(0, ey - 0.16, ez - 0.02); mouth.rotation.z = opts.smile ? Math.PI : 0; eyes.add(mouth);
  const xeyes = new THREE.Group(); headG.add(xeyes); xeyes.visible = false;
  for (const sx of [-1, 1]) for (const a of [0.8, -0.8]) { const c = bx(0.13, 0.024, 0.024, sx * ex, ey, ez, solid, xeyes); c.rotation.z = a; }
  const o = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 4, 9), solid); o.position.set(0, ey - 0.17, ez - 0.02); xeyes.add(o);
  return { eyes, xeyes };
}
function buildHat(headG, mat, solid, T) {
  const h = T.hat;
  if (h === 'cap') { const c = new THREE.Mesh(new THREE.SphereGeometry(0.29, 10, 5, 0, TAU, 0, Math.PI * 0.5), mat); c.position.y = 0.05; c.scale.y = 0.62; headG.add(c); const brim = bx(0.34, 0.035, 0.24, 0, 0.05, 0.24, mat, headG); brim.rotation.x = -0.18; }
  else if (h === 'band') { const b = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.028, 5, 14), solid); b.rotation.x = Math.PI / 2; b.position.y = 0.11; headG.add(b); for (const [dx, dz, a] of [[0.24, -0.22, 0.5], [0.2, -0.3, -0.3]]) { const t = bx(0.04, 0.03, 0.4, dx, 0.08 - dz * 0.2, -0.26, solid, headG); t.rotation.y = a; } for (let i = 0; i < 4; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.055, 0.2, 4), mat); sp.position.set(-0.12 + i * 0.08, 0.28, 0.02); sp.rotation.z = (i - 1.5) * 0.35; headG.add(sp); } }
  else if (h === 'helmet') { const c = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 6, 0, TAU, 0, Math.PI * 0.55), mat); c.position.y = 0.0; c.scale.y = 0.85; headG.add(c); const rim = new THREE.Mesh(new THREE.TorusGeometry(0.315, 0.03, 4, 14), mat); rim.rotation.x = Math.PI / 2; rim.position.y = -0.02; headG.add(rim); }
  else if (h === 'hood') { const c = new THREE.Mesh(new THREE.SphereGeometry(0.33, 10, 7, 0, TAU, 0, Math.PI * 0.62), mat); c.position.y = -0.02; c.scale.set(1.03, 1.15, 0.95); headG.add(c); const tail = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 5), mat); tail.position.set(0, 0.16, -0.3); tail.rotation.x = 1.5; headG.add(tail); }
  else if (h === 'crown') { for (let i = 0; i < 6; i++) { const a = (i / 6) * TAU; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.26, 4), mat); sp.position.set(Math.cos(a) * 0.22, 0.34, Math.sin(a) * 0.22); headG.add(sp); } const b = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 4, 14), mat); b.rotation.x = Math.PI / 2; b.position.y = 0.24; headG.add(b); }
}
export function buildWeaponProp(gun, mat, solid, T) {
  if (T.weapon === 'blade') { bx(0.02, 0.05, 0.95, 0, 0.04, 0.42, mat, gun); bx(0.11, 0.11, 0.03, 0, 0.04, -0.06, solid, gun); bx(0.035, 0.045, 0.24, 0, 0.04, -0.19, solid, gun); }
  else if (T.weapon === 'shotgun') { bx(0.1, 0.13, 0.66, 0, 0.02, 0.2, mat, gun); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.5, 6), solid); b.rotation.x = Math.PI / 2; b.position.set(0, 0.08, 0.5); gun.add(b); }
  else if (T.weapon === 'sniper') { bx(0.075, 0.11, 0.6, 0, 0.02, 0.15, mat, gun); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 6), solid); b.rotation.x = Math.PI / 2; b.position.set(0, 0.05, 0.72); gun.add(b); bx(0.06, 0.07, 0.22, 0, 0.13, 0.06, solid, gun); }
  else if (T.weapon === 'pistol') { bx(0.055, 0.09, 0.3, 0, 0.03, 0.13, mat, gun); bx(0.045, 0.11, 0.055, 0, -0.05, 0, solid, gun); }
  else if (T.weapon === 'boss') { const pen = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 2.4, 7), makeInkMaterial({ ink: INK.ORANGE, shadeScale: 0, shadeBias: 1 })); pen.position.y = 0.7; gun.add(pen); const tip = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.38, 6), solid); tip.position.y = 2.08; gun.add(tip); const er = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.26, 8), makeInkMaterial({ ink: INK.PINK, shadeScale: 0, shadeBias: 1 })); er.position.y = -0.62; gun.add(er); }
  else { bx(0.085, 0.12, 0.5, 0, 0.02, 0.16, mat, gun); const b = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.34, 6), solid); b.rotation.x = Math.PI / 2; b.position.set(0, 0.05, 0.52); gun.add(b); bx(0.05, 0.16, 0.09, 0, -0.09, 0.08, mat, gun); }
}

export function buildHumanoid(mat, solid, T) {
  const root = new THREE.Group(); const parts = {}, J = {};
  const build = T.build || {};
  const bodyW = build.bodyW ?? 1, headS = build.headS ?? 1, limbR = build.limbR ?? 0.032;
  const jit = rand(0.95, 1.06); // every figure is drawn slightly differently
  const hips = new THREE.Group(); hips.position.y = 0.86; root.add(hips);
  parts.hips = new THREE.Object3D(); hips.add(parts.hips);
  const torso = new THREE.Group(); torso.position.y = 0.04; hips.add(torso);
  blob(0.3 * bodyW, 0.3, 0.19 * bodyW, 0, 0.26, 0, mat, torso);
  parts.torso = new THREE.Object3D(); parts.torso.position.y = 0.26; torso.add(parts.torso);
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.12, 6), mat); neck.position.y = 0.56; torso.add(neck);
  const headG = new THREE.Group(); headG.position.y = 0.62; torso.add(headG);
  const head = blob(0.275 * headS * jit, 0.3 * headS, 0.25 * headS, 0, 0.26, 0, mat, headG);
  parts.head = new THREE.Object3D(); parts.head.position.y = 0.26; headG.add(parts.head);
  const faceG = new THREE.Group(); faceG.position.y = 0.26; faceG.scale.setScalar(headS); headG.add(faceG);
  const fc = doodleFace(faceG, solid, { ez: 0.2 * headS + 0.06, smile: T.weapon === 'blade' });
  const hatG = new THREE.Group(); hatG.position.y = 0.26; hatG.scale.setScalar(headS); headG.add(hatG); buildHat(hatG, mat, solid, T);
  const shY = 0.46, shX = 0.26 * bodyW;
  const armL = noodle(0.3, limbR, mat, torso, -shX, shY, 0), armR = noodle(0.3, limbR, mat, torso, shX, shY, 0);
  const foreL = noodle(0.28, limbR * 0.92, mat, armL, 0, -0.3, 0), foreR = noodle(0.28, limbR * 0.92, mat, armR, 0, -0.3, 0);
  mitten(limbR * 2.3, mat, foreL, -0.3); mitten(limbR * 2.3, mat, foreR, -0.3);
  const legL = noodle(0.42, limbR * 1.15, mat, hips, -0.13 * bodyW, -0.02, 0), legR = noodle(0.42, limbR * 1.15, mat, hips, 0.13 * bodyW, -0.02, 0);
  const shinL = noodle(0.42, limbR * 1.05, mat, legL, 0, -0.42, 0), shinR = noodle(0.42, limbR * 1.05, mat, legR, 0, -0.42, 0);
  shoe(mat, shinL, -0.42, bodyW); shoe(mat, shinR, -0.42, bodyW);
  for (const [k, g] of [['armL', armL], ['armR', armR], ['foreL', foreL], ['foreR', foreR], ['legL', legL], ['legR', legR], ['shinL', shinL], ['shinR', shinR]]) parts[k] = g.userData.mid;
  const gun = new THREE.Group(); gun.position.set(0, -0.29, 0.07); foreR.add(gun); buildWeaponProp(gun, mat, solid, T);
  const tip = new THREE.Object3D(); tip.position.set(0, 0.05, T.weapon === 'blade' ? 0.92 : T.weapon === 'boss' ? 0.4 : 0.78); gun.add(tip);
  let shieldG = null;
  if (T.shield) {
    shieldG = new THREE.Group(); shieldG.position.set(-0.17, 0.34, 0.46); torso.add(shieldG);
    const plate = bx(0.92, 1.3, 0.07, 0, 0, 0, mat, shieldG);
    bx(0.62, 0.06, 0.09, 0, 0.26, 0.04, solid, shieldG); bx(0.06, 0.62, 0.09, 0, 0.26, 0.04, solid, shieldG);
    parts.shield = new THREE.Object3D(); shieldG.add(parts.shield);
  }
  Object.assign(J, { hips, torso, headG, armL, armR, foreL, foreR, legL, legR, shinL, shinR, gun, shieldG });
  const hit = [['head', 0.3], ['torso', 0.33], ['hips', 0.2], ['armL', 0.11], ['armR', 0.11], ['foreL', 0.1], ['foreR', 0.1], ['legL', 0.13], ['legR', 0.13], ['shinL', 0.11], ['shinR', 0.11]];
  if (T.shield) hit.unshift(['shield', 0.66]);
  root.scale.setScalar(T.scale);
  return { root, parts, J, tip, face: fc, hit };
}
function buildBomber(mat, solid, T, boss = false) {
  const root = new THREE.Group(); const parts = {}, J = {};
  const hips = new THREE.Group(); hips.position.y = 0.5; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);
  blob(0.44, 0.44, 0.44, 0, 0.32, 0, mat, torso);
  parts.torso = new THREE.Object3D(); parts.torso.position.y = 0.32; torso.add(parts.torso); parts.head = parts.torso;
  const headG = new THREE.Group(); headG.position.y = 0.32; torso.add(headG);
  const fc = doodleFace(headG, solid, { ex: 0.13, ey: 0.1, ez: 0.38, er: 0.06 });
  let spark = null;
  if (!boss) {
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.13, 0.14, 7), mat); cap.position.y = 0.76; torso.add(cap);
    const fuse = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(V3(0, 0.8, 0), V3(0.16, 1.0, 0), V3(0.24, 1.14, 0)), 5, 0.02, 5, false), solid); torso.add(fuse);
    spark = new THREE.Mesh(new THREE.SphereGeometry(0.075, 6, 5), makeInkMaterial({ ink: INK.ORANGE, fill: true })); spark.position.set(0.24, 1.14, 0); torso.add(spark);
  } else if (T.bossKind === 'inkblot') {
    for (let i = 0; i < 9; i++) { const a = (i / 9) * TAU; const sp = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.42, 5), mat); sp.position.set(Math.cos(a) * 0.42, 0.32 + Math.sin(a * 2.3) * 0.25, Math.sin(a) * 0.42); sp.lookAt(Math.cos(a) * 3, 0.32, Math.sin(a) * 3); sp.rotateX(Math.PI / 2); torso.add(sp); }
  } else {
    // a chunky rubber block on top: the eraser wears its own head
    bx(0.7, 0.32, 0.5, 0, 0.86, 0, mat, torso); bx(0.74, 0.05, 0.54, 0, 0.7, 0, solid, torso);
  }
  const armL = noodle(0.26, 0.03, mat, torso, -0.42, 0.42, 0), armR = noodle(0.26, 0.03, mat, torso, 0.42, 0.42, 0);
  mitten(0.07, mat, armL, -0.26); mitten(0.07, mat, armR, -0.26);
  const legL = noodle(0.26, 0.035, mat, hips, -0.16, -0.06, 0), legR = noodle(0.26, 0.035, mat, hips, 0.16, -0.06, 0);
  const shinL = noodle(0.24, 0.032, mat, legL, 0, -0.26, 0), shinR = noodle(0.24, 0.032, mat, legR, 0, -0.26, 0);
  shoe(mat, shinL, -0.24, 0.9); shoe(mat, shinR, -0.24, 0.9);
  Object.assign(J, { hips, torso, headG, armL, armR, foreL: armL, foreR: armR, legL, legR, shinL, shinR, gun: new THREE.Group(), spark });
  root.scale.setScalar(T.scale);
  const tip = spark || (() => { const o = new THREE.Object3D(); o.position.set(0, 0.5, 0.5); torso.add(o); return o; })();
  return { root, parts, J, tip, face: fc, hit: [['torso', 0.5]] };
}
function buildFlyer(mat, solid, T) {
  const root = new THREE.Group(); const parts = {}, J = {};
  const body = new THREE.Group(); body.position.y = 0.6; root.add(body);
  const cone = new THREE.Mesh(new THREE.ConeGeometry(0.32, 1.25, 3), mat); cone.rotation.x = Math.PI / 2; cone.position.z = 0.08; body.add(cone);
  parts.torso = new THREE.Object3D(); body.add(parts.torso); parts.head = parts.torso;
  const wl = bx(0.86, 0.025, 0.5, -0.48, 0.04, -0.14, mat, body), wr = bx(0.86, 0.025, 0.5, 0.48, 0.04, -0.14, mat, body);
  const headG = new THREE.Group(); headG.position.set(0, -0.06, 0.3); headG.scale.setScalar(0.72); body.add(headG);
  const fc = doodleFace(headG, solid, { ex: 0.11, ey: 0.02, ez: 0.16, er: 0.05 });
  const tail = bx(0.04, 0.28, 0.3, 0, 0.14, -0.62, mat, body);
  Object.assign(J, { body, wl, wr, headG, torso: body, gun: new THREE.Group() });
  root.scale.setScalar(T.scale);
  return { root, parts, J, tip: headG, face: fc, hit: [['torso', 0.48]] };
}

class Projectiles {
  constructor(mgr) {
    this.mgr = mgr; this.list = []; this.max = 240; this.onFire = null;
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), makeInkMaterial({ ink: INK.RED, fill: true }), this.max);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.max * 3), 3);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.mesh.count = 0; mgr.ctx.scene.add(this.mesh);
  }
  fire(pos, dir, speed, dmg, owner, ink = INK.RED, thick = 0.045, blast = 0, id = null) {
    if (this.list.length >= this.max) this.list.shift();
    const p = { id: id ?? this.mgr.nextId++, pos: pos.clone(), prev: pos.clone(), vel: dir.clone().multiplyScalar(speed), dmg, owner, life: 4, deflected: false, ink, thick, origin: pos.clone(), blast };
    this.list.push(p);
    if (this.onFire && id === null) this.onFire(p);
    return p;
  }
  clear() { this.list.length = 0; this.mesh.count = 0; }
  deflectArc(origin, forward, range, cosHalf, player) {
    let n = 0;
    for (const p of this.list) { if (p.deflected) continue; _v.subVectors(p.pos, origin); const d = _v.length(); if (d > range) continue; if (d > 0.01 && _v.divideScalar(d).dot(forward) < cosHalf) continue; this._deflect(p, player, false); n++; }
    return n;
  }
  _deflect(p, player, perfect) {
    const mgr = this.mgr; p.deflected = true; p.ink = INK.BLUE; p.dmg *= perfect ? 3.5 : 2.2; p.life = 3;
    let target = null;
    if (perfect && p.owner && p.owner.alive) target = p.owner; else target = mgr.nearestVisible(player.eye, player.forward, Math.cos(0.7), 70) || (p.owner && p.owner.alive ? p.owner : null);
    const speed = p.vel.length() * 1.6; if (target) _d.subVectors(target.center, p.pos).normalize(); else _d.copy(player.forward);
    p.vel.copy(_d).multiplyScalar(speed); mgr.ctx.effects.sparks(p.pos, _d, INK.ORANGE, 10, 9); mgr.ctx.effects.strokeBurst(p.pos, INK.BLUE, 8, 4, { life: 0.2 });
  }
  _burst(p, point) { const ctx = this.mgr.ctx; ctx.effects.explosion(point, 2.5, INK.BLACK); audio.explosion(point); const P = ctx.player; const d = P.center.distanceTo(point); if (d < 3.5 && P.alive) { P.takeDamage(p.dmg * (1 - d / 3.5), point); P.knockback(_v.subVectors(P.center, point).normalize(), 6); } if (!this.mgr.mirror) this.mgr.blastEnemies(point, 3.5, p.dmg * 1.5, p.owner); }
  update(dt) {
    const mgr = this.mgr, ctx = mgr.ctx, world = ctx.world; const list = this.list; let n = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i]; p.life -= dt; if (p.life <= 0) continue;
      p.prev.copy(p.pos); if (p.blast) p.vel.y -= 9 * dt; p.pos.addScaledVector(p.vel, dt);
      _d.subVectors(p.pos, p.prev); const len = _d.length(); if (len < 1e-6) { list[n++] = p; continue; } _d.divideScalar(len);
      const hw = world.raycast(p.prev, _d, len, SEE_THROUGH);
      if (hw) { if (p.blast) this._burst(p, hw.point); else { ctx.effects.bulletImpact(hw.point, hw.normal, p.ink); if (Math.random() < 0.5) audio.bulletImpact(hw.point); } continue; }
      if (!p.deflected) {
        // every peer runs the same projectile; only the local player takes damage from it here,
        // other players just make it disappear on this screen (their own client handles them)
        let consumed = false;
        for (const P of mgr.targets()) {
          if (!P.alive) continue;
          const catchR = Math.max(p.blast ? 0.9 : 0.5, P.isLocal ? P.blockRadius : 0);
          if (!this._segHitsPlayer(p.prev, p.pos, P, catchR)) continue;
          if (P.isLocal) {
            const def = P.tryDeflect(p);
            if (def) { if (def.ret) { this._deflect(p, P, def.perfect); list[n++] = p; } else { p.deflected = true; ctx.effects.strokeBurst(p.pos, INK.RED, 5, 6, { life: 0.18, size: 0.03 }); } consumed = true; break; }
            if (this._segHitsPlayer(p.prev, p.pos, P, p.blast ? 0.9 : 0.5)) { if (p.blast) this._burst(p, p.pos); else P.takeDamage(p.dmg, p.origin); consumed = true; break; }
          } else if (this._segHitsPlayer(p.prev, p.pos, P, p.blast ? 0.9 : 0.5)) { consumed = true; break; }
        }
        if (consumed) continue;
      } else {
        const he = mgr.raycast(p.prev, _d, len);
        if (he) { if (p.blast) this._burst(p, he.point); else mgr.damage(he.enemy, p.dmg, { point: he.point, dir: _d.clone(), part: he.part, source: 'deflect', crit: he.part === 'head' }); continue; }
      }
      list[n++] = p;
    }
    list.length = n;
    for (let i = 0; i < n; i++) {
      const p = list[i]; const sp = p.vel.length(); _v.copy(p.vel).divideScalar(sp); _q.setFromUnitVectors(_up, _v);
      _s.set(p.thick, p.blast ? p.thick : clamp(sp * 0.02, 0.35, 0.9), p.thick); _m.compose(p.pos, _q, _s); this.mesh.setMatrixAt(i, _m);
      const c = this.mesh.instanceColor.array; c[i * 3] = p.ink; c[i * 3 + 1] = 1; c[i * 3 + 2] = 0;
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; this.mesh.instanceColor.needsUpdate = true;
  }
  _segHitsPlayer(a, b, P, r = 0.5) {
    const cy = P.center; _v.subVectors(b, a); const l2 = _v.lengthSq(); if (l2 < 1e-8) return false;
    for (const c of [cy, P.eye]) { const t = clamp(_v2.subVectors(c, a).dot(_v) / l2, 0, 1); _v3.copy(a).addScaledVector(_v, t); if (_v3.distanceToSquared(c) < r * r) return true; }
    _v3.copy(cy); _v3.y -= 0.55; const t = clamp(_v2.subVectors(_v3, a).dot(_v) / l2, 0, 1); _v2.copy(a).addScaledVector(_v, t); return _v2.distanceToSquared(_v3) < (r - 0.05) * (r - 0.05);
  }
}

export class EnemyManager {
  constructor(ctx) {
    this.ctx = ctx; this.enemies = []; this.alive = 0; this.projectiles = new Projectiles(this); this.onKill = null; this.onBoss = null; this._sepT = 0; this._slot = 0; this.mods = { speed: 1, damage: 1 };
    // mirror mode: this peer is a client; the host owns AI, physics and health, we only render
    this.mirror = false; this.nextId = 1; this.onClientHit = null; this.onSpawn = null; this.byId = new Map();
  }
  // Everyone an enemy may go after. Solo play is just the local player.
  targets() { return this.ctx.targets ? this.ctx.targets() : [this.ctx.player]; }
  _pickTarget(e, dt) {
    e.retargetT = (e.retargetT ?? 0) - dt;
    if (e.target && e.target.alive && e.retargetT > 0) return e.target;
    e.retargetT = 0.5; let best = null, bd = Infinity;
    for (const t of this.targets()) { if (!t.alive) continue; const d = t.body.pos.distanceToSquared(e.body.pos); if (d < bd) { bd = d; best = t; } }
    e.target = best; return best;
  }
  nearestTarget(pos) { let best = null, bd = Infinity; for (const t of this.targets()) { if (!t.alive) continue; const d = t.body.pos.distanceToSquared(pos); if (d < bd) { bd = d; best = t; } } return best; }
  clear() { for (const e of this.enemies) { this._removeLaser(e); if (!e.rootDetached) this.ctx.scene.remove(e.root); } this.enemies.length = 0; this.alive = 0; this.byId.clear(); this.projectiles.clear(); }
  spawn(type, pos, id = null) {
    const T = TYPES[type]; const ink = T.ink ?? INK.RED;
    const mat = makeInkMaterial({ ink, shadeScale: 0, shadeBias: 1 });
    const solid = makeInkMaterial({ ink: T.ink === INK.BLACK ? INK.RED : INK.BLACK, fill: true, side: THREE.DoubleSide });
    const model = T.model === 'bomber' ? buildBomber(mat, solid, T) : T.model === 'blob' ? buildBomber(mat, solid, T, true) : T.model === 'flyer' ? buildFlyer(mat, solid, T) : buildHumanoid(mat, solid, T);
    const hw = T.flying ? 0.45 : Math.min(0.33 * T.scale, 0.9);
    const e = { type, T, mat, root: model.root, parts: model.parts, J: model.J, tip: model.tip, face: model.face, hit: model.hit, hp: T.hp, maxHp: T.hp, alive: true, state: 'spawn', t: 0,
      body: makeBody(pos, hw, (T.flying ? 0.8 : 1.85) * T.scale, T.boss ? 1.2 : 0.6), center: new THREE.Vector3(), yaw: rand(0, TAU), yawT: 0, phase: rand(0, TAU), walk: 0, aimAmt: 0, flinch: 0, flashT: 0, flashOn: false,
      path: null, pathI: 0, pathT: 0, pathGoal: null, losT: 0, los: false, cool: rand(0.6, 1.4), burstLeft: 0, burstT: 0, aimT: 0, attackT: 0, attackHit: false, stunDur: 0, stuckT: 0, strafeDir: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1, 2), deadT: 0,
      appAng: (this._slot++) * 2.39996, appR: 0, appT: rand(0, 2), keepMul: rand(0.75, 1.35), backoffT: 0,
      hitSpheres: model.hit.map(() => new THREE.Vector3()), fuseT: -1, shieldHp: T.shield ? 2 : 0, flyState: 'orbit', flyT: rand(0, 3), orbitDir: Math.random() < 0.5 ? 1 : -1, bossAtk: null, rootDetached: false };
    e.id = id ?? this.nextId++; this.byId.set(e.id, e);
    e.body.alwaysStep = true; if (T.flying) e.body.noSnap = true; e.root.position.copy(pos); e.root.scale.setScalar(0.001);
    this.ctx.scene.add(e.root); this.enemies.push(e); this.alive++;
    if (this.onSpawn && !this.mirror) this.onSpawn(e);
    this.ctx.effects.strokeBurst(pos.clone().add(_v.set(0, 1, 0)), T.ink ?? INK.RED, T.boss ? 60 : 26, T.boss ? 10 : 6, { life: 0.5, size: 0.03 }); audio.spawn(pos);
    if (T.boss) { audio.bossRoar(pos); if (this.onBoss) this.onBoss(e); }
    return e;
  }
  nearestVisible(from, forward, cosHalf, maxDist) {
    let best = null, bestD = maxDist;
    for (const e of this.enemies) { if (!e.alive) continue; _v.subVectors(e.center, from); const d = _v.length(); if (d > bestD || d < 0.01) continue; if (_v.divideScalar(d).dot(forward) < cosHalf) continue; if (!this.ctx.world.hasLineOfSight(from, e.center, SEE_THROUGH)) continue; best = e; bestD = d; }
    return best;
  }
  raycast(o, d, maxDist, ignore = null) {
    let best = null;
    for (const e of this.enemies) {
      if (!e.alive || e === ignore) continue;
      for (let i = 0; i < e.hit.length; i++) {
        const c = e.hitSpheres[i], r = e.hit[i][1] * e.T.scale;
        _v.subVectors(c, o); const tca = _v.dot(d); if (tca < 0 || tca > maxDist) continue;
        const d2 = _v.lengthSq() - tca * tca; if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2); if (t < 0) continue;
        if (!best || t < best.dist) best = { enemy: e, part: e.hit[i][0], dist: t, point: new THREE.Vector3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t) };
      }
    }
    return best;
  }
  inArc(pos, dir, range, cosHalf) {
    const out = [];
    for (const e of this.enemies) { if (!e.alive) continue; _v.subVectors(e.center, pos); const d = _v.length() - (e.T.boss ? 1.2 : 0); if (d > range + 0.3) continue; if (d > 0.3 && _v.normalize().dot(dir) < cosHalf) continue; out.push({ enemy: e, dist: d }); }
    return out.sort((a, b) => a.dist - b.dist);
  }
  blastEnemies(point, radius, dmg, except) {
    for (const e of this.enemies) { if (!e.alive || e === except) continue; const d = e.center.distanceTo(point); if (d > radius) continue; _d.subVectors(e.center, point).normalize(); this.damage(e, dmg * (1 - d / radius * 0.6), { point: e.center.clone(), dir: _d.clone(), part: 'torso', source: 'blast', crit: false }); }
  }
  yank(e, target) {
    if (!e.alive) return; if (e.T.boss) { e.flinch = 1; return; }
    e.state = 'stunned'; e.t = 0; e.stunDur = 1.3; e.path = null; e.flyState = 'stunned';
    _d.subVectors(target, e.body.pos); const dist = _d.length(); _d.divideScalar(Math.max(dist, 0.01));
    e.body.vel.copy(_d).multiplyScalar(clamp(dist * 1.6, 10, 26)); e.body.vel.y = clamp(dist * 0.5, 4, 9); e.body.onGround = false;
    this.ctx.effects.blood(e.center, _d, 0.4);
  }
  damage(e, amount, info) {
    if (!e.alive) return;
    if (this.mirror) {
      // show the hit right away, let the host decide what it did
      if (info.part !== 'shield') { e.flinch = 1; e.flashT = 0.07; if (!e.flashOn) { setFill(e.mat, true); e.flashOn = true; } this.ctx.effects.blood(info.point || e.center, info.dir || _up, clamp(0.5 + amount / 70, 0.5, 2.2), { ink: e.T.ink === INK.BLACK ? INK.BLACK : INK.RED }); this.ctx.hud.hitmarker(false, info.crit); }
      if (this.onClientHit) this.onClientHit(e, amount, info);
      return;
    }
    if (info.part === 'shield') {
      this.ctx.effects.sparks(info.point, info.dir ? info.dir.clone().negate() : _up, INK.ORANGE, 8, 8); audio.shieldHit(info.point);
      if (info.source === 'katana' || info.source === 'blast') { e.shieldHp--; if (e.shieldHp <= 0) this._breakShield(e); }
      this.ctx.hud.hitmarker(false, false); return;
    }
    amount *= this.mods.damage;
    e.hp -= amount; e.flinch = 1; e.flashT = 0.07; if (!e.flashOn) { setFill(e.mat, true); e.flashOn = true; }
    const dir = info.dir || _d.set(0, 1, 0); const amt = clamp(0.5 + amount / 70, 0.5, 2.2) * (e.T.boss ? 1.6 : 1);
    this.ctx.effects.blood(info.point || e.center, dir, amt, { ink: e.T.ink === INK.BLACK ? INK.BLACK : INK.RED });
    if (info.crit) audio.headshot(e.center); else audio.hitEnemy(e.center);
    this.ctx.hud.hitmarker(e.hp <= 0, info.crit);
    if (info.source !== 'deflect') this.ctx.input.rumble(0.1, 0.3, 30);
    if (e.state === 'spawn') { e.state = 'hunt'; e.root.scale.setScalar(e.T.scale); }
    if (e.T.boss && this.onBoss) this.onBoss(e);
    if (e.hp <= 0) { this.ctx.game.hitstop(info.crit ? 0.05 : 0.025, 0.25); this.kill(e, info); }
  }
  _breakShield(e) {
    const g = e.J.shieldG; if (!g || !g.parent) return; g.updateWorldMatrix(true, false); this.ctx.scene.attach(g);
    this.ctx.effects.debris(g, g.position, new THREE.Vector3(rand(-3, 3), 4, rand(-3, 3)), new THREE.Vector3(rand(-6, 6), rand(-6, 6), rand(-6, 6)), { radius: 0.4, blood: false, life: 8 });
    e.hit = e.hit.filter((h) => h[0] !== 'shield'); e.hitSpheres = e.hit.map(() => new THREE.Vector3()); e.J.shieldG = null; audio.shieldHit(e.center); this.ctx.game.addScore(40, 'SHIELD BROKEN');
  }
  kill(e, info) {
    e.alive = false; e.state = 'dead'; e.deadT = 0; this.alive--; e.body.vel.set(0, 0, 0); this._removeLaser(e);
    const eff = this.ctx.effects, scene = this.ctx.scene; const inkC = e.T.ink === INK.BLACK ? INK.BLACK : INK.RED;
    if (e.face) { e.face.eyes.visible = false; e.face.xeyes.visible = true; }
    const dir = (info.dir || _d.set(0, 0.5, 0)).clone().normalize();
    if (e.T.weapon === 'bomb') { this._explodeBomber(e, 0.8); if (this.onKill) this.onKill(e, info, true); return; }
    audio.enemyDie(e.center);
    if (e.T.flying) {
      e.root.updateWorldMatrix(true, false); scene.attach(e.root); e.rootDetached = true;
      eff.debris(e.root, e.root.position, dir.clone().multiplyScalar(4).add(_v.set(rand(-2, 2), 1, rand(-2, 2))), new THREE.Vector3(rand(-9, 9), rand(-9, 9), rand(-9, 9)), { radius: 0.5, blood: true, life: 8 });
      eff.blood(e.center, dir, 1); if (this.onKill) this.onKill(e, info, true); return;
    }
    const over = -e.hp > e.maxHp * 0.35 || info.source === 'katana' || info.crit || info.source === 'deflect' || info.source === 'blast';
    const detach = (obj, extraVel, radius) => { if (!obj || !obj.parent) return; obj.updateWorldMatrix(true, false); scene.attach(obj); _v.copy(dir).multiplyScalar(rand(3, 7)).add(extraVel); _v.y += rand(2, 5); eff.debris(obj, obj.position, _v, new THREE.Vector3(rand(-8, 8), rand(-8, 8), rand(-8, 8)), { radius, blood: true, life: rand(7, 10) }); };
    if (over) {
      audio.gib(e.center); const J = e.J;
      if (info.crit || ((info.source === 'katana' || info.source === 'focus') && Math.random() < 0.35)) { detach(J.headG, _v2.set(rand(-2, 2), 3, rand(-2, 2)), 0.25); eff.fountain(e.parts.torso.getWorldPosition(new THREE.Vector3()).add(_v2.set(0, 0.35, 0)), _up, 0.9, inkC); }
      if (info.source === 'katana' || info.source === 'focus') {
        const r = Math.random();
        if (r < 0.4) detach(J.armR, _v2.set(rand(-3, 3), 2, rand(-3, 3)), 0.12); else if (r < 0.7) detach(J.armL, _v2.set(rand(-3, 3), 2, rand(-3, 3)), 0.12);
        else { detach(J.torso, _v2.set(rand(-2, 2), 2, rand(-2, 2)), 0.3); eff.fountain(e.parts.hips.getWorldPosition(new THREE.Vector3()), _up, 0.7, inkC); }
      } else if (info.source === 'deflect' || info.source === 'blast' || -e.hp > e.maxHp * 0.6) {
        const limbs = [J.armL, J.armR, J.legL, J.legR, J.torso]; const k = e.T.boss ? 5 : randInt(1, 2);
        for (let i = 0; i < k && limbs.length; i++) { const o = limbs.splice(randInt(0, limbs.length - 1), 1)[0]; detach(o, _v2.set(rand(-3, 3), 2, rand(-3, 3)), 0.15); }
      }
    }
    e.topple = { axis: Math.random() < 0.5 ? 'x' : 'z', sign: dir.z > 0 || Math.random() < 0.5 ? 1 : -1, t: 0 };
    eff.bloodPool(e.body.pos, rand(1.1, 1.8) * (e.T.boss ? 2.5 : 1), inkC); eff.blood(e.center, dir, 1.2, { ink: inkC });
    if (Math.random() < 0.6 && e.J.gun && e.J.gun.parent) detach(e.J.gun, _v2.set(rand(-2, 2), 2, rand(-2, 2)), 0.08);
    if (e.J.shieldG) this._breakShield(e);
    if (e.T.boss) { eff.explosion(e.center, 6, INK.BLACK); audio.explosion(e.center); if (this.onBoss) this.onBoss(e); }
    if (this.onKill) this.onKill(e, info, over);
  }
  _explodeBomber(e, scale = 1) {
    const T = e.T; const c = e.center.clone(); this.ctx.effects.explosion(c, T.blast * scale, INK.BLACK); audio.explosion(c);
    for (const P of this.targets()) { const d = P.center.distanceTo(c); if (P.alive && d < T.blast * scale) { P.takeDamage(T.dmg * this.mods.damage * Math.sqrt(1 - d / (T.blast * scale)), c); P.knockback(_v.subVectors(P.center, c).normalize(), 7); } }
    this.blastEnemies(c, T.blast * scale, 70, e);
    if (e.alive) { e.alive = false; e.state = 'dead'; this.alive--; if (this.onKill) this.onKill(e, { source: 'blast', dir: _up.clone() }, true); }
    this.ctx.scene.remove(e.root); e.rootDetached = true; e.deadT = 99;
  }
  eye(e, out) { return out.setFromMatrixPosition(e.parts.head.matrixWorld); }
  update(dt) {
    if (this.mirror) { this._updateMirror(dt); return; }
    const ctx = this.ctx, world = ctx.world;
    for (const e of this.enemies) {
      e.t += dt;
      if (!e.alive) { this._updateDead(e, dt); continue; }
      const P = this._pickTarget(e, dt) || ctx.player; const pp = P.body.pos, pc = P.center;
      if (e.flashT > 0) { e.flashT -= dt; if (e.flashT <= 0 && e.flashOn) { setFill(e.mat, false); e.flashOn = false; } }
      e.flinch = damp(e.flinch, 0, 9, dt);
      if (e.state === 'spawn') {
        const f = clamp(e.t / 0.6, 0, 1); e.root.scale.setScalar(Math.max(0.001, f * e.T.scale * (1 + Math.sin(e.t * 60) * 0.12 * (1 - f))));
        e.root.position.copy(e.body.pos); e.root.rotation.y = e.yaw; this._syncHit(e);
        if (e.t >= 0.6) { e.state = 'hunt'; e.root.scale.setScalar(e.T.scale); }
        continue;
      }
      if (e.state === 'stunned' && e.laser) this._hideLaser(e);
      if (e.T.flying) { this._thinkFlyer(e, dt, pc, P); world.moveBody(e.body, dt); }
      else {
        if (e.state === 'stunned') { if (e.t > e.stunDur) e.state = 'hunt'; }
        else if (P.alive) this._think(e, dt, pp, pc, P); else this._wander(e, dt);
        e.body.vel.y -= 24 * dt; world.moveBody(e.body, dt);
      }
      if (e.body.pos.y < -6) { this.kill(e, { source: 'fall', dir: _up.clone() }); continue; }
      e.yaw = angleLerp(e.yaw, e.yawT, 1 - Math.exp(-10 * dt));
      e.root.position.copy(e.body.pos); e.root.rotation.y = e.yaw;
      // never let a body occupy the same space as the player
      if (!e.T.flying) {
        const pr = 0.36 + e.body.halfW + 0.12;
        const ox = e.body.pos.x - pp.x, oz = e.body.pos.z - pp.z; const o2 = ox * ox + oz * oz;
        if (o2 < pr * pr && Math.abs(e.body.pos.y - pp.y) < 1.7) {
          const od = Math.sqrt(o2) || 0.0001; const push = pr - od;
          e.body.pos.x += ox / od * push; e.body.pos.z += oz / od * push;
          if (world.overlapsBody(e.body)) { e.body.pos.x -= ox / od * push; e.body.pos.z -= oz / od * push; }
        }
      }
      if (e.T.flying) this._animateFlyer(e, dt); else this._animate(e, dt, pc);
      this._syncHit(e);
    }
    this._separate(dt); this.projectiles.update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) { const e = this.enemies[i]; if (!e.alive && e.deadT > 9) { this._removeLaser(e); if (!e.rootDetached) this.ctx.scene.remove(e.root); this.enemies.splice(i, 1); } }
  }
  // --- network mirror ---
  // Compact per-enemy state the host sends every few frames; clients ease toward it.
  snapshot() {
    const out = [];
    for (const e of this.enemies) { if (!e.alive) continue; const b = e.body; out.push([e.id, +b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2), +e.yaw.toFixed(2), STATE_CODES[e.state] ?? 1, Math.round(e.hp), +e.aimAmt.toFixed(2), +e.attackT.toFixed(2), e.fuseT >= 0 ? 1 : 0, e.bossAtk ? 1 : 0]); }
    return out;
  }
  applySnapshot(arr, now) {
    for (const r of arr) {
      const e = this.byId.get(r[0]); if (!e || !e.alive) continue;
      e.snapA = e.snapB || { p: e.body.pos.clone(), yaw: e.yaw, t: now - 0.08 }; e.snapB = { p: new THREE.Vector3(r[1], r[2], r[3]), yaw: r[4], t: now };
      const st = STATE_NAMES[r[5]] || 'hunt'; if (e.state === 'spawn' && st !== 'spawn') { e.state = st; e.root.scale.setScalar(e.T.scale); } else if (e.state !== 'spawn') e.state = st;
      e.hp = r[6]; e.aimAmt = r[7]; e.attackT = r[8]; e.fuseT = r[9] ? 0.5 : -1; e.bossAtk = r[10] ? (e.bossAtk || { kind: 'stomp', t: 0.3 }) : null;
      if (e.T.boss && this.onBoss) this.onBoss(e);
    }
  }
  _updateMirror(dt) {
    const now = performance.now() / 1000, P = this.ctx.player;
    for (const e of this.enemies) {
      e.t += dt;
      if (!e.alive) { this._updateDead(e, dt); continue; }
      if (e.flashT > 0) { e.flashT -= dt; if (e.flashT <= 0 && e.flashOn) { setFill(e.mat, false); e.flashOn = false; } }
      e.flinch = damp(e.flinch, 0, 9, dt);
      if (e.state === 'spawn') { const f = clamp(e.t / 0.6, 0, 1); e.root.scale.setScalar(Math.max(0.001, f * e.T.scale * (1 + Math.sin(e.t * 60) * 0.12 * (1 - f)))); if (e.t >= 0.6) { e.state = 'hunt'; e.root.scale.setScalar(e.T.scale); } }
      if (e.snapA && e.snapB) {
        // render 100 ms behind the newest snapshot so movement stays smooth between packets
        const span = Math.max(0.02, e.snapB.t - e.snapA.t); const k = clamp((now - 0.1 - e.snapA.t) / span, 0, 1.2);
        _v.lerpVectors(e.snapA.p, e.snapB.p, k);
        e.body.vel.subVectors(_v, e.body.pos).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 30);
        e.body.pos.copy(_v); e.body.onGround = Math.abs(e.body.vel.y) < 0.5;
        e.yaw = angleLerp(e.snapA.yaw, e.snapB.yaw, k);
      }
      e.root.position.copy(e.body.pos); e.root.rotation.y = e.yaw;
      if (e.T.flying) this._animateFlyer(e, dt); else this._animate(e, dt, P.center);
      if (e.T.weapon === 'sniper' && e.laser) e.laser.visible = e.aimAmt > 0.9;
      this._syncHit(e);
    }
    this.projectiles.update(dt);
    for (let i = this.enemies.length - 1; i >= 0; i--) { const e = this.enemies[i]; if (!e.alive && e.deadT > 9) { this._removeLaser(e); if (!e.rootDetached) this.ctx.scene.remove(e.root); this.byId.delete(e.id); this.enemies.splice(i, 1); } }
  }
  // the host tells us someone died; run the gore without touching scores
  killMirror(id, info) { const e = this.byId.get(id); if (!e || !e.alive) return; const cb = this.onKill; this.onKill = null; this.kill(e, { ...info, dir: info.dir ? new THREE.Vector3().fromArray(info.dir) : _up.clone(), point: info.point ? new THREE.Vector3().fromArray(info.point) : e.center.clone() }); this.onKill = cb; }
  _syncHit(e) { e.root.updateMatrixWorld(true); for (let i = 0; i < e.hit.length; i++) e.hitSpheres[i].setFromMatrixPosition(e.parts[e.hit[i][0]].matrixWorld); e.center.setFromMatrixPosition(e.parts.torso.matrixWorld); }
  _updateDead(e, dt) {
    e.deadT += dt; const tp = e.topple; if (!tp || e.rootDetached) return;
    if (tp.t < 1) { tp.t = Math.min(1, tp.t + dt * 2.2); const a = tp.sign * (Math.PI / 2) * (1 - Math.pow(1 - tp.t, 2)); if (tp.axis === 'x') e.J.hips.parent.rotation.x = a; else e.J.hips.parent.rotation.z = a; }
    if (e.deadT > 8.3) e.root.scale.setScalar(Math.max(0.001, (9 - e.deadT) / 0.7 * e.T.scale));
    e.root.rotation.y = e.yaw;
  }
  _separate(dt) {
    this._sepT -= dt; if (this._sepT > 0) return; this._sepT = 0.05; const es = this.enemies;
    for (let i = 0; i < es.length; i++) { const a = es[i]; if (!a.alive || a.T.flying) continue;
      for (let j = i + 1; j < es.length; j++) { const b = es[j]; if (!b.alive || b.T.flying) continue;
        const dx = b.body.pos.x - a.body.pos.x, dz = b.body.pos.z - a.body.pos.z; const d2 = dx * dx + dz * dz; const rr = a.body.halfW + b.body.halfW + 0.75; if (d2 > rr * rr || d2 < 1e-6 || Math.abs(b.body.pos.y - a.body.pos.y) > 1.5) continue;
        const d = Math.sqrt(d2); const push = (rr - d) * 9; a.body.vel.x -= dx / d * push; a.body.vel.z -= dz / d * push; b.body.vel.x += dx / d * push; b.body.vel.z += dz / d * push; } }
  }
  _steer(e, dt, gx, gz, speed, accel) {
    const b = e.body; let dx = gx - b.pos.x, dz = gz - b.pos.z; const l = Math.hypot(dx, dz);
    if (l < 1e-4) { b.vel.x = damp(b.vel.x, 0, 8, dt); b.vel.z = damp(b.vel.z, 0, 8, dt); return; }
    dx /= l; dz /= l; const a = (b.onGround ? accel : accel * 0.3) * dt; speed *= this.mods.speed;
    b.vel.x += clamp(dx * speed - b.vel.x, -a, a); b.vel.z += clamp(dz * speed - b.vel.z, -a, a); e.yawT = Math.atan2(dx, dz);
  }
  _groundAhead(e, dx, dz) { _v.set(e.body.pos.x + dx * 0.9, e.body.pos.y + 0.5, e.body.pos.z + dz * 0.9); return this.ctx.world.raycast(_v, _d.set(0, -1, 0), 3.5) !== null; }
  // Each enemy heads for its own slot around the player rather than the player's exact feet,
  // so a group fans out and arrives from different sides instead of forming one conga line.
  _approachPoint(e, dt, target, out) {
    e.appT -= dt;
    if (e.appT <= 0) {
      e.appT = rand(2.5, 5); e.appAng += rand(-0.7, 0.7);   // drift, keep the slot
      const melee = e.T.weapon === 'blade' || e.T.weapon === 'bomb';
      e.appR = melee ? rand(2, 4.5) : rand(4.5, 9);
    }
    const d = Math.hypot(target.x - e.body.pos.x, target.z - e.body.pos.z);
    // hold a minimum standoff so they close in on their own side instead of stacking on one point
    let r = clamp(d * 0.55, Math.min(2, d * 0.9), e.appR);
    // while climbing to a different level the route is often a narrow ramp, and a wide offset
    // walks them straight off the side of it, so aim much closer to the actual target
    if (Math.abs(target.y - e.body.pos.y) > 1.5) r = Math.min(r, 1.1);
    return out.set(target.x + Math.cos(e.appAng) * r, target.y, target.z + Math.sin(e.appAng) * r);
  }
  _follow(e, dt, target, speed) {
    const nav = this.ctx.nav, b = e.body; e.pathT -= dt;
    target = this._approachPoint(e, dt, target, _goal);
    const stale = !e.path || e.pathI >= e.path.length || (e.pathT <= 0 && (!e.pathGoal || e.pathGoal.distanceTo(target) > 3.5 || !e.path.complete));
    if (stale && (e.pathT <= 0 || !e.path)) {
      e.pathT = 0.8 + rand(0, 0.6); const p = nav.findPath(b.pos, target);
      if (p && p.length) { e.path = p; e.pathI = 0; e.pathGoal = target.clone(); while (e.pathI < p.length - 1 && Math.hypot(p[e.pathI].x - b.pos.x, p[e.pathI].z - b.pos.z) < 0.7 && Math.abs(p[e.pathI].y - b.pos.y) < 1) e.pathI++; }
    }
    let goal = null;
    if (e.path && e.pathI < e.path.length) { const nd = e.path[e.pathI]; const hd = Math.hypot(nd.x - b.pos.x, nd.z - b.pos.z); if (hd < 0.5 && Math.abs(nd.y - b.pos.y) < 1.2) { e.pathI++; if (e.pathI < e.path.length) goal = e.path[e.pathI]; } else goal = nd; }
    if (!goal) goal = target;
    this._steer(e, dt, goal.x, goal.z, speed, 40);
    const hd = Math.hypot(goal.x - b.pos.x, goal.z - b.pos.z);
    if (b.onGround) {
      if (goal.y > b.pos.y + 0.6 && hd < 1.7) { b.vel.y = 9; b.onGround = false; }
      else if (b.hitWall) { e.stuckT += dt; if (e.stuckT > 0.35 && e.stuckT < 0.4) e.pathT = 0; if (e.stuckT > 0.9) { b.vel.y = 9; b.onGround = false; e.stuckT = 0; e.pathT = 0; } }
      else e.stuckT = 0;
    }
  }
  _wander(e, dt) { e.body.vel.x = damp(e.body.vel.x, 0, 6, dt); e.body.vel.z = damp(e.body.vel.z, 0, 6, dt); e.aimAmt = damp(e.aimAmt, 0, 5, dt); }
  _think(e, dt, pp, pc, P) {
    const T = e.T, b = e.body, ctx = this.ctx;
    const dx = pp.x - b.pos.x, dz = pp.z - b.pos.z; const dist = Math.hypot(dx, dz); const dy = pp.y - b.pos.y;
    e.losT -= dt; if (e.losT <= 0) { e.losT = 0.12 + rand(0, 0.1); e.los = ctx.world.hasLineOfSight(this.eye(e, _eye), pc, SEE_THROUGH); }
    e.cool -= dt; const yawTo = Math.atan2(dx, dz);
    if (T.weapon === 'bomb') {
      if (e.fuseT >= 0) { e.fuseT -= dt; b.vel.x = damp(b.vel.x, 0, 4, dt); b.vel.z = damp(b.vel.z, 0, 4, dt); e.yawT = yawTo; e.flashT = 0.02; if (!e.flashOn) { setFill(e.mat, true); e.flashOn = true; } if (Math.floor(e.fuseT * 8) !== Math.floor((e.fuseT + dt) * 8)) audio.fuse(e.center); if (e.fuseT <= 0) this._explodeBomber(e); return; }
      if (dist < T.fuseRange && Math.abs(dy) < 2.2 && e.los) { e.fuseT = T.fuse; audio.fuse(e.center); return; }
      if (e.los && dist < 12 && Math.abs(dy) < 1.5) this._steer(e, dt, pp.x, pp.z, T.speed, 45); else this._follow(e, dt, pp, T.speed);
      return;
    }
    if (T.weapon === 'blade') {
      e.aimAmt = damp(e.aimAmt, 0, 8, dt);
      // back off after a swing instead of walking into the player
      if (e.backoffT > 0) {
        e.backoffT -= dt; e.yawT = yawTo;
        const a = 26 * dt;
        b.vel.x += clamp(-nxOf(dx, dist) * T.speed * 0.55 - b.vel.x, -a, a);
        b.vel.z += clamp(-nzOf(dz, dist) * T.speed * 0.55 - b.vel.z, -a, a);
        return;
      }
      if (e.attackT > 0) {
        e.attackT -= dt; b.vel.x = damp(b.vel.x, 0, 8, dt); b.vel.z = damp(b.vel.z, 0, 8, dt); e.yawT = yawTo;
        if (e.attackT < 0.18 && !e.attackHit) {
          e.attackHit = true;
          // draw the arc of the swing so there is something to read and react to
          _v3.setFromMatrixPosition(e.tip.matrixWorld);
          for (let i = 0; i < 5; i++) {
            const a0 = -0.9 + i * 0.45, a1 = a0 + 0.45;
            _v.set(e.center.x + Math.sin(e.yaw + a0) * 1.5, e.center.y + 0.5 - i * 0.18, e.center.z + Math.cos(e.yaw + a0) * 1.5);
            _v2.set(e.center.x + Math.sin(e.yaw + a1) * 1.5, e.center.y + 0.5 - (i + 1) * 0.18, e.center.z + Math.cos(e.yaw + a1) * 1.5);
            ctx.effects.tracer(_v, _v2, INK.RED, 0.025, 0.16);
          }
          if (dist < T.reach && Math.abs(dy) < 1.7) {
            if (P.tryBlockMelee(e)) { e.state = 'stunned'; e.t = 0; e.stunDur = 1.1; b.vel.set(-dx / dist * 7, 3.5, -dz / dist * 7); }
            else P.takeDamage(T.dmg * this.mods.damage, e.center);
          } else audio.katanaSwing();
          e.cool = rand(T.cool[0], T.cool[1]); e.backoffT = rand(0.45, 0.75);
        }
        return;
      }
      // wind up from just outside arm's length, with a clear telegraph before the swing lands
      if (dist < T.lunge && Math.abs(dy) < 1.7 && e.cool <= 0 && e.los) {
        e.attackT = 0.55; e.attackHit = false; audio.lunge(e.center);
        b.vel.x += (dx / dist) * 2.5; b.vel.z += (dz / dist) * 2.5;
        return;
      }
      // hold at swinging distance rather than trying to stand inside the player
      if (e.los && dist < 9 && Math.abs(dy) < 1.6) {
        if (dist < T.standoff && Math.abs(dy) < 1.2) {
          const a = 24 * dt;
          b.vel.x += clamp(-(dx / dist) * T.speed * 0.4 - b.vel.x, -a, a);
          b.vel.z += clamp(-(dz / dist) * T.speed * 0.4 - b.vel.z, -a, a);
          e.yawT = yawTo;
        } else {
          const g = dist > 4.5 ? this._approachPoint(e, dt, pp, _goal) : pp;
          this._steer(e, dt, g.x, g.z, T.speed, 45);
          if (b.onGround && b.hitWall) { e.stuckT += dt; if (e.stuckT > 0.25) { b.vel.y = 9; e.stuckT = 0; } }
        }
      } else this._follow(e, dt, pp, T.speed);
      return;
    }
    if (T.weapon === 'boss') { this._thinkBoss(e, dt, pp, pc, dist, dy, yawTo, P); return; }
    const inRange = e.los && dist < T.range;
    if (inRange) {
      e.aimAmt = damp(e.aimAmt, 1, 8, dt); e.yawT = yawTo;
      let mx = 0, mz = 0; const nx = dx / dist, nz = dz / dist;
      if (T.stationary) { mx = 0; mz = 0; }
      else if (dist > T.stop * e.keepMul) { this._follow(e, dt, pp, T.speed * 0.8); this._shoot(e, dt, pc, P); e.yawT = yawTo; return; }
      // if the player is up on something, keep working the route up rather than strafing along
      // a ramp edge and falling off it; they still shoot on the way
      else if (Math.abs(dy) > 1.2) { this._follow(e, dt, pp, T.speed * 0.85); this._shoot(e, dt, pc); e.yawT = yawTo; return; }
      else if (dist < T.keep * e.keepMul) { mx = -nx; mz = -nz; }
      else if (dist > T.range * 0.7 && T.weapon === 'shotgun') { mx = nx; mz = nz; }
      else { e.strafeT -= dt; if (e.strafeT <= 0) { e.strafeT = rand(0.8, 2); e.strafeDir *= -1; } mx = -nz * e.strafeDir; mz = nx * e.strafeDir; }
      const spd = T.weapon === 'shotgun' ? T.speed : T.speed * 0.5;
      if ((mx || mz) && this._groundAhead(e, mx, mz)) { const a = 30 * dt; b.vel.x += clamp(mx * spd - b.vel.x, -a, a); b.vel.z += clamp(mz * spd - b.vel.z, -a, a); }
      else { b.vel.x = damp(b.vel.x, 0, 8, dt); b.vel.z = damp(b.vel.z, 0, 8, dt); }
      this._shoot(e, dt, pc, P);
    } else {
      e.aimAmt = damp(e.aimAmt, 0, 5, dt); e.burstLeft = 0; e.aimT = 0; e.aimPoint = null; this._hideLaser(e);
      if (T.stationary && e.t < 5) { b.vel.x = damp(b.vel.x, 0, 8, dt); b.vel.z = damp(b.vel.z, 0, 8, dt); e.yawT = yawTo; }
      else this._follow(e, dt, pp, T.speed);
      if (e.los) e.yawT = yawTo;
    }
  }
  _thinkBoss(e, dt, pp, pc, dist, dy, yawTo, P) {
    const T = e.T, b = e.body, ctx = this.ctx;
    if (T.bossKind === 'eraser') return this._thinkEraser(e, dt, pp, pc, dist, dy, yawTo, P);
    if (T.bossKind === 'inkblot') return this._thinkInkblot(e, dt, pp, pc, dist, dy, yawTo, P);
    if (e.bossAtk) {
      const a = e.bossAtk; a.t += dt; e.yawT = yawTo; b.vel.x = damp(b.vel.x, 0, 5, dt); b.vel.z = damp(b.vel.z, 0, 5, dt);
      if (a.kind === 'stomp') {
        if (a.t > 0.75 && !a.done) {
          a.done = true; audio.stomp(e.center); ctx.effects.shakeAmt += 0.9; ctx.effects.explosion(b.pos.clone().add(_v.set(0, 0.2, 0)), 7, INK.BLACK);
          for (let i = 0; i < 24; i++) { const an = i / 24 * TAU; _v.set(b.pos.x + Math.cos(an) * 3, b.pos.y + 0.3, b.pos.z + Math.sin(an) * 3); _v2.set(Math.cos(an) * 14, 2, Math.sin(an) * 14); ctx.effects._spawn('stroke', _v, _v2, { size: 0.06, life: 0.4, ink: INK.BLACK, gravity: 4, stretch: 0.06, drag: 3 }); }
          for (const t of this.targets()) { const dd = Math.hypot(t.body.pos.x - b.pos.x, t.body.pos.z - b.pos.z); if (t.alive && dd < 7.5 && t.body.pos.y < b.pos.y + 2.5) { t.takeDamage(T.dmg * this.mods.damage, e.center); t.knockback(_d.subVectors(t.center, e.center).normalize(), 9); } }
          this.blastEnemies(b.pos, 6, 60, e);
        }
        if (a.t > 1.3) { e.bossAtk = null; e.cool = rand(T.cool[0], T.cool[1]); }
      } else {
        if (a.t > 0.6 && !a.done) { a.done = true; _v.setFromMatrixPosition(e.parts.head.matrixWorld); _v.y += 1; _d.subVectors(pc, _v); const l = _d.length(); _d.divideScalar(l); _d.y += l * 0.012; _d.normalize(); this.projectiles.fire(_v, _d, 24, T.dmg * 0.9, e, INK.BLACK, 0.4, 1); audio.enemyShot(e.center); }
        if (a.t > 1.0) { e.bossAtk = null; e.cool = rand(T.cool[0] * 0.6, T.cool[1] * 0.6); }
      }
      return;
    }
    e.aimAmt = damp(e.aimAmt, e.los ? 1 : 0, 6, dt);
    if (e.cool <= 0 && e.los) { if (dist < 7 && Math.abs(dy) < 3) { e.bossAtk = { kind: 'stomp', t: 0, done: false }; audio.bossRoar(e.center); return; } if (dist < T.range) { e.bossAtk = { kind: 'throw', t: 0, done: false }; return; } }
    if (e.los && dist < 14 && Math.abs(dy) < 2) this._steer(e, dt, pp.x, pp.z, T.speed, 30); else this._follow(e, dt, pp, T.speed);
    if (e.los) e.yawT = yawTo;
  }
  // THE ERASER: a rubber brick that charges across the ground, then scrubs the page and calls
  // in bombers. It wants to be close; keep moving and it skids past you.
  _thinkEraser(e, dt, pp, pc, dist, dy, yawTo, P) {
    const T = e.T, b = e.body, ctx = this.ctx; e.aimAmt = damp(e.aimAmt, 0, 6, dt);
    if (e.bossAtk) {
      const a = e.bossAtk; a.t += dt;
      if (a.kind === 'charge') {
        if (a.t < 0.7) { e.yawT = yawTo; b.vel.x = damp(b.vel.x, 0, 8, dt); b.vel.z = damp(b.vel.z, 0, 8, dt); if (a.t > 0.55 && !a.dir) { a.dir = new THREE.Vector3(pp.x - b.pos.x, 0, pp.z - b.pos.z).normalize(); audio.bossRoar(e.center); } }
        else if (a.t < 1.9) {
          b.vel.x = a.dir.x * 17 * this.mods.speed; b.vel.z = a.dir.z * 17 * this.mods.speed;
          for (const t of this.targets()) { if (!t.alive) continue; const d = Math.hypot(t.body.pos.x - b.pos.x, t.body.pos.z - b.pos.z); if (d < 2.6 && Math.abs(t.body.pos.y - b.pos.y) < 3 && !a.hit) { a.hit = true; t.takeDamage(T.dmg * this.mods.damage, e.center); t.knockback(_d.subVectors(t.center, e.center).setY(0.2).normalize(), 13); ctx.effects.shakeAmt += 0.5; } }
          if (b.hitWall) { a.t = 1.9; ctx.effects.strokeBurst(e.center, INK.PINK, 30, 9, { life: 0.4, size: 0.05 }); audio.stomp(e.center); ctx.effects.shakeAmt += 0.6; }
          if (Math.floor(a.t * 10) !== Math.floor((a.t - dt) * 10)) ctx.effects.strokeBurst(b.pos.clone().add(_v.set(0, 0.3, 0)), INK.PINK, 4, 3, { life: 0.35, size: 0.06 });
        } else { b.vel.x = damp(b.vel.x, 0, 4, dt); b.vel.z = damp(b.vel.z, 0, 4, dt); if (a.t > 2.7) { e.bossAtk = null; e.cool = rand(T.cool[0], T.cool[1]); e.charges = (e.charges || 0) + 1; } }
      } else {
        e.yawT = yawTo; b.vel.x = damp(b.vel.x, 0, 6, dt); b.vel.z = damp(b.vel.z, 0, 6, dt);
        if (a.t > 0.9 && !a.done) {
          a.done = true; audio.stomp(e.center); ctx.effects.shakeAmt += 0.8;
          // scrubs the page clean around itself, and the rubbings get up and walk
          ctx.effects.explosion(b.pos.clone().add(_v.set(0, 0.2, 0)), 6, INK.PINK);
          const live = this.enemies.filter((x) => x.alive && x.type === 'bomber').length;
          for (let i = 0; i < 2 && live + i < 4; i++) { const an = rand(0, TAU); const sp = this.spawn('bomber', b.pos.clone().add(_v.set(Math.cos(an) * 3, 0, Math.sin(an) * 3))); sp.state = 'hunt'; sp.root.scale.setScalar(sp.T.scale); }
          for (const t of this.targets()) { const d = Math.hypot(t.body.pos.x - b.pos.x, t.body.pos.z - b.pos.z); if (t.alive && d < 6.5 && t.body.pos.y < b.pos.y + 3) { t.takeDamage(T.dmg * 0.8 * this.mods.damage, e.center); t.knockback(_d.subVectors(t.center, e.center).normalize(), 9); } }
        }
        if (a.t > 1.6) { e.bossAtk = null; e.cool = rand(T.cool[0], T.cool[1]); }
      }
      return;
    }
    if (e.cool <= 0 && e.los) { if ((e.charges || 0) % 3 === 2 && dist < 12) { e.bossAtk = { kind: 'rub', t: 0, done: false }; e.charges++; return; } if (dist < T.range && dist > 3) { e.bossAtk = { kind: 'charge', t: 0, hit: false, dir: null }; return; } }
    if (e.los && dist < 16 && Math.abs(dy) < 2) this._steer(e, dt, pp.x, pp.z, T.speed, 30); else this._follow(e, dt, pp, T.speed);
    if (e.los) e.yawT = yawTo;
  }
  // THE INKBLOT: hops around the arena, sprays fans of bursting ink, and shakes wasps loose.
  _thinkInkblot(e, dt, pp, pc, dist, dy, yawTo, P) {
    const T = e.T, b = e.body, ctx = this.ctx; e.aimAmt = damp(e.aimAmt, e.los ? 1 : 0, 6, dt);
    if (e.bossAtk) {
      const a = e.bossAtk; a.t += dt; e.yawT = yawTo; b.vel.x = damp(b.vel.x, 0, 6, dt); b.vel.z = damp(b.vel.z, 0, 6, dt);
      if (a.kind === 'spray') {
        if (a.t > 0.6 && a.shots < 9 && a.t > 0.6 + a.shots * 0.09) {
          _v.setFromMatrixPosition(e.parts.torso.matrixWorld); _v.y += 0.8;
          const base = Math.atan2(pp.x - b.pos.x, pp.z - b.pos.z); const an = base + (a.shots - 4) * 0.19;
          _d.set(Math.sin(an), 0.18 + rand(-0.05, 0.05), Math.cos(an)).normalize();
          this.projectiles.fire(_v, _d, 20, T.dmg * 0.55 * this.mods.damage, e, INK.BLACK, 0.3, 1); a.shots++; if (a.shots === 1) audio.enemyShot(e.center);
        }
        if (a.t > 1.8) { e.bossAtk = null; e.cool = rand(T.cool[0], T.cool[1]); e.sprays = (e.sprays || 0) + 1; }
      } else {
        if (a.t > 0.8 && !a.done) {
          a.done = true; audio.bossRoar(e.center); ctx.effects.strokeBurst(e.center, INK.BLACK, 40, 10, { life: 0.5, size: 0.05 });
          const live = this.enemies.filter((x) => x.alive && x.type === 'flyer').length;
          for (let i = 0; i < 3 && live + i < 6; i++) { const sp = this.spawn('flyer', e.center.clone().add(_v.set(rand(-2, 2), 2 + i, rand(-2, 2)))); sp.state = 'hunt'; sp.root.scale.setScalar(sp.T.scale); }
        }
        if (a.t > 1.4) { e.bossAtk = null; e.cool = rand(T.cool[0], T.cool[1]); }
      }
      return;
    }
    // it moves in hops: a big jump toward you every couple of seconds, a slam of ink on landing
    e.hopT = (e.hopT ?? 1) - dt;
    if (b.onGround && e.hopT <= 0 && dist > 4) { e.hopT = rand(1.6, 2.4); const nx = (pp.x - b.pos.x) / dist, nz = (pp.z - b.pos.z) / dist; b.vel.set(nx * 11, 13, nz * 11); b.onGround = false; e.hopping = true; }
    if (e.hopping && b.onGround) { e.hopping = false; audio.stomp(e.center); ctx.effects.shakeAmt += 0.4; ctx.effects.bloodPool(b.pos, 3.5, INK.BLACK); for (const t of this.targets()) { const d = Math.hypot(t.body.pos.x - b.pos.x, t.body.pos.z - b.pos.z); if (t.alive && d < 4.5 && Math.abs(t.body.pos.y - b.pos.y) < 2.5) { t.takeDamage(T.dmg * 0.7 * this.mods.damage, e.center); t.knockback(_d.subVectors(t.center, e.center).normalize(), 8); } } }
    if (e.cool <= 0 && e.los) { if ((e.sprays || 0) % 3 === 2) { e.bossAtk = { kind: 'summon', t: 0, done: false }; e.sprays++; return; } if (dist < T.range) { e.bossAtk = { kind: 'spray', t: 0, shots: 0 }; return; } }
    if (!e.hopping) { if (e.los && dist < 14 && Math.abs(dy) < 2) this._steer(e, dt, pp.x, pp.z, T.speed, 30); else this._follow(e, dt, pp, T.speed); }
    if (e.los) e.yawT = yawTo;
  }
  _thinkFlyer(e, dt, pc, P) {
    const T = e.T, b = e.body, ctx = this.ctx; e.flyT -= dt; e.cool -= dt;
    const want = _v2;
    if (e.flyState === 'stunned') { b.vel.y -= 20 * dt; if (b.onGround || e.t > 2.2) { e.flyState = 'climb'; e.flyT = 1.2; e.state = 'hunt'; } }
    else if (e.flyState === 'orbit') {
      const ang = Math.atan2(b.pos.x - pc.x, b.pos.z - pc.z) + e.orbitDir * 0.45; const rad = 11;
      want.set(pc.x + Math.sin(ang) * rad, pc.y + 6 + Math.sin(e.t * 1.3) * 1.5, pc.z + Math.cos(ang) * rad);
      this._flyTo(e, want, T.speed, 22, dt);
      if (e.cool <= 0 && P.alive && ctx.world.hasLineOfSight(e.center, pc, SEE_THROUGH)) { e.flyState = 'dive'; e.flyT = 1.6; e.diveHit = false; audio.flyerDive(e.center); }
      if (Math.random() < dt * 1.5) audio.flyerBuzz(e.center);
    } else if (e.flyState === 'dive') {
      want.copy(pc); this._flyTo(e, want, 16, 28, dt);
      const d = e.center.distanceTo(pc);
      if (d < 1.4 && !e.diveHit) { e.diveHit = true; if (P.tryBlockMelee(e)) { e.flyState = 'stunned'; e.state = 'stunned'; e.t = 0; b.vel.set(-b.vel.x * 0.3, -3, -b.vel.z * 0.3); } else if (P.alive) { P.takeDamage(T.dmg * this.mods.damage, e.center); P.knockback(_d.copy(b.vel).normalize(), 3); } }
      if (e.flyT <= 0 || e.diveHit || b.hitWall) { e.flyState = 'climb'; e.flyT = 1.1; e.cool = rand(T.cool[0], T.cool[1]); }
    } else {
      want.set(pc.x + (b.pos.x - pc.x) * 1.5, pc.y + 8, pc.z + (b.pos.z - pc.z) * 1.5); this._flyTo(e, want, T.speed, 18, dt);
      if (e.flyT <= 0) e.flyState = 'orbit';
    }
    // avoid geometry: look ahead and above the ground
    const sp = b.vel.length();
    if (sp > 0.5) { _d.copy(b.vel).divideScalar(sp); const h = ctx.world.raycast(e.center, _d, 3.5); if (h) { b.vel.addScaledVector(h.normal, 14 * dt); b.vel.y += 12 * dt; } }
    const g = ctx.world.raycast(e.center, _v3.set(0, -1, 0), 2.5); if (g) b.vel.y += 12 * dt;
    _d.copy(b.vel); if (_d.lengthSq() > 0.1) e.yawT = Math.atan2(_d.x, _d.z);
  }
  _flyTo(e, target, speed, accel, dt) { const b = e.body; _d.subVectors(target, b.pos); const l = _d.length(); if (l < 0.3) { b.vel.multiplyScalar(Math.max(0, 1 - 4 * dt)); return; } _d.divideScalar(l).multiplyScalar(speed * this.mods.speed); _v3.subVectors(_d, b.vel); const m = _v3.length(); if (m > accel * dt) _v3.multiplyScalar(accel * dt / m); b.vel.add(_v3); }
  _shoot(e, dt, pc, P) {
    const T = e.T, ctx = this.ctx; const muzzle = _v.setFromMatrixPosition(e.tip.matrixWorld);
    if (T.weapon === 'sniper') {
      if (e.cool > 0) { this._hideLaser(e); return; }
      e.aimT += dt;
      // The beam chases the player rather than being glued to them, and the shot goes exactly
      // where the beam is pointing - so if you keep moving once you see it, it misses.
      if (!e.aimPoint) { e.aimPoint = pc.clone(); }
      else e.aimPoint.lerp(pc, 1 - Math.exp(-2.6 * dt));
      this._showLaser(e, muzzle, e.aimPoint, clamp(e.aimT / T.aimTime, 0, 1));
      if (e.aimT > T.aimTime * 0.5 && !e.aimWarned) { e.aimWarned = true; audio.sniperAim(e.center); }
      if (e.aimT >= T.aimTime) {
        e.aimT = 0; e.aimWarned = false; e.cool = rand(T.cool[0], T.cool[1]);
        this._fireOne(e, muzzle, e.aimPoint, T.spread, T.pspeed, T.dmg, 0.07, P); audio.sniperShot(e.center);
        this._hideLaser(e); e.aimPoint = null;
      }
      return;
    }
    if (e.burstLeft > 0) { e.burstT -= dt; if (e.burstT <= 0) { e.burstT = T.burstInt; e.burstLeft--; this._fireOne(e, muzzle, pc, T.spread, T.pspeed, T.dmg, 0.045, P); audio.enemyShot(e.center); if (e.burstLeft === 0) e.cool = rand(T.cool[0], T.cool[1]); } return; }
    if (e.cool <= 0) {
      if (T.weapon === 'shotgun') { for (let i = 0; i < T.pellets; i++) this._fireOne(e, muzzle, pc, T.spread, T.pspeed * rand(0.85, 1.1), T.dmg, 0.05, P); audio.shotgun(e.center); e.cool = rand(T.cool[0], T.cool[1]); ctx.effects.strokeBurst(muzzle, INK.ORANGE, 8, 5, { life: 0.1, size: 0.04 }); }
      else { e.burstLeft = T.burst; e.burstT = 0; }
    }
  }
  _showLaser(e, from, to, charge) {
    if (!e.laser) {
      e.laser = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 5), makeInkMaterial({ ink: INK.RED, fill: true }));
      e.laser.frustumCulled = false; this.ctx.scene.add(e.laser);
    }
    e.laser.visible = true;
    // stop the beam short of where it is pointing, otherwise a shot aimed at your face
    // renders as a red slab filling the screen instead of a thin telegraph line
    const d = _v2.subVectors(to, from); const len = d.length();
    if (len < 2) { e.laser.visible = false; return; }
    _v3.copy(from).addScaledVector(d, 1 - 1.6 / len);
    alignYAxis(e.laser, from, _v3, 0.006 + 0.012 * charge * charge);
  }
  _hideLaser(e) { if (e.laser) e.laser.visible = false; }
  _removeLaser(e) { if (e.laser) { this.ctx.scene.remove(e.laser); e.laser.geometry.dispose(); e.laser = null; } }
  _fireOne(e, muzzle, pc, spread, speed, dmg, thick, P = this.ctx.player) { _d.subVectors(pc, muzzle); _d.y += rand(-0.2, 0.3); _d.normalize();
    const sp = spread * (1 + P.speed * 0.06); _d.x += rand(-sp, sp); _d.y += rand(-sp, sp); _d.z += rand(-sp, sp); _d.normalize();
    this.projectiles.fire(muzzle, _d, speed, dmg * this.mods.damage, e, INK.RED, thick); this.ctx.effects.strokeBurst(muzzle, INK.ORANGE, 4, 4, { life: 0.07, size: 0.03 });
  }
  _animateFlyer(e, dt) {
    const J = e.J, b = e.body; e.phase += dt * 14; const flap = Math.sin(e.phase) * 0.35;
    J.wl.rotation.z = flap; J.wr.rotation.z = -flap; const roll = clamp(-(b.vel.x * Math.cos(e.yaw) - b.vel.z * Math.sin(e.yaw)) * 0.05, -0.8, 0.8);
    J.body.rotation.z = damp(J.body.rotation.z, roll, 6, dt); J.body.rotation.x = damp(J.body.rotation.x, clamp(-b.vel.y * 0.06, -0.6, 0.6), 6, dt); J.body.position.y = 0.6 + Math.sin(e.t * 3) * 0.1;
    if (e.flyState === 'stunned') J.body.rotation.z += dt * 12;
  }
  _animate(e, dt, pc) {
    const b = e.body, J = e.J, T = e.T; const sp = Math.hypot(b.vel.x, b.vel.z);
    e.walk = damp(e.walk, clamp(sp / 4, 0, 1), 10, dt); const w = e.walk;
    e.phase += dt * (sp * 2.2 + (sp > 0.4 ? 3 : 0)); const s = Math.sin(e.phase), c = Math.cos(e.phase);
    J.legL.rotation.x = s * 0.9 * w; J.legR.rotation.x = -s * 0.9 * w; J.shinL.rotation.x = Math.max(0, c) * 1.1 * w; J.shinR.rotation.x = Math.max(0, -c) * 1.1 * w;
    if (!b.onGround) { J.legL.rotation.x = -0.5; J.legR.rotation.x = 0.6; J.shinL.rotation.x = 1.0; J.shinR.rotation.x = 0.5; }
    if (T.weapon === 'bomb' || T.model === 'blob') {
      J.armL.rotation.x = -2.4 + Math.sin(e.t * 20) * 0.4 * w; J.armR.rotation.x = -2.4 - Math.sin(e.t * 20) * 0.4 * w; J.torso.rotation.z = Math.sin(e.phase) * 0.12 * w; J.torso.rotation.x = -0.15 * w;
      if (J.spark) J.spark.scale.setScalar(0.7 + Math.random() * 0.8 + (e.fuseT >= 0 ? 1.5 : 0)); J.hips.position.y = 0.5 + Math.abs(c) * 0.08 * w;
      if (e.fuseT >= 0) { J.torso.rotation.x = Math.sin(e.t * 40) * 0.15; J.headG.rotation.y = Math.sin(e.t * 30) * 0.3; }
      return;
    }
    const aim = e.aimAmt;
    if (T.weapon === 'blade') {
      const at = e.attackT;
      const wind = at > 0.18 ? clamp((0.55 - at) / 0.37, 0, 1) : 0;      // arm goes up and back
      const strike = at > 0 && at <= 0.18 ? 1 - at / 0.18 : 0;           // then chops down
      J.armR.rotation.x = -0.8 * (1 - w) - s * 0.9 * w - wind * 2.2 + strike * 1.5;
      J.armR.rotation.z = -0.3 + wind * 0.7 - strike * 0.5;
      J.foreR.rotation.x = -0.9 - wind * 0.7 + strike * 0.5;
      J.armL.rotation.x = s * 1.1 * w - wind * 0.5; J.armL.rotation.z = 0.35 * w; J.foreL.rotation.x = -0.6 * w;
      J.torso.rotation.x = -0.3 * w + e.flinch * 0.35 - wind * 0.25 + strike * 0.55;
      J.torso.rotation.y = wind * 0.5 - strike * 0.6;
    } else if (T.weapon === 'boss') {
      const a = e.bossAtk; let raise = 0, slam = 0; if (a && a.kind === 'stomp') { raise = a.t < 0.75 ? clamp(a.t / 0.6, 0, 1) : 0; slam = a.t >= 0.75 ? 1 : 0; }
      if (a && a.kind === 'throw') { raise = a.t < 0.6 ? clamp(a.t / 0.5, 0, 1) : 0; }
      J.armR.rotation.x = -0.4 - s * 0.5 * w - raise * 2.4 + slam * 0.9; J.armR.rotation.z = -0.35; J.foreR.rotation.x = -0.6 - raise * 0.4;
      J.armL.rotation.x = s * 0.6 * w - raise * 0.8; J.armL.rotation.z = 0.35; J.foreL.rotation.x = -0.5; J.torso.rotation.x = -0.1 * w + e.flinch * 0.15 - raise * 0.3 + slam * 0.5;
    } else {
      J.armR.rotation.x = (-s * 1.0 * w) * (1 - aim) + (-1.35 + e.flinch * 0.35) * aim; J.armR.rotation.z = -0.25 * (1 - aim); J.foreR.rotation.x = -0.35 * (1 - aim) + -0.2 * aim;
      if (T.shield) { J.armL.rotation.x = -1.2; J.armL.rotation.y = 0.3; J.foreL.rotation.x = -0.9; }
      else { J.armL.rotation.x = (s * 1.0 * w) * (1 - aim) + -1.2 * aim; J.armL.rotation.y = 0.6 * aim; J.armL.rotation.z = 0.25 * (1 - aim); J.foreL.rotation.x = -0.4 * (1 - aim) + -0.5 * aim; }
      J.torso.rotation.x = -0.22 * w + e.flinch * 0.4; J.torso.rotation.y = -0.35 * aim; J.torso.rotation.z = Math.sin(e.phase) * 0.05 * w;
    }
    J.hips.position.y = 0.86 + Math.abs(c) * 0.07 * w + (b.onGround ? 0 : -0.05);
    _v.subVectors(pc, e.center); const yawTo = Math.atan2(_v.x, _v.z); J.headG.rotation.y = clamp(wrapAngle(yawTo - e.yaw) - (J.torso.rotation.y || 0), -1.1, 1.1);
    J.headG.rotation.x = clamp(-Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.6) * 0.8; J.headG.rotation.z = Math.sin(e.phase * 0.5) * 0.06 * w;
    if (e.state === 'stunned') { J.torso.rotation.x = 0.6; J.armL.rotation.x = -2.5; J.armR.rotation.x = -2.5; J.legL.rotation.x = -0.8; J.legR.rotation.x = 0.9; }
  }
}
