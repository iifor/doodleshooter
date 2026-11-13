// Level construction. Two maps share one builder: everything is merged ink geometry plus
// axis-aligned box colliders, which is what the navigation grid is generated from.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeInkMaterial, INK } from './render.js';
import { rand, choose, TAU } from './util.js';
import { buildHumanoid } from './enemies.js';

// Doodle Mexico is built and kept, but off the menu until it is ready; flip this to offer it again
export const MEXICO_READY = false;
export const LEVELS = [{ key: 'district', name: 'DOODLE DISTRICT', blurb: 'streets, rooftops and fire escapes' }, ...(MEXICO_READY ? [{ key: 'mexico', name: 'DOODLE MEXICO', blurb: 'a sun-baked plaza · piñatas, tacos and mariachi' }] : [])];

function createBuilder(scene, world) {
  const geos = {}; const L = { rings: [], spawns: [], snipers: [], pickups: [], animated: [], meshes: [], playerStart: new THREE.Vector3(0, 0, 42), bounds: { minX: -55, maxX: 55, minZ: -55, maxZ: 55 }, arenaSpawns: [], grappleMovers: [], breakables: [], key: 'district' };
  const addGeo = (g, ink) => (geos[ink] || (geos[ink] = [])).push(g);
  const collider = (x, y, z, w, h, d, o = {}) => world.addBox({ x: x - w / 2, y, z: z - d / 2 }, { x: x + w / 2, y: y + h, z: z + d / 2 }, { noNav: !!o.noNav, noShoot: !!o.noShoot, noGrapple: !!o.noGrapple, tag: o.tag });
  function box(x, y, z, w, h, d, o = {}) {
    const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y + h / 2, z); addGeo(g, o.ink ?? INK.BLUE);
    if (!o.noCollide) collider(x, y, z, w, h, d, o);
  }
  const slab = (x1, z1, x2, z2, y, t, o = {}) => box((x1 + x2) / 2, y - t, (z1 + z2) / 2, x2 - x1, t, z2 - z1, o); // top surface at y
  // Wall pieces along an axis with rectangular gaps [a1, a2, yBottom = 0, yTop = h]; gaps may overlap.
  function wallPieces(a1, a2, h, gaps) {
    const xs = new Set([a1, a2]);
    for (const g of gaps) { xs.add(Math.min(Math.max(g[0], a1), a2)); xs.add(Math.min(Math.max(g[1], a1), a2)); }
    const sorted = [...xs].sort((a, b) => a - b); const runs = new Map(); const out = [];
    for (let i = 0; i < sorted.length - 1; i++) {
      const s1 = sorted[i], s2 = sorted[i + 1]; if (s2 - s1 < 0.005) continue; const mid = (s1 + s2) / 2;
      const cuts = gaps.filter((g) => g[0] <= mid && g[1] >= mid).map((g) => [g[2] ?? 0, g[3] ?? h]).sort((a, b) => a[0] - b[0]);
      const pieces = []; let y = 0;
      for (const [gb, gt] of cuts) { if (gb > y + 0.005) pieces.push([y, gb]); y = Math.max(y, gt); }
      if (y < h - 0.005) pieces.push([y, h]);
      const keys = new Set();
      for (const [yb, yt] of pieces) { const k = yb.toFixed(3) + ',' + yt.toFixed(3); keys.add(k); const r = runs.get(k); if (r && Math.abs(r[1] - s1) < 0.005) r[1] = s2; else runs.set(k, [s1, s2, yb, yt]); }
      for (const [k, r] of [...runs]) if (!keys.has(k)) { out.push(r); runs.delete(k); }
    }
    for (const r of runs.values()) out.push(r);
    return out;
  }
  function wallX(x1, x2, z, y, h, t, gaps = [], o = {}) {
    for (const [a, b, yb, yt] of wallPieces(x1, x2, h, gaps)) box((a + b) / 2, y + yb, z, b - a, yt - yb, t, o);
  }
  function wallZ(z1, z2, x, y, h, t, gaps = [], o = {}) {
    for (const [a, b, yb, yt] of wallPieces(z1, z2, h, gaps)) box(x, y + yb, (a + b) / 2, t, yt - yb, b - a, o);
  }
  function stairs(x, y, z, dir, steps, width, o = {}) {
    const rise = o.rise ?? 4 / 14, run = o.run ?? 0.45;
    const dx = dir === '+x' ? 1 : dir === '-x' ? -1 : 0, dz = dir === '+z' ? 1 : dir === '-z' ? -1 : 0;
    for (let i = 0; i < steps; i++) {
      const c = (i + 0.5) * run, h = (i + 1) * rise; const cx = x + dx * c, cz = z + dz * c;
      box(cx, y, cz, dx ? run + 0.004 : width, h, dz ? run + 0.004 : width, o);
    }
    return { x: x + dx * steps * run, z: z + dz * steps * run, y: y + steps * rise };
  }
  // railing along an axis-aligned segment: visual posts + bar, one collider
  function rail(x1, z1, x2, z2, y, o = {}) {
    const len = Math.hypot(x2 - x1, z2 - z1); const ax = Math.abs(x2 - x1) > Math.abs(z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2;
    box(cx, y + 0.9, cz, ax ? len : 0.12, 0.12, ax ? 0.12 : len, { noCollide: true, ink: o.ink });
    const n = Math.max(1, Math.round(len / 2));
    for (let i = 0; i <= n; i++) { const t = i / n; box(x1 + (x2 - x1) * t, y, z1 + (z2 - z1) * t, 0.1, 0.9, 0.1, { noCollide: true, ink: o.ink }); }
    collider(cx, y, cz, ax ? len : 0.12, 1.0, ax ? 0.12 : len, { noNav: true, noShoot: true });
  }
  function cyl(x, y, z, r, h, o = {}) {
    const g = new THREE.CylinderGeometry(r, r, h, o.seg ?? 12); g.translate(x, y + h / 2, z); addGeo(g, o.ink ?? INK.BLUE);
    if (!o.noCollide) collider(x, y, z, r * 1.6, h, r * 1.6, o);
  }
  function sphere(x, y, z, r, o = {}) { const g = new THREE.SphereGeometry(r, o.seg ?? 10, o.seg ?? 8); g.translate(x, y, z); addGeo(g, o.ink ?? INK.BLUE); }
  function ring(x, y, z, axis = 'z') {
    const g = new THREE.TorusGeometry(0.6, 0.1, 8, 20);
    if (axis === 'x') g.rotateY(Math.PI / 2); else if (axis === 'y') g.rotateX(Math.PI / 2);
    g.translate(x, y, z); addGeo(g, INK.ORANGE);
    L.rings.push(new THREE.Vector3(x, y, z));
  }
  const spawn = (x, y, z) => L.spawns.push(new THREE.Vector3(x, y, z));
  const sniper = (x, y, z) => L.snipers.push(new THREE.Vector3(x, y, z));
  const pickup = (x, y, z) => L.pickups.push(new THREE.Vector3(x, y, z));
  // ---------------- shared finish ----------------
  function finish() {
    for (const ink in geos) {
      const merged = mergeGeometries(geos[ink], false);
      const mesh = new THREE.Mesh(merged, makeInkMaterial({ ink: Number(ink) }));
      mesh.matrixAutoUpdate = false; scene.add(mesh); L.meshes.push(mesh);
    }
    world.finalize();
    return L;
  }
  // a paper plane that loops overhead, purely decorative
  function planes(n, baseR, baseH, o = {}) {
    const sc = o.scale || 1;
    for (let i = 0; i < n; i++) {
      const g = new THREE.ConeGeometry(1.2 * sc, 4 * sc, 3); g.rotateX(Math.PI / 2);
      const m = new THREE.Mesh(g, makeInkMaterial({ ink: o.ink ?? INK.BLUE })); scene.add(m); L.meshes.push(m);
      L.grappleMovers.push({ mesh: m, radius: 2.2 * sc });
      const r = baseR + i * (o.rStep ?? 12), h = baseH + i * (o.hStep ?? 6), ph = i * 2.1, sp = (o.speed ?? 0.11) + i * 0.01;
      L.animated.push({ mesh: m, update: (t) => { const a = t * sp + ph; m.position.set(Math.cos(a) * r, h + Math.sin(a * 2.3) * 3, Math.sin(a) * r * 0.7); m.lookAt(Math.cos(a + 0.05) * r, h + Math.sin((a + 0.05) * 2.3) * 3, Math.sin(a + 0.05) * r * 0.7); m.rotateZ(Math.sin(a * 3) * 0.6); } });
    }
  }
  return { L, addGeo, collider, box, slab, wallX, wallZ, stairs, rail, cyl, sphere, ring, spawn, sniper, pickup, finish, planes, scene, world };
}

