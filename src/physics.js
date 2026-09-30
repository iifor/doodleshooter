// Axis-aligned box world: static colliders, spatial hash, swept body movement with step-up, raycasts.
import * as THREE from 'three';

const EPS = 1e-4;
const AX = ['x', 'y', 'z'];
const _min = new THREE.Vector3(), _max = new THREE.Vector3(), _out = [];

export class World {
  constructor(cell = 8) {
    this.boxes = []; this.cell = cell; this.grid = new Map(); this._qid = 0;
    this.bounds = { min: new THREE.Vector3(-60, -20, -60), max: new THREE.Vector3(60, 80, 60) };
  }
  // wipe the world so a different map can be built into the same instance
  clear() { this.boxes.length = 0; this.grid.clear(); this._qid = 0; }
  addBox(min, max, data = {}) {
    const b = { min: { x: min.x, y: min.y, z: min.z }, max: { x: max.x, y: max.y, z: max.z }, data, id: this.boxes.length, _q: -1 };
    this.boxes.push(b); return b;
  }
  finalize() { this.grid.clear(); for (const b of this.boxes) this._insert(b); }
  removeBox(b) { const i = this.boxes.indexOf(b); if (i < 0) return; this.boxes.splice(i, 1); this.finalize(); }
  _key(ix, iz) { return (ix + 4096) * 8192 + (iz + 4096); }
  _insert(b) {
    const c = this.cell;
    const x0 = Math.floor(b.min.x / c), x1 = Math.floor(b.max.x / c), z0 = Math.floor(b.min.z / c), z1 = Math.floor(b.max.z / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this._key(ix, iz); let arr = this.grid.get(k); if (!arr) { arr = []; this.grid.set(k, arr); } arr.push(b);
    }
  }
  // Boxes overlapping the AABB [min,max]
  query(min, max, out = []) {
    out.length = 0; const c = this.cell; const q = ++this._qid;
    const x0 = Math.floor(min.x / c), x1 = Math.floor(max.x / c), z0 = Math.floor(min.z / c), z1 = Math.floor(max.z / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const arr = this.grid.get(this._key(ix, iz)); if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const b = arr[i]; if (b._q === q) continue; b._q = q;
        if (b.min.x < max.x && b.max.x > min.x && b.min.y < max.y && b.max.y > min.y && b.min.z < max.z && b.max.z > min.z) out.push(b);
      }
    }
    return out;
  }
  overlapsAABB(min, max) { return this.query(min, max, _out).length > 0; }

  _bodyBox(body, min, max) {
    const p = body.pos, hw = body.halfW;
    min.set(p.x - hw + EPS, p.y + EPS, p.z - hw + EPS);
    max.set(p.x + hw - EPS, p.y + body.height - EPS, p.z + hw - EPS);
  }
  overlapsBody(body) { this._bodyBox(body, _min, _max); return this.query(_min, _max, _out).length > 0; }

  // Push the body out of any overlapping boxes along one axis. Returns sign of the push (0 = none).
  _resolveAxis(body, axis, move) {
    const ax = AX[axis]; const p = body.pos; let pushed = 0; const dir = Math.sign(move); const lim = Math.abs(move) + 0.03;
    for (let iter = 0; iter < 4; iter++) {
      this._bodyBox(body, _min, _max); this.query(_min, _max, _out);
      if (_out.length === 0) break;
      let best = 0;
      for (let i = 0; i < _out.length; i++) {
        const b = _out[i];
        const cNeg = b.min[ax] - _max[ax] - EPS; // move back (negative)
        const cPos = b.max[ax] - _min[ax] + EPS; // move forward (positive)
        let corr;
        if (dir > 0 && -cNeg <= lim) corr = cNeg;
        else if (dir < 0 && cPos <= lim) corr = cPos;
        else corr = Math.abs(cNeg) < Math.abs(cPos) ? cNeg : cPos;
        if (Math.abs(corr) > Math.abs(best)) best = corr;
      }
      if (best === 0) break;
      p[ax] += best; pushed = Math.sign(best);
    }
    return pushed;
  }

  _moveHoriz(body, dx, dz, canStep) {
    const p = body.pos; const ox = p.x, oz = p.z, oy = p.y;
    body._bx = 0; body._bz = 0;
    if (dx === 0 && dz === 0) return;
    p.x += dx; const rx = this._resolveAxis(body, 0, dx);
    p.z += dz; const rz = this._resolveAxis(body, 2, dz);
    if (rx === 0 && rz === 0) return;
    const nx = p.x, nz = p.z; let stepped = false;
    if (canStep && body.stepHeight > 0) {
      p.x = ox; p.z = oz; p.y = oy + body.stepHeight;
      if (!this.overlapsBody(body)) {
        p.x += dx; const rx2 = this._resolveAxis(body, 0, dx);
        p.z += dz; const rz2 = this._resolveAxis(body, 2, dz);
        p.y -= body.stepHeight; this._resolveAxis(body, 1, -body.stepHeight);
        const d1 = (nx - ox) ** 2 + (nz - oz) ** 2, d2 = (p.x - ox) ** 2 + (p.z - oz) ** 2;
        if (d2 > d1 + 1e-6 && p.y >= oy - 1e-3 && !this.overlapsBody(body)) {
          stepped = true; body._bx = rx2; body._bz = rz2;
          if (rx2 !== 0 || rz2 !== 0) { body.hitWall = true; body.wallNormal.set(rx2, 0, rz2).normalize(); }
        }
      }
      if (!stepped) { p.x = nx; p.z = nz; p.y = oy; }
    }
    if (!stepped) { body._bx = rx; body._bz = rz; body.hitWall = true; body.wallNormal.set(rx, 0, rz).normalize(); }
  }

  // Integrate movement for a body {pos, vel, halfW, height, stepHeight, onGround, ...}; sub-steps fast bodies so they never tunnel.
  moveBody(body, dt) {
    const sp = body.vel.length(); const maxStep = Math.max(0.2, body.halfW * 0.8);
    const n = Math.min(10, Math.max(1, Math.ceil((sp * dt) / maxStep)));
    if (n === 1) { this._moveBodyStep(body, dt); return; }
    let landVel = 0, hitWall = false, hitCeiling = false, wx = 0, wz = 0;
    for (let i = 0; i < n; i++) {
      this._moveBodyStep(body, dt / n);
      if (body.hitWall) { hitWall = true; wx = body.wallNormal.x; wz = body.wallNormal.z; }
      if (body.hitCeiling) hitCeiling = true; if (body.landVel) landVel = body.landVel;
    }
    body.hitWall = hitWall; body.wallNormal.set(wx, 0, wz); body.hitCeiling = hitCeiling; body.landVel = landVel;
  }
  _moveBodyStep(body, dt) {
    const p = body.pos, v = body.vel;
    body.hitWall = false; body.hitCeiling = false; body.wallNormal.set(0, 0, 0); body.landVel = 0;
    const wasGround = body.onGround;
    const hs = body.moveScale ?? 1, vs = body.moveScaleY ?? 1;
    this._moveHoriz(body, v.x * dt * hs, v.z * dt * hs, wasGround || body.alwaysStep);
    if (body._bx !== 0) v.x = 0; if (body._bz !== 0) v.z = 0;
    const dy = v.y * dt * vs; p.y += dy;
    const r = this._resolveAxis(body, 1, dy);
    body.onGround = false;
    if (r > 0) { body.onGround = true; body.landVel = v.y; if (v.y < 0) v.y = 0; }
    else if (r < 0) { body.hitCeiling = true; if (v.y > 0) v.y = 0; }
    if (!body.onGround && wasGround && v.y <= 0 && !body.noSnap) {
      const probe = body.stepHeight; p.y -= probe;
      const r2 = this._resolveAxis(body, 1, -probe);
      if (r2 > 0) { body.onGround = true; v.y = 0; } else p.y += probe;
    }
  }

  // Ray vs all boxes (slab test). Returns {dist, point, normal, box} or null.
  raycast(o, d, maxDist = 1000, ignore = null) {
    let best = null, bestT = maxDist, bAxis = -1, bSign = 0;
    const boxes = this.boxes;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]; if (ignore && ignore(b)) continue;
      let tmin = 0, tmax = bestT, nAxis = -1, nSign = 0, ok = true;
      for (let a = 0; a < 3; a++) {
        const ax = AX[a]; const da = d[ax], oa = o[ax];
        if (Math.abs(da) < 1e-9) { if (oa < b.min[ax] || oa > b.max[ax]) { ok = false; break; } continue; }
        const inv = 1 / da; let t1 = (b.min[ax] - oa) * inv, t2 = (b.max[ax] - oa) * inv, sign = -1;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; sign = 1; }
        if (t1 > tmin) { tmin = t1; nAxis = a; nSign = sign; }
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) { ok = false; break; }
      }
      if (!ok || nAxis < 0) continue;
      if (tmin < bestT) { best = b; bestT = tmin; bAxis = nAxis; bSign = nSign; }
    }
    if (!best) return null;
    const point = new THREE.Vector3(o.x + d.x * bestT, o.y + d.y * bestT, o.z + d.z * bestT);
    const normal = new THREE.Vector3(); normal[AX[bAxis]] = bSign;
    return { dist: bestT, point, normal, box: best };
  }
  // Highest walkable surface below a point
  groundBelow(x, y, z, maxDrop = 100) {
    const hit = this.raycast({ x, y, z }, { x: 0, y: -1, z: 0 }, maxDrop);
    return hit ? hit.point.y : y - maxDrop;
  }
  hasLineOfSight(a, b, ignore = null) {
    const d = new THREE.Vector3().subVectors(b, a); const len = d.length(); if (len < 1e-4) return true; d.divideScalar(len);
    return this.raycast(a, d, len, ignore) === null;
  }
}

export const SEE_THROUGH = (b) => b.data.noShoot === true;

export function makeBody(pos, halfW, height, stepHeight = 0.55) {
  return { pos: pos.clone(), vel: new THREE.Vector3(), halfW, height, stepHeight, onGround: false, hitWall: false, hitCeiling: false, wallNormal: new THREE.Vector3(), landVel: 0, noSnap: false, alwaysStep: false, _bx: 0, _bz: 0 };
}