// ============================ map 1: Doodle District ============================
function buildDistrict(B, arena = false) {
  const { L, box, slab, wallX, wallZ, stairs, rail, cyl, sphere, ring, spawn, sniper, pickup, planes, addGeo, collider } = B;
  // ---------------- ground + perimeter ----------------
  // solo keeps the tight old block; a match gets a far wider arena, a dome and a hanging playground
  const P = arena ? 68 : 55, T = 6, PH = arena ? 30 : 18, E = P - 3.8, D = P - 3;
  L.bounds.minX = -P; L.bounds.maxX = P; L.bounds.minZ = -P; L.bounds.maxZ = P;
  box(0, -1, 0, 2 * P + T, 1, 2 * P + T);
  box(0, 0, -P, 2 * P + T, PH, T); box(0, 0, P, 2 * P + T, PH, T); box(-P, 0, 0, T, PH, 2 * P + T); box(P, 0, 0, T, PH, 2 * P + T);
  if (!arena) {
    // solo: the walls carry on upward unseen and unhookable, so their tops are not a place to camp, and a lid closes the sky
    const NG = { noNav: true, noGrapple: true };
    collider(0, PH, -P, 2 * P + T, 40, T, NG); collider(0, PH, P, 2 * P + T, 40, T, NG); collider(-P, PH, 0, T, 40, 2 * P + T, NG); collider(P, PH, 0, T, 40, 2 * P + T, NG);
    collider(0, 56, 0, 2 * P + 40, 8, 2 * P + 40, NG);
    const R = 96, C = -22;
    for (let k = 0; k < 6; k++) { const g = new THREE.TorusGeometry(R, 0.5, 5, 80, Math.PI); g.rotateY(k * Math.PI / 6); g.translate(0, C, 0); addGeo(g, INK.BLUE); }
    for (const h of [30, 46, 60, 70]) { const r = Math.sqrt(R * R - (h - C) * (h - C)); const g = new THREE.TorusGeometry(r, 0.4, 5, 96); g.rotateX(Math.PI / 2); g.translate(0, h, 0); addGeo(g, INK.BLUE); }
  }
  // ledges / balconies on the perimeter (grapple + stand)
  const ledges = [[-30, -E, 8, 1.6], [30, -E, 8, 1.6], [-E, 40, 1.6, 8], [E, -10, 1.6, 8], [-E, -30, 1.6, 6], [E, 35, 1.6, 6], [10, E, 8, 1.6], [-40, E, 6, 1.6]];
  for (const [x, z, w, d] of ledges) {
    box(x, 9, z, w, 0.4, d); box(x, 5.5, z, w, 0.4, d);
    if (arena) { box(x, 16, z, w, 0.4, d); ring(x, 20, z, 'y'); }
  }
  // spawn doorways in the perimeter (visual frames)
  const doorFrame = (x, z, alongX) => { if (alongX) { box(x - 1.2, 0, z, 0.3, 3.2, 0.5, { noCollide: true, ink: INK.BLACK }); box(x + 1.2, 0, z, 0.3, 3.2, 0.5, { noCollide: true, ink: INK.BLACK }); box(x, 3.0, z, 2.7, 0.3, 0.5, { noCollide: true, ink: INK.BLACK }); } else { box(x, 0, z - 1.2, 0.5, 3.2, 0.3, { noCollide: true, ink: INK.BLACK }); box(x, 0, z + 1.2, 0.5, 3.2, 0.3, { noCollide: true, ink: INK.BLACK }); box(x, 3.0, z, 0.5, 0.3, 2.7, { noCollide: true, ink: INK.BLACK }); } };
  for (const [x, z] of [[-D, 0], [D, 0], [-D, 30], [D, -30], [-D, -30], [D, 30]]) { doorFrame(x, z, false); spawn(x + (x < 0 ? 1.2 : -1.2), 0, z); }
  for (const [x, z] of [[0, -D], [0, D], [-30, D], [30, D]]) { doorFrame(x, z, true); spawn(x, 0, z + (z < 0 ? 1.2 : -1.2)); }
  if (arena) {
    // where a match drops people in: rooftops, the highway, the field edges and the outer ring
    for (const [x, y, z] of [[-34, 12.2, 12], [34, 12.2, 12], [-30, 7.2, -45], [16, 7.2, -45], [0, 7.4, -30], [-44, 0, -10], [44, 0, -10], [-40, 0, 40], [40, 0, 40], [0, 0, 55], [-58, 0, 0], [58, 0, 0], [0, 0, -58], [-54, 0, 54], [54, 0, -54]]) L.arenaSpawns.push(new THREE.Vector3(x, y, z));
    // a few low things on the field, nothing to hide a whole person
    box(-8, 0, 20, 3, 1, 1.2); box(10, 0, 26, 1.4, 1.2, 1.4); box(-12, 0, -8, 2.4, 0.8, 2.4); box(14, 0, -4, 2.4, 0.8, 2.4);
    for (const [x, z] of [[-56, 30], [56, -30], [30, -56], [-30, 56]]) { box(x, 0, z, 0.3, 7, 0.3, { noNav: true }); box(x, 7, z, 1.4, 0.3, 0.3, { noCollide: true }); addGeo(new THREE.SphereGeometry(0.45, 8, 6).translate(x + 0.7, 6.8, z), INK.ORANGE); }
    // the dome: ribs to look at, plus an invisible shell of bands that stops you and shrugs off the hook
    const R = 120, C = -30; const domeY = (x, z) => Math.sqrt(Math.max(1, R * R - x * x - z * z)) + C;
    for (let k = 0; k < 8; k++) { const g = new THREE.TorusGeometry(R, 0.6, 5, 96, Math.PI); g.rotateY(k * Math.PI / 8); g.translate(0, C, 0); addGeo(g, INK.BLUE); }
    for (const h of [38, 54, 68, 80, 88]) { const r = Math.sqrt(R * R - (h - C) * (h - C)); const g = new THREE.TorusGeometry(r, 0.5, 5, 128); g.rotateX(Math.PI / 2); g.translate(0, h, 0); addGeo(g, INK.BLUE); }
    addGeo(new THREE.SphereGeometry(2.4, 10, 8).translate(0, R + C, 0), INK.RED);
    const NG = { noNav: true, noGrapple: true };
    collider(0, 88, 0, 300, 10, 300, NG);
    for (let y0 = PH; y0 < 88; y0 += 4) { const inner = Math.sqrt(Math.max(0, R * R - (y0 + 4 - C) ** 2)); if (inner > P + T) continue; const o = inner + 80; collider(0, y0, -o, 320, 4, 160, NG); collider(0, y0, o, 320, 4, 160, NG); collider(-o, y0, 0, 160, 4, 320, NG); collider(o, y0, 0, 160, 4, 320, NG); }
    // a few pads hung from the dome, spread over the map so a swing has somewhere to land
    const cable = (x, y, z) => box(x, y, z, 0.12, Math.max(1, domeY(x, z) - y), 0.12, { noCollide: true, ink: INK.BLACK });
    const pad = (x, y, z, w, d) => { box(x, y, z, w, 0.5, d, { noNav: true }); cable(x, y + 0.5, z); ring(x, y - 1.3, z, 'y'); };
    for (const [x, y, z, w, d] of [[0, 24, 0, 8, 8], [-42, 18, -24, 6, 6], [44, 21, 30, 6, 6], [28, 27, -46, 5, 5], [-30, 30, 44, 5, 5]]) pad(x, y, z, w, d);
    // paper planes big enough to hook: they loop around the map at different heights
    planes(4, 30, 26, { scale: 1.7, rStep: 9, hStep: 6, speed: 0.11, ink: INK.BLUE });
  }

  // ---------------- central tower (solo only: a match wants the field open) ----------------
  if (!arena) {
    const W = 14, H = 4, hw = W / 2;
    for (let f = 1; f <= 4; f++) slab(-hw, -hw, hw, hw, f * H, 0.4);
    for (const [px, pz] of [[-6.6, -6.6], [6.6, -6.6], [-6.6, 6.6], [6.6, 6.6], [0, -6.6], [0, 6.6], [-6.6, 0], [6.6, 0]]) box(px, 0, pz, 0.8, 16, 0.8);
    for (let f = 1; f <= 3; f++) {
      const y = f * H;
      rail(-hw, hw, -1.5, hw, y); rail(1.5, hw, hw, hw, y); // south edge with a gap
      rail(-hw, -hw, hw, -hw, y); // west
      rail(hw, -hw, hw, hw, y); // east
      rail(-hw, -hw, -6.5, -hw, y); rail(3.5, -hw, hw, -hw, y); // north edge with landing gaps
    }
    // roof parapet with gaps, crane
    rail(-5, -hw, hw, -hw, 16); rail(-hw, hw, -1.5, hw, 16); rail(1.5, hw, hw, hw, 16); rail(-hw, -hw, -hw, hw, 16); rail(hw, -hw, hw, 3, 16);
    box(5.5, 16, 5.5, 1, 10, 1); box(5.5, 25.2, 5.5, 1.6, 1.4, 1.6, { noCollide: true });
    box(11.5, 25, 5.5, 16, 0.8, 0.8); box(1, 25, 5.5, 5, 0.8, 0.8); box(-0.5, 23.6, 5.5, 2, 1.6, 1.6);
    box(19, 20.5, 5.5, 0.08, 4.6, 0.08, { noCollide: true, ink: INK.BLACK });
    ring(19, 19.8, 5.5, 'x'); ring(19.5, 24.6, 5.5, 'z');   // only the crane keeps its rings
    // exterior switchback stairs on the north face (x runs -5..1.3, landings each side)
    // two-lane switchback: flights alternate between lanes so no flight sits directly under the next one
    let y = 0;
    for (let f = 0; f < 4; f++) {
      const dir = f % 2 === 0 ? '+x' : '-x'; const sx = dir === '+x' ? -5 : 1.3; const lane = f % 2 === 0 ? -8.3 : -10.3;
      stairs(sx, y, lane, dir, 14, 1.8); y += 4;
      const lx = dir === '+x' ? 2.4 : -6.1; slab(lx - 1.1, -11.4, lx + 1.1, -7, y, 0.4);
      rail(lx - 1.1, -11.4, lx + 1.1, -11.4, y);
    }
    spawn(0, 8, 0); spawn(0, 4, 3); sniper(0, 16, -3); pickup(0, 12, 0); pickup(-4, 8, 4); pickup(0, 16, 0);
  }

  // ---------------- building A (west): 3 floors, fire escape, ruler bridge to the tower ----------------
  {
    const x1 = -43, x2 = -25, z1 = 4, z2 = 20, H = 4;
    for (let f = 1; f <= 3; f++) slab(x1, z1, x2, z2, f * H, 0.4);
    // exterior walls with doors/windows
    wallZ(z1, z2, x2, 0, 12, 0.4, [[10, 13, 0, 3.2], [6, 9, 5, 7], [14, 17, 5, 7], [6, 9, 9, 11], [14, 17, 9, 11]]); // east face
    wallZ(z1, z2, x1, 0, 12, 0.4, [[8, 11, 0, 3.2], [8, 11, 4.5, 7.5], [8, 11, 8.5, 11.5]]); // west face
    wallX(x1, x2, z1, 0, 12, 0.4, [[-36, -33, 0, 3.2], [-40, -37, 5, 7], [-31, -28, 5, 7], [-36, -32, 8.5, 11.5]]); // north face
    wallX(x1, x2, z2, 0, 12, 0.4, [[-36, -32, 0, 3.2], [-31, -27, 0, 3.2], [-42, -39, 0, 3.2], [-37.2, -33.5, 4.05, 7.2], [-36, -32, 8.4, 11.4], [-41, -27, 4.6, 7.6], [-29, -25.5, 8.05, 11.2]]); // south face
    // interior partitions
    wallX(x1, x2, 12, 0, 4, 0.3, [[-40, -37.5], [-30, -27.5]]);
    wallX(x1, x2, 12, 4, 4, 0.3, [[-36, -32]]);
    wallZ(z1, z2, -34, 8, 4, 0.3, [[8, 11], [14, 17]]);
    // roof parapet with gaps
    rail(x1, z1, -37, z1, 12); rail(-31, z1, x2, z1, 12); rail(x1, z2, -37.4, z2, 12); rail(-34.4, z2, x2, z2, 12); rail(x1, z1, x1, z2, 12); rail(x2, z1, x2, 9, 12); rail(x2, 15, x2, z2, 12);
    // fire escape: switchback on the south face (z 21..23)
    let y = 0;
    for (let f = 0; f < 3; f++) {
      const dir = f % 2 === 0 ? '-x' : '+x'; const sx = dir === '-x' ? -28.5 : -34.8; const lane = f % 2 === 0 ? 21.2 : 23.2;
      stairs(sx, y, lane, dir, 14, 1.8); y += 4;
      const lx = dir === '-x' ? -35.9 : -27.4; slab(lx - 1.1, 20.2, lx + 1.1, 24.4, y, 0.4);
      rail(lx - 1.1, 24.4, lx + 1.1, 24.4, y);
    }
    // ruler bridge from the A roof: to the tower's third floor in solo, right across to building B in a match (y=12)
    { const bx2 = arena ? 24.2 : -7; const len = bx2 + 25.2;
      box((bx2 - 25.2) / 2, 11.6, 6, len, 0.4, 2.4, { ink: INK.ORANGE });
      for (let i = 0; i <= Math.floor(len); i++) box(-25 + i, 12, 5, 0.06, 0.02, i % 5 === 0 ? 0.6 : 0.35, { noCollide: true, ink: INK.BLACK });
      rail(-25, 7.2, bx2, 7.2, 12, { ink: INK.ORANGE }); if (arena) rail(-25, 4.8, bx2, 4.8, 12, { ink: INK.ORANGE }); }
    
    spawn(-34, 12, 12); spawn(-40, 0, 18); sniper(-27, 12, 6); pickup(-34, 4, 12); pickup(-30, 12, 16); pickup(-40, 8, 8);
  }

  // ---------------- building B (east): warehouse with catwalk + skylight ----------------
  {
    const x1 = 24, x2 = 44, z1 = 4, z2 = 20;
    // roof with a 6x6 skylight hole in the middle
    slab(x1, z1, x2, 9, 12, 0.4); slab(x1, 15, x2, z2, 12, 0.4); slab(x1, 9, 31, 15, 12, 0.4); slab(37, 9, x2, 15, 12, 0.4);
    wallZ(z1, z2, x1, 0, 12, 0.4, [[10, 14, 0, 3.6], [6, 9, 7, 10], [15, 18, 7, 10]]); // west face
    wallZ(z1, z2, x2, 0, 12, 0.4, [[7, 10, 0, 3.2], [14, 17, 0, 3.2], [8, 16, 7, 10]]); // east face
    wallX(x1, x2, z1, 0, 12, 0.4, [[32, 36, 0, 3.6], [27, 30, 7, 10], [38, 41, 7, 10]]); // north face
    wallX(x1, x2, z2, 0, 12, 0.4, [[26, 29, 0, 3.2], [39, 42, 0, 3.2], [33.5, 36.5, 4.05, 7.2], [25.5, 28.5, 8.05, 11.2], [32, 36, 8, 11]]); // south face
    // catwalk at y=6 around the inside walls (1.6 wide), interior stairs along the west wall
    slab(x1 + 0.4, z1 + 0.4, x1 + 2, z2 - 0.4, 6, 0.3); slab(x2 - 2, z1 + 0.4, x2 - 0.4, z2 - 0.4, 6, 0.3);
    slab(x1 + 2, z1 + 0.4, x2 - 2, z1 + 2, 6, 0.3); slab(x1 + 2, z2 - 2, x2 - 2, z2 - 0.4, 6, 0.3);
    rail(x1 + 2, z1 + 2, x1 + 2, 9, 6); rail(x1 + 2, 15, x1 + 2, 17, 6); rail(x2 - 2, z1 + 2, x2 - 2, z2 - 2, 6);
    rail(x1 + 2, z1 + 2, 31, z1 + 2, 6); rail(37, z1 + 2, x2 - 2, z1 + 2, 6); rail(x1 + 2, z2 - 2, x2 - 2, z2 - 2, 6);
    stairs(26.2, 0, 8.6, '+z', 21, 1.6, { rise: 6 / 21, run: 0.45 }); // arrives at z=18.05, y=6 onto the catwalk
    // crates inside
    box(34, 0, 12, 2.4, 2.4, 2.4); box(36.4, 0, 12, 2.4, 1.2, 2.4); box(30, 0, 16, 1.6, 1.6, 1.6, { ink: INK.GREEN });
    // exterior switchback on the south face to the roof (z 21..23)
    let y = 0;
    for (let f = 0; f < 3; f++) {
      const dir = f % 2 === 0 ? '+x' : '-x'; const sx = dir === '+x' ? 27.5 : 33.8; const lane = f % 2 === 0 ? 21.2 : 23.2;
      stairs(sx, y, lane, dir, 14, 1.8); y += 4;
      const lx = dir === '+x' ? 34.9 : 26.4; slab(lx - 1.1, 20.2, lx + 1.1, 24.4, y, 0.4);
      rail(lx - 1.1, 24.4, lx + 1.1, 24.4, y);
    }
    rail(x1, z1, 31, z1, 12); rail(37, z1, x2, z1, 12); rail(x1, z2, 33.4, z2, 12); rail(36.4, z2, x2, z2, 12); rail(x2, z1, x2, z2, 12); rail(x1, z1, x1, 9, 12); rail(x1, 15, x1, z2, 12);
    // plank bridge tower floor 3 -> B roof
    box(15.5, 11.6, 6, 17.4, 0.4, 2.2); rail(7, 4.9, 24, 4.9, 12);
    
    spawn(34, 12, 18); spawn(40, 0, 8); sniper(26, 12, 18); pickup(34, 0, 12); pickup(34, 6, 19); pickup(42, 12, 6);
  }

  // ---------------- highway ----------------
  {
    const z = -30, y = 7;
    slab(-52, z - 4.5, 52, z + 4.5, y, 0.6);
    wallX(-52, 52, z - 4.3, y, 0.9, 0.4, [[-33, -29], [27, 31], [-2, 2]]); // north barrier gaps: bridges to houses
    wallX(-52, 52, z + 4.3, y, 0.9, 0.4, [[-36.5, -33], [33, 36.5]]); // south barrier gaps: stairs
    for (let x = -48; x <= 48; x += 12) box(x, 0, z, 1.4, 6.4, 1.4);
    stairs(-46.5, 0, z + 5.5, '+x', 25, 2, { rise: 0.28, run: 0.45 }); stairs(46.5, 0, z + 5.5, '-x', 25, 2, { rise: 0.28, run: 0.45 });
    
    // road markings
    for (let x = -50; x < 50; x += 4) box(x + 1, y, z, 2, 0.02, 0.2, { noCollide: true, ink: INK.BLACK });
    spawn(-48, y, z); spawn(48, y, z); sniper(0, y, z); pickup(-10, y, z); pickup(24, y, z);
  }

  // ---------------- row houses (north) ----------------
  {
    const z = -45;
    box(-30, 0, z, 14, 7, 10); box(-8, 0, z, 14, 11, 10); box(16, 0, z, 14, 7, 10);
    // bridges from the highway to house 1 and house 3 (y=7)
    box(-31, 6.7, -37.25, 2.6, 0.3, 5.5); box(29, 6.7, -37.25, 2.6, 0.3, 5.5); box(0, 6.7, -37.25, 2.6, 0.3, 5.5);
    rail(-32.3, -40, -32.3, -34.5, 7); rail(-29.7, -40, -29.7, -34.5, 7); rail(27.7, -40, 27.7, -34.5, 7); rail(30.3, -40, 30.3, -34.5, 7);
    // stairs house1 roof -> house2 roof (over the gap)
    stairs(-23, 7, z, '+x', 14, 2.2); slab(-16.9, z - 1.1, -15, z + 1.1, 11, 0.4);
    // stairs house3 roof -> house2 roof
    stairs(9, 7, z, '-x', 14, 2.2); slab(-1, z - 1.1, 2.9, z + 1.1, 11, 0.4);
    // chimneys, water tank, doodle antenna
    box(-33, 7, z - 3, 1.2, 1.6, 1.2); box(19, 7, z + 3, 1.2, 1.4, 1.2); cyl(-10, 11, z - 2.5, 1.4, 2.6, { seg: 14 });
    box(-5, 11, z + 3, 0.1, 4, 0.1, { noCollide: true, ink: INK.BLACK });
    
    spawn(-8, 11, z); spawn(-30, 7, z - 3); spawn(16, 7, z); sniper(-8, 11, z - 3); sniper(16, 7, z + 2); pickup(-8, 11, z + 2); pickup(-30, 7, z);
  }

  // ---------------- south plaza: containers, crates, bus, doodle props (solo only) ----------------
  if (!arena) {
    box(-14, 0, 34, 2.5, 2.6, 6.2, { ink: INK.GREEN }); box(-14, 2.6, 34, 2.5, 2.6, 6.2, { ink: INK.ORANGE });
    box(14, 0, 36, 6.2, 2.6, 2.5); box(17, 2.6, 36, 3, 2.6, 2.5, { ink: INK.GREEN });
    box(-6, 0, 28, 1.4, 1.4, 1.4); box(-4.5, 0, 28.5, 1.2, 1.2, 1.2); box(-5.3, 1.4, 28.2, 1.0, 1.0, 1.0);
    box(8, 0, 26, 1.6, 1.6, 1.6); box(9.6, 0, 26.4, 1.2, 1.2, 1.2);
    // bus
    box(24, 0.6, 40, 11, 3.2, 2.8); box(24, 0, 40, 10, 0.6, 2.6, { noCollide: true }); for (const x of [20, 28]) { cyl(x, 0, 41.5, 0.55, 0.4, { noCollide: true, seg: 10, ink: INK.BLACK }); cyl(x, 0, 38.5, 0.55, 0.4, { noCollide: true, seg: 10, ink: INK.BLACK }); }
    // giant pencil lying on the ground (orange body, black tip, pink eraser)
    { const g = new THREE.CylinderGeometry(0.8, 0.8, 16, 6); g.rotateZ(Math.PI / 2); g.translate(-30, 0.8, 44); addGeo(g, INK.ORANGE); collider(-30, 0, 44, 16, 1.6, 1.6);
      const tip = new THREE.ConeGeometry(0.8, 2.4, 6); tip.rotateZ(-Math.PI / 2); tip.translate(-20.8, 0.8, 44); addGeo(tip, INK.BLACK); collider(-20.8, 0, 44, 2.4, 1.6, 1.6);
      const er = new THREE.CylinderGeometry(0.82, 0.82, 1.6, 8); er.rotateZ(Math.PI / 2); er.translate(-38.8, 0.8, 44); addGeo(er, INK.PINK); collider(-38.8, 0, 44, 1.6, 1.64, 1.64); }
    // giant eraser block (pink) + coffee mug (blue) props to climb
    box(38, 0, 40, 6, 2.2, 3.2, { ink: INK.PINK }); box(38, 2.2, 40, 6, 0.8, 3.2, { ink: INK.BLUE });
    cyl(-40, 0, 32, 2.6, 3.4, { seg: 16 }); { const h = new THREE.TorusGeometry(1.4, 0.35, 8, 16); h.translate(-36.6, 1.8, 32); addGeo(h, INK.BLUE); }
    // lamp posts + benches
    for (const [x, z] of [[-10, 46], [10, 46], [-22, 24], [22, 24]]) { box(x, 0, z, 0.25, 6, 0.25); box(x, 6, z, 1.4, 0.3, 0.5, { noCollide: true }); }
    for (const [x, z] of [[-4, 46], [4, 46]]) { box(x, 0.4, z, 3, 0.15, 0.6); box(x, 0, z, 2.6, 0.4, 0.2, { noCollide: true }); }
    pickup(-6, 0, 36); pickup(6, 0, 36); pickup(-30, 1.6, 44); pickup(38, 3, 40); pickup(0, 0, 10);
    // scattered cover in the open middle areas
    box(-16, 0, -8, 2.2, 1.2, 2.2); box(18, 0, -10, 2.2, 1.6, 2.2); box(-20, 0, 8, 1.6, 1.0, 3); box(20, 0, -2, 3, 1.0, 1.6);
    box(-8, 0, -18, 4, 1.1, 1.2); box(8, 0, -18, 4, 1.1, 1.2); box(0, 0, 22, 5, 0.5, 1.4); box(-24, 0, -18, 2.4, 2.6, 2.4, { ink: INK.ORANGE }); box(26, 0, -18, 2.4, 2.6, 2.4, { ink: INK.GREEN });
  }

  // ---------------- sky doodles ----------------
  {
    sphere(-90, 110, -160, 12, { seg: 12 });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; const g = new THREE.BoxGeometry(6, 0.7, 0.7); g.rotateZ(a); g.translate(-90 + Math.cos(a) * 19, 110 + Math.sin(a) * 19, -160); addGeo(g, INK.BLUE); }
    for (const [cx, cy, cz, s] of [[60, 70, -170, 1], [-20, 75, -190, 1.3], [140, 60, -80, 0.9], [-150, 65, 40, 1.1], [30, 80, 180, 1.2], [-90, 60, 170, 0.8]]) {
      for (let i = 0; i < 6; i++) sphere(cx + (i - 2.5) * 5 * s, cy + Math.sin(i * 1.7) * 2.5 * s, cz, (4 + (i % 3)) * s, { seg: 10 });
    }
  }

  L.teamSpawns = [[-40, 0, 18], [-34, 12, 12], [-48, 7, -30], [-52, 0, 30], [-30, 7, -48]].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  L.teamSpawns = [L.teamSpawns, [[40, 0, 8], [34, 12, 18], [48, 7, -30], [52, 0, 30], [16, 7, -45]].map(([x, y, z]) => new THREE.Vector3(x, y, z))];
  if (!arena) planes(3, 30, 30, { rStep: 8, hStep: 6, scale: 1.4 });
  return B.finish();
}

// ============================ map 2: The Desk ============================
// You are two inches tall on somebody's desk. Everything is a stationery object at monstrous
// scale: an open book whose pages are ramps, keyboard keys you hop between, a mug you spiral up,
// pen barrels laid as beams, paper clips arching overhead to swing from. Wide open in between,
// nothing enclosed, and every high place is in the open where anyone can shoot you off it.
// ============================ map 2: Paper Canyon ============================
// A gorge cut into the notebook. An ink river runs along the bottom, terraced cliffs step up on
// both sides (each ledge reachable by cut-in stairs, so enemies climb too), rock spires and a
// rope bridge give the grapple something to bite, and the top ledges are exposed sniper ground.

// ============================ map 2: Doodle Mexico ============================
// A sun-baked pueblo: a plaza with a fountain and a floating sombrero, a bandstand full of mariachis,
// a church with a bell tower, adobe houses, a market of piñatas, a taco cart, and mesas all around.
// Pots, crates, barrels, cacti and piñatas all break.
function buildMexico(B, arena = false) {
  const { L, box, slab, stairs, rail, cyl, sphere, ring, spawn, sniper, pickup, planes, addGeo, collider, scene } = B;
  const OR = INK.ORANGE, GR = INK.GREEN, PK = INK.PINK, BK = INK.BLACK, BL = INK.BLUE;
  L.key = 'mexico'; L.playerStart.set(0, 0, 16); const P = 62; L.bounds = { minX: -P, maxX: P, minZ: -P, maxZ: P };
  const mat = (ink, fill = false) => makeInkMaterial({ ink, fill, side: fill ? THREE.DoubleSide : THREE.FrontSide });
  const mesh = (geo, ink, fill = false) => new THREE.Mesh(geo, mat(ink, fill));
  // a prop that can be broken: its own meshes (so they can fly off) and a tagged collider
  const breakable = (kind, x, y, z, w, h, d, build, o = {}) => {
    const g = new THREE.Group(); build(g); g.position.set(x, y, z); scene.add(g); L.meshes.push(g);
    const br = { id: L.breakables.length, kind, group: g, hp: o.hp ?? 1, pos: new THREE.Vector3(x, y + h / 2, z), alive: true, ink: o.ink ?? OR, box: null };
    br.box = collider(x, y, z, w, h, d, { noNav: true }); br.box.data.breakable = br; L.breakables.push(br); return br;
  };
  const pot = (x, z, big = false) => breakable('pot', x, 0, z, big ? 1.2 : 0.9, big ? 1.3 : 0.9, big ? 1.2 : 0.9, (g) => {
    const r = big ? 0.55 : 0.4, h = big ? 1.2 : 0.85;
    g.add(mesh(new THREE.CylinderGeometry(r * 0.75, r, h, 9).translate(0, h / 2, 0), OR)); g.add(mesh(new THREE.TorusGeometry(r * 0.72, 0.05, 5, 12).rotateX(Math.PI / 2).translate(0, h, 0), BK));
    g.add(mesh(new THREE.TorusGeometry(r * 0.98, 0.04, 4, 12).rotateX(Math.PI / 2).translate(0, h * 0.45, 0), PK));
  }, { hp: 1, ink: OR });
  const crate = (x, z) => breakable('crate', x, 0, z, 1.1, 1.1, 1.1, (g) => {
    g.add(mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1).translate(0, 0.55, 0), BL)); for (const k of [-1, 1]) g.add(mesh(new THREE.BoxGeometry(1.14, 0.12, 0.12).translate(0, 0.55 + k * 0.35, 0.56), BK));
  }, { hp: 30, ink: BL });
  const barrel = (x, z) => breakable('barrel', x, 0, z, 1.1, 1.2, 1.1, (g) => {
    g.add(mesh(new THREE.CylinderGeometry(0.5, 0.45, 1.2, 10).translate(0, 0.6, 0), OR)); for (const y of [0.25, 0.95]) g.add(mesh(new THREE.TorusGeometry(0.5, 0.04, 4, 14).rotateX(Math.PI / 2).translate(0, y, 0), BK));
  }, { hp: 30, ink: OR });
  const cactus = (x, z, h = 2.6) => breakable('cactus', x, 0, z, 0.9, h, 0.9, (g) => {
    g.add(mesh(new THREE.CylinderGeometry(0.28, 0.34, h, 8).translate(0, h / 2, 0), GR));
    g.add(mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.9, 7).translate(0.6, h * 0.55, 0), GR)); g.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.7, 7).rotateZ(Math.PI / 2).translate(0.35, h * 0.38, 0), GR));
    g.add(mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.7, 7).translate(-0.55, h * 0.7, 0), GR)); g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.6, 7).rotateZ(Math.PI / 2).translate(-0.3, h * 0.55, 0), GR));
    g.add(mesh(new THREE.SphereGeometry(0.16, 6, 5).translate(0, h + 0.05, 0), PK));
  }, { hp: 40, ink: GR });
  // a piñata: a striped donkey hung on a string, bursting with candy
  const pinata = (x, y, z) => breakable('pinata', x, y, z, 1.1, 0.9, 0.6, (g) => {
    g.add(mesh(new THREE.BoxGeometry(0.9, 0.5, 0.45).translate(0, 0.55, 0), PK)); for (const k of [-0.3, 0, 0.3]) g.add(mesh(new THREE.BoxGeometry(0.1, 0.52, 0.47).translate(k, 0.55, 0), k ? GR : OR));
    g.add(mesh(new THREE.BoxGeometry(0.34, 0.3, 0.3).translate(0.6, 0.72, 0), PK)); g.add(mesh(new THREE.BoxGeometry(0.1, 0.22, 0.08).translate(0.62, 0.95, 0.1), OR)); g.add(mesh(new THREE.BoxGeometry(0.1, 0.22, 0.08).translate(0.62, 0.95, -0.1), OR));
    for (const [lx, lz] of [[-0.3, 0.15], [-0.3, -0.15], [0.3, 0.15], [0.3, -0.15]]) g.add(mesh(new THREE.BoxGeometry(0.12, 0.34, 0.12).translate(lx, 0.15, lz), PK));
    g.add(mesh(new THREE.BoxGeometry(0.03, 2.2, 0.03).translate(0, 1.85, 0), BK));
  }, { hp: 1, ink: PK });

  // ---------------- ground and the mesas around the edge ----------------
  box(0, -1, 0, 2 * P + 10, 1, 2 * P + 10);
  const mesa = (x, z, w, d) => { box(x, 0, z, w, 11, d); box(x + rand(-1.2, 1.2), 11, z + rand(-1.2, 1.2), w * 0.78, 7, d * 0.78); box(x + rand(-1, 1), 18, z + rand(-1, 1), w * 0.5, 5, d * 0.5); };
  for (let i = -2; i <= 2; i++) { mesa(i * 24, -P, 19, 8); mesa(i * 24, P, 19, 8); mesa(-P, i * 24, 8, 19); mesa(P, i * 24, 8, 19); }
  // trails between the mesas are where the doodles come from
  for (let i = -2; i < 2; i++) { spawn(i * 24 + 12, 0, -P + 5); spawn(i * 24 + 12, 0, P - 5); spawn(-P + 5, 0, i * 24 + 12); spawn(P - 5, 0, i * 24 + 12); }
  // an invisible lid so nobody leaves through the sky; the hook will not bite it
  collider(0, 62, 0, 2 * P + 40, 6, 2 * P + 40, { noNav: true, noGrapple: true });

  // ---------------- the plaza: paving, a fountain, and a sombrero floating above it ----------------
  slab(-24, -24, 24, 24, 0.15, 0.15);
  cyl(0, 0, 0, 5.5, 1.1); cyl(0, 1.1, 0, 1.2, 2.6); cyl(0, 3.7, 0, 2.4, 0.5); sphere(0, 5.4, 0, 0.7, { ink: BL }); ring(0, 7.2, 0, 'y');
  addGeo(new THREE.CylinderGeometry(5.1, 5.1, 0.08, 20).translate(0, 1.1, 0), BL);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; addGeo(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 5).rotateZ(0.35).rotateY(a).translate(Math.cos(a) * 1.7, 5.0, Math.sin(a) * 1.7), BL); }
  cyl(0, 13, 0, 8, 0.45, { ink: OR }); cyl(0, 13.45, 0, 3.2, 3, { ink: OR }); addGeo(new THREE.CylinderGeometry(3.3, 3.3, 0.5, 16).translate(0, 13.9, 0), PK);
  for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU; ring(Math.cos(a) * 7.2, 12.2, Math.sin(a) * 7.2, 'y'); }
  ring(0, 17.5, 0, 'y');

  // ---------------- the bandstand, with a mariachi band that never stops ----------------
  cyl(0, 0, -26, 6.5, 1.2); stairs(0, 0, -19.5, '-z', 4, 4.5, { rise: 0.3, run: 0.5 });
  for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + Math.PI / 8; cyl(Math.cos(a) * 5.6, 1.2, -26 + Math.sin(a) * 5.6, 0.22, 4.2, { noCollide: true, ink: OR }); }
  addGeo(new THREE.ConeGeometry(7.6, 3.2, 8).translate(0, 7.0, -26), OR); collider(0, 5.4, -26, 9, 0.5, 9, { noNav: true }); addGeo(new THREE.CylinderGeometry(7.6, 7.6, 0.3, 8).translate(0, 5.55, -26), BL); ring(0, 9.4, -26, 'y');
  const mariachi = (x, z, yaw, guitar) => {
    const m = buildHumanoid(makeInkMaterial({ ink: BK, shadeScale: 0, shadeBias: 1 }), makeInkMaterial({ ink: BK, fill: true, side: THREE.DoubleSide }), { weapon: 'rifle', scale: 1, hat: 'none', build: { bodyW: 1.05, headS: 1, limbR: 0.034 } });
    const J = m.J; while (J.gun.children.length) J.gun.remove(J.gun.children[0]);
    // sombrero: a wide brim and a tall crown; a guitar or a trumpet in the hands
    const hat = new THREE.Group(); hat.add(mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.05, 14), OR), mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.28, 10).translate(0, 0.16, 0), OR), mesh(new THREE.TorusGeometry(0.24, 0.03, 4, 12).rotateX(Math.PI / 2).translate(0, 0.06, 0), PK)); hat.position.y = 0.5; J.headG.add(hat);
    if (guitar) { J.gun.add(mesh(new THREE.BoxGeometry(0.34, 0.12, 0.5).translate(0, 0.02, 0.05), OR), mesh(new THREE.BoxGeometry(0.06, 0.05, 0.7).translate(0, 0.06, 0.55), BK)); J.armR.rotation.x = -0.9; J.armL.rotation.x = -1.0; J.armL.rotation.y = 0.5; J.foreL.rotation.x = -0.9; }
    else { J.gun.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 7).rotateX(Math.PI / 2).translate(0, 0.02, 0.25), OR), mesh(new THREE.CylinderGeometry(0.14, 0.05, 0.16, 8).rotateX(Math.PI / 2).translate(0, 0.02, 0.55), OR)); J.armR.rotation.x = -1.6; J.armL.rotation.x = -1.5; J.armL.rotation.y = 0.4; J.foreL.rotation.x = -0.4; J.headG.rotation.x = -0.25; }
    m.root.position.set(x, 1.2, z); m.root.rotation.y = yaw; scene.add(m.root); L.meshes.push(m.root);
    L.animated.push({ mesh: m.root, update: (t) => { const s = Math.sin(t * 6 + x); m.root.position.y = 1.2 + Math.max(0, s) * 0.08; J.hips.parent.rotation.z = s * 0.04; if (guitar) J.foreR.rotation.x = -0.5 + Math.sin(t * 9 + x) * 0.25; else J.headG.rotation.z = Math.sin(t * 4 + x) * 0.08; } });
  };
  mariachi(-2.6, -27.5, 0.4, true); mariachi(0, -28.5, 0, false); mariachi(2.6, -27.5, -0.4, true);

  // ---------------- the church: a nave, a bell tower you can climb, a domed second tower ----------------
  box(0, 0, 44, 24, 11, 16); box(0, 11, 44, 24, 1.6, 4.5); box(0, 12.6, 44, 3, 1.2, 3); box(0, 13.8, 44, 0.3, 2.2, 0.3); box(0, 15.2, 44, 1.4, 0.3, 0.3);
  slab(-7, 33.5, 7, 36.5, 0.8, 0.8); box(-3.2, 0, 35.8, 0.5, 5.4, 0.5, { noCollide: true, ink: BK }); box(3.2, 0, 35.8, 0.5, 5.4, 0.5, { noCollide: true, ink: BK }); addGeo(new THREE.TorusGeometry(3.2, 0.25, 6, 16, Math.PI).translate(0, 5.4, 35.8), BK);
  for (const x of [-8, 8]) for (const y of [3, 7]) box(x, y, 35.9, 1.6, 2.2, 0.3, { noCollide: true, ink: BK });
  box(-10, 0, 46, 6, 26, 6); for (const [dx, dz] of [[-2.5, -2.5], [2.5, -2.5], [-2.5, 2.5], [2.5, 2.5]]) box(-10 + dx, 26, 46 + dz, 0.6, 4, 0.6);
  box(-10, 30, 46, 7.2, 0.6, 7.2); box(-10, 30.6, 46, 0.3, 3, 0.3); box(-10, 32.4, 46, 1.6, 0.3, 0.3); sphere(-10, 28.2, 46, 0.95, { ink: OR }); ring(-10, 27.4, 42.2, 'y'); ring(-10, 33.8, 46, 'y');
  for (const y of [8, 15, 21]) { box(-10, y, 42.4, 6, 0.4, 1.3, { ink: OR }); box(-13.6, y + 3, 46, 1.3, 0.4, 6, { ink: OR }); }
  box(10, 0, 46, 6, 15, 6); sphere(10, 17.4, 46, 3.6, { ink: OR }); collider(10, 15, 46, 6, 5, 6, { noNav: true }); box(10, 20.8, 46, 0.3, 2, 0.3); ring(10, 21.6, 46, 'y');
  for (const y of [6, 11]) box(13.6, y, 46, 1.3, 0.4, 6, { ink: OR });

  // ---------------- adobe houses east and west, flat roofs with stairs, colored doors ----------------
  const house = (x, z, w, d, h, door, side) => {
    box(x, 0, z, w, h, d); box(x, h, z, w + 0.6, 0.35, d + 0.6, { ink: OR }); rail(x - w / 2, z - d / 2, x + w / 2, z - d / 2, h + 0.35, { ink: OR });
    const dx = side * (w / 2 + 0.01); box(x + dx, 0, z, 0.15, 2.6, 1.4, { noCollide: true, ink: door }); box(x + dx, 2.6, z, 0.15, 0.3, 1.8, { noCollide: true, ink: BK });
    for (const wz of [z - d * 0.32, z + d * 0.32]) box(x + dx, 1.6, wz, 0.12, 1.1, 1.1, { noCollide: true, ink: BK });
    const n = Math.round(h / 0.3); stairs(x - side * (w / 2 + 0.3), 0, z + d / 2 + 0.9, side > 0 ? '+x' : '-x', n, 1.6, { rise: h / n, run: 0.42 });
    box(x, h + 0.35, z + d / 2 - 1.2, 2.2, 0.9, 1.4, { ink: OR }); ring(x, h + 3.2, z, 'y');
  };
  house(-40, -20, 11, 9, 6, GR, 1); house(-40, -4, 9, 8, 5, PK, 1); house(-40, 14, 12, 10, 7.5, OR, 1);
  house(40, -18, 12, 9, 7, PK, -1); house(40, 0, 9, 8, 5.5, GR, -1); house(40, 16, 11, 10, 6.5, OR, -1);
  // strings of papel picado across the plaza, with rings hung along them
  const banner = (x1, y1, z1, x2, y2, z2, n) => {
    for (let i = 0; i <= n; i++) { const t = i / n, x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t - Math.sin(t * Math.PI) * 1.2, z = z1 + (z2 - z1) * t; if (i < n) { const dx = (x2 - x1) / n, dz = (z2 - z1) / n; addGeo(new THREE.BoxGeometry(Math.hypot(dx, dz) + 0.05, 0.05, 0.05).rotateY(-Math.atan2(dz, dx)).translate(x + dx / 2, y, z + dz / 2), BK); } if (i % 2 === 1) addGeo(new THREE.BoxGeometry(0.7, 0.55, 0.02).rotateY(-Math.atan2(z2 - z1, x2 - x1)).translate(x, y - 0.32, z), [PK, GR, OR][i % 3]); if (i === Math.floor(n / 2)) ring(x, y - 1.2, z, 'y'); }
  };
  banner(-34.5, 6.4, -20, -8, 30.6, 42, 22); banner(34.5, 7.4, -18, 8, 21.2, 42, 22); banner(-34.5, 5.4, -4, 34.5, 5.9, 0, 26); banner(-34.5, 7.9, 14, 34.5, 6.9, 16, 26);

  // ---------------- the market: stalls under striped canopies, piñatas hanging, pots and crates about ----------------
  const stall = (x, z, w, d, yaw) => {
    box(x, 0, z, w, 0.9, d); for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(x + sx * (w / 2 - 0.15), 0, z + sz * (d / 2 - 0.15), 0.14, 2.9, 0.14, { noCollide: true, ink: BK });
    for (let i = 0; i < 5; i++) addGeo(new THREE.BoxGeometry(w + 0.6, 0.06, (d + 0.6) / 5).translate(x, 2.95, z - (d + 0.6) / 2 + (i + 0.5) * (d + 0.6) / 5), i % 2 ? PK : OR);
    collider(x, 2.9, z, w + 0.6, 0.12, d + 0.6, { noNav: true });
  };
  stall(-20, 22, 4.5, 2.4); stall(-13, 22, 4.5, 2.4); stall(20, 22, 4.5, 2.4); stall(13, 22, 4.5, 2.4); stall(-24, -12, 2.4, 4.5); stall(26, -8, 2.4, 4.5);
  pinata(-20, 1.3, 22); pinata(13, 1.3, 22); pinata(-24, 1.3, -12); pinata(26, 1.3, -8); pinata(0, 6.4, 8); pinata(-9, 9.5, 12); pinata(9, 9.5, 12);
  for (const [x, z] of [[-17.5, 24.5], [-9.5, 24.5], [16.5, 24.5], [23.5, 24.5], [-27.5, -9], [-27.5, -15], [29, -5], [29, -11]]) crate(x, z);
  for (const [x, z] of [[-33, -14], [-33, -12.6], [-33, -6], [-33, 10], [-33, 20], [33, -12], [33, -3], [33, 6], [33, 22], [-6, 30], [6, 30], [-18, 31], [18, 31], [-3, -33], [3, -33]]) pot(x, z, Math.random() < 0.3);
  for (const [x, z] of [[-18, -30], [18, -30], [-30, 30], [30, 30]]) barrel(x, z);

  // ---------------- the taco cart: the best tacos on the page, and where the healing comes from ----------------
  box(24, 0, 4, 3.2, 1.3, 1.6, { ink: OR }); box(24, 1.3, 4, 3.4, 0.9, 1.8, { ink: BL }); box(22.5, 0, 4, 0.14, 3.6, 0.14, { noCollide: true, ink: BK }); box(25.5, 0, 4, 0.14, 3.6, 0.14, { noCollide: true, ink: BK });
  for (let i = 0; i < 4; i++) addGeo(new THREE.BoxGeometry(3.6, 0.06, 0.55).translate(24, 3.62, 3 + i * 0.55), i % 2 ? GR : OR);
  addGeo(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 12).rotateZ(Math.PI / 2).translate(23.1, 0.34, 3.1), BK); addGeo(new THREE.CylinderGeometry(0.34, 0.34, 0.14, 12).rotateZ(Math.PI / 2).translate(24.9, 0.34, 3.1), BK);
  { const g = new THREE.CylinderGeometry(0.7, 0.7, 0.35, 12, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); g.rotateX(-Math.PI / 2); g.translate(24, 4.6, 4); addGeo(g, OR); addGeo(new THREE.BoxGeometry(1.3, 0.14, 0.3).translate(24, 4.62, 4), GR); addGeo(new THREE.BoxGeometry(1.1, 0.1, 0.2).translate(24, 4.76, 4), BK); }
  for (const [x, z] of [[22, 6.5], [26, 6.5], [24, 1.5]]) pickup(x, 0, z);

  // ---------------- cacti and rocks in the dust outside the plaza ----------------
  for (const [x, z, h] of [[-46, -40, 2.8], [-50, -28, 2.2], [-48, 30, 3.0], [-44, 44, 2.4], [46, -44, 2.6], [50, -30, 2.2], [48, 34, 3.2], [44, 46, 2.5], [-30, -48, 2.8], [30, -48, 2.4], [-28, 48, 2.6], [28, 50, 2.9], [12, -44, 2.2], [-12, -44, 2.6]]) cactus(x, z, h);
  for (const [x, z, r] of [[-52, -46, 2.2], [52, 48, 2.6], [-52, 48, 1.8], [52, -48, 2.0], [0, -52, 1.6], [0, 52, 1.6]]) { sphere(x, r * 0.55, z, r, { ink: BL }); collider(x, 0, z, r * 1.5, r * 1.2, r * 1.5); }
  // a few low walls and a well for cover between the plaza and the market
  box(-12, 0, -12, 8, 1.1, 0.5, { ink: OR }); box(12, 0, -12, 8, 1.1, 0.5, { ink: OR }); box(-30, 0, 34, 0.5, 1.1, 8, { ink: OR }); box(30, 0, 34, 0.5, 1.1, 8, { ink: OR });
  cyl(-14, 0, 8, 1.3, 1.0); box(-14, 1, 8, 0.15, 2.0, 0.15, { noCollide: true, ink: BK }); box(-14, 3, 8, 2.2, 0.3, 0.3, { noCollide: true, ink: BK });

  // ---------------- where things are: perches, pickups, match spawns ----------------
  for (const [x, y, z] of [[-10, 30.6, 46], [10, 15, 46], [-40, 7.5, 14], [40, 7, -18], [0, 5.9, -26], [0, 13.45, 0]]) sniper(x, y, z);
  for (const [x, y, z] of [[0, 1.25, 8], [-20, 0, 0], [20, 0, -14], [0, 0, -36], [-40, 6, -20], [40, 5.5, 0], [0, 11, 44], [0, 13.5, 0], [-24, 0, 24], [24, 0, 24]]) pickup(x, y, z);
  for (const [x, y, z] of [[-40, 6.2, -20], [40, 7.2, -18], [-40, 7.7, 14], [40, 6.7, 16], [0, 11.2, 44], [0, 5.6, -26], [-46, 0, 0], [46, 0, 0], [0, 0, -50], [-30, 0, 46], [30, 0, 46], [0, 13.6, 0], [-10, 30.8, 46]]) L.arenaSpawns.push(new THREE.Vector3(x, y, z));

  // ---------------- sky: a fat sun, far mesas, paper planes ----------------
  addGeo(new THREE.SphereGeometry(14, 14, 10).translate(70, 95, -150), OR);
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; const g = new THREE.BoxGeometry(7, 0.9, 0.9); g.rotateZ(a); g.translate(70 + Math.cos(a) * 21, 95 + Math.sin(a) * 21, -150); addGeo(g, OR); }
  for (const [x, z, w, h] of [[-120, -160, 60, 30], [40, -190, 90, 36], [150, -120, 70, 26], [-170, 60, 50, 24], [160, 90, 80, 30], [-60, 190, 100, 34]]) { addGeo(new THREE.BoxGeometry(w, h, 30).translate(x, h / 2, z), BL); addGeo(new THREE.BoxGeometry(w * 0.6, h * 0.5, 22).translate(x, h + h * 0.25, z), BL); }
  planes(3, 30, 26, { rStep: 8, hStep: 6, scale: 1.4 });
  B.finish(); return L;
}

export function buildLevel(scene, world, key = 'district', opts = {}) {
  const B = createBuilder(scene, world);
  return key === 'mexico' ? buildMexico(B, !!opts.arena) : buildDistrict(B, !!opts.arena);
}
