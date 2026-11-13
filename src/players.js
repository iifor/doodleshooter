// Other people in the match. Each is drawn as a doodle figure in a team colour and eased between
// the snapshots its owner sends; it also exposes the same surface enemies and weapons expect of a
// target (body, center, eye, hit spheres, takeDamage) so the rest of the game does not care
// whether it is shooting at a bot or a friend.
import * as THREE from 'three';
import { makeInkMaterial, setFill, INK } from './render.js';
import { buildHumanoid, buildWeaponProp } from './enemies.js';
import { clamp, damp, angleLerp, wrapAngle } from './util.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
const WEAPON_KINDS = ['rifle', 'shotgun', 'sniper', 'blade'];
const HIT = [['head', 0.3], ['torso', 0.33], ['hips', 0.2], ['armL', 0.11], ['armR', 0.11], ['foreL', 0.1], ['foreR', 0.1], ['legL', 0.13], ['legR', 0.13], ['shinL', 0.11], ['shinR', 0.11]];

// what a player broadcasts about itself, ~20 times a second:
// position, look, weapon, state flags, hp, velocity and (while grappling) where the hook is
export function encodeLocal(P, weaponIndex, extra = {}) {
  const b = P.body; const g = P.grapple; const grappling = g && g.state !== 'idle';
  const out = [+b.pos.x.toFixed(2), +b.pos.y.toFixed(2), +b.pos.z.toFixed(2), +P.yaw.toFixed(2), +P.pitch.toFixed(2), weaponIndex,
    (P.crouching ? 1 : 0) | (P.sliding ? 2 : 0) | (P.isBlocking ? 4 : 0) | (P._aiming ? 8 : 0) | (b.onGround ? 16 : 0) | (extra.firing ? 32 : 0) | (P.alive ? 64 : 0) | (grappling ? 128 : 0) | (P.parryWindow ? 256 : 0) | (extra.idle ? 512 : 0) | (extra.untouched ? 1024 : 0) | (extra.away ? 2048 : 0),
    Math.round(P.hp), +b.vel.x.toFixed(1), +b.vel.y.toFixed(1), +b.vel.z.toFixed(1)];
  if (grappling) out.push(+g.hook.x.toFixed(1), +g.hook.y.toFixed(1), +g.hook.z.toFixed(1));
  return out;
}

export class RemotePlayer {
  constructor(ctx, id, name, team, ink) {
    this.ctx = ctx; this.id = id; this.name = name || 'paper'; this.team = team; this.ink = ink;
    this.isLocal = false; this.alive = true; this.parryWindow = false; this.idle = false; this.idleSince = 0; this.untouched = false; this.away = false; this.hp = 100; this.maxHp = 100; this.speed = 0; this.weaponIndex = 0;
    this.body = { pos: new THREE.Vector3(0, -50, 0), vel: new THREE.Vector3(), halfW: 0.35, height: 1.75, onGround: true };
    this.center = new THREE.Vector3(); this.eye = new THREE.Vector3(); this.forward = new THREE.Vector3(0, 0, -1); this.right = new THREE.Vector3(1, 0, 0);
    this.yaw = 0; this.pitch = 0; this.crouching = false; this.sliding = false; this.blocking = false; this.aiming = false; this.firing = false;
    this.snapA = null; this.snapB = null; this.phase = 0; this.walk = 0; this.flashT = 0; this.deadT = 0; this.kills = 0; this.deaths = 0; this.score = 0;
    this.mat = makeInkMaterial({ ink, shadeScale: 0, shadeBias: 1 }); this.solid = makeInkMaterial({ ink: INK.BLACK, fill: true, side: THREE.DoubleSide });
    this.T = { weapon: 'rifle', scale: 1.0, hat: 'cap', build: { bodyW: 1, headS: 1, limbR: 0.033 }, blockRadius: 0 };
    this.hit = HIT; this.hitSpheres = HIT.map(() => new THREE.Vector3()); this.vel = new THREE.Vector3(); this.grappling = false; this.gPoint = new THREE.Vector3();
    this._buildModel();
    // the grapple rope: a thin line from the hand to wherever the hook is
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1, 5), makeInkMaterial({ ink: INK.BLACK })); this.rope.visible = false; ctx.scene.add(this.rope);
    this.hook = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 5), makeInkMaterial({ ink: INK.BLACK, fill: true })); this.hook.visible = false; ctx.scene.add(this.hook);
  }
  _buildModel() {
    const model = buildHumanoid(this.mat, this.solid, this.T);
    this.root = model.root; this.parts = model.parts; this.J = model.J; this.face = model.face;
    this.root.visible = false; this.ctx.scene.add(this.root); this.weaponIndex = -1;
    // a name tag: a little flag above the head so you know who is who
    this.tagG = new THREE.Group(); this.root.add(this.tagG); this.tagG.position.y = 2.25;
    const flag = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.28, 0.02), makeInkMaterial({ ink: this.ink, fill: true, side: THREE.DoubleSide })); this.tagG.add(flag);
    this.corpse = false;
  }
  // knocked flat with some physics: the whole figure tumbles away as debris (bits come off on a
  // big hit), and a fresh figure is drawn when the player comes back
  ragdoll(dir, over) {
    if (this.corpse) return; this.corpse = true; const eff = this.ctx.effects, scene = this.ctx.scene, J = this.J;
    this.tagG.visible = false; this.rope.visible = false; this.hook.visible = false;
    const d = (dir && dir.lengthSq() > 0.01 ? dir.clone() : new THREE.Vector3(0, 0.4, -1)).normalize();
    const detach = (obj, extraVel, radius) => { if (!obj || !obj.parent) return; obj.updateWorldMatrix(true, false); scene.attach(obj); _v.copy(d).multiplyScalar(4 + Math.random() * 4).add(extraVel); _v.y += 2 + Math.random() * 3; eff.debris(obj, obj.position, _v, new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16), { radius, blood: true, life: 7 + Math.random() * 3 }); };
    if (over) { detach(J.headG, _v2.set((Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4), 0.25); if (Math.random() < 0.5) detach(Math.random() < 0.5 ? J.armL : J.armR, _v2.set((Math.random() - 0.5) * 6, 2, (Math.random() - 0.5) * 6), 0.12); }
    // limp joints, then the body flies as one piece
    for (const k of ['armL', 'armR', 'legL', 'legR', 'foreL', 'foreR', 'shinL', 'shinR']) if (J[k]) { J[k].rotation.x = (Math.random() - 0.5) * 2.4; J[k].rotation.z = (Math.random() - 0.5) * 1.2; }
    if (this.face) { this.face.eyes.visible = false; this.face.xeyes.visible = true; }
    this.root.updateWorldMatrix(true, false); scene.attach(this.root);
    _v.copy(d).multiplyScalar(5 + Math.random() * 3); _v.y += 3.5 + Math.random() * 2; _v.addScaledVector(this.vel, 0.4);
    eff.debris(this.root, this.root.position, _v, new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 9), { radius: 0.55, blood: true, life: 8 });
    eff.blood(this.center, d, 1.3); eff.bloodPool(this.body.pos, 1.2 + Math.random() * 0.6, INK.RED);
    this.root = null;
  }
  get isBlocking() { return this.blocking; }
  get blockRadius() { return 0; }
  setWeapon(i) {
    if (i === this.weaponIndex && this.J.gun.children.length) return; this.weaponIndex = i;
    const gun = this.J.gun; while (gun.children.length) gun.remove(gun.children[0]);
    buildWeaponProp(gun, this.mat, this.solid, { weapon: WEAPON_KINDS[i] || 'rifle' });
  }
  push(snap, t) {
    if (!snap) return;
    this.snapA = this.snapB || { p: new THREE.Vector3(snap[0], snap[1], snap[2]), yaw: snap[3], pitch: snap[4], t: t - 0.07 };
    this.snapB = { p: new THREE.Vector3(snap[0], snap[1], snap[2]), yaw: snap[3], pitch: snap[4], t };
    this.setWeapon(snap[5]); const f = snap[6];
    this.crouching = !!(f & 1); this.sliding = !!(f & 2); this.blocking = !!(f & 4); this.aiming = !!(f & 8); this.body.onGround = !!(f & 16); this.firing = !!(f & 32);
    const wasAlive = this.alive; this.alive = !!(f & 64); this.hp = snap[7];
    if (snap.length > 10) this.vel.set(snap[8], snap[9], snap[10]); else this.vel.set(0, 0, 0);
    this.grappling = !!(f & 128) && snap.length > 13; if (this.grappling) this.gPoint.set(snap[11], snap[12], snap[13]); this.parryWindow = !!(f & 256); const idle = !!(f & 512); if (idle && !this.idle) this.idleSince = t; this.idle = idle; this.untouched = !!(f & 1024); this.away = !!(f & 2048);
    if (wasAlive && !this.alive) this.deadT = 0;
    if (this.alive && this.corpse) { this._buildModel(); this.snapA = null; this.body.pos.copy(this.snapB.p); }
    if (this.root && !this.root.visible && !this.away) { this.body.pos.copy(this.snapB.p); this.root.visible = true; }
    if (this.root && this.away) this.root.visible = false;
  }
  // damage dealt to this player by the host's bots or by another player's shot goes to its owner
  takeDamage(amount, fromPos) { if (this.onDamage) this.onDamage(this, amount, fromPos); }
  knockback() { /* the owner's client applies its own physics */ }
  tryBlockMelee(e) {
    if (!this.alive || !this.blocking) return false;
    _v.subVectors(e.center, this.eye).normalize(); return _v.dot(this.forward) > 0.35;
  }
  tryDeflect() { return false; }
  flash() { this.flashT = 0.08; setFill(this.mat, true); }
  update(dt, now) {
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) setFill(this.mat, false); }
    if (this.snapB) {
      const A = this.snapA || this.snapB; const span = Math.max(0.02, this.snapB.t - A.t); const tt = now - 0.08; const k = clamp((tt - A.t) / span, 0, 1);
      _v.lerpVectors(A.p, this.snapB.p, k);
      const late = tt - this.snapB.t; if (late > 0) _v.addScaledVector(this.vel, Math.min(late, 0.35));
      if (_v.distanceToSquared(this.body.pos) > 36) this.body.pos.copy(_v); else this.body.pos.lerp(_v, 1 - Math.exp(-dt * 22));
      this.body.vel.copy(this.vel);
      this.yaw = angleLerp(A.yaw, this.snapB.yaw, k); this.pitch = A.pitch + (this.snapB.pitch - A.pitch) * k;
    }
    this.speed = this.body.vel.length();
    this.body.height = this.crouching ? 1.05 : 1.75;
    this.eye.set(this.body.pos.x, this.body.pos.y + (this.crouching ? 0.88 : 1.6), this.body.pos.z);
    this.center.set(this.body.pos.x, this.body.pos.y + this.body.height * 0.55, this.body.pos.z);
    this.forward.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    if (!this.alive) this.deadT += dt;
    if (!this.root) { for (const hs of this.hitSpheres) hs.set(0, -100, 0); this.rope.visible = false; this.hook.visible = false; return; }
    this.root.position.copy(this.body.pos); this.root.rotation.y = this.yaw + Math.PI;
    this._animate(dt);
    this.root.updateMatrixWorld(true);
    for (let i = 0; i < HIT.length; i++) this.hitSpheres[i].setFromMatrixPosition(this.parts[HIT[i][0]].matrixWorld);
    this._updateRope();
  }
  _updateRope() {
    const on = this.grappling && this.alive && !this.away; this.rope.visible = on; this.hook.visible = on; if (!on) return;
    _v.set(this.body.pos.x + this.right.x * 0.35, this.body.pos.y + 1.25, this.body.pos.z + this.right.z * 0.35);
    _v2.subVectors(this.gPoint, _v); const len = _v2.length(); if (len < 0.05) { this.rope.visible = false; return; }
    this.rope.position.copy(_v).addScaledVector(_v2, 0.5); this.rope.scale.set(1, len, 1); this.rope.quaternion.setFromUnitVectors(_up, _v2.divideScalar(len));
    this.hook.position.copy(this.gPoint);
  }
  _animate(dt) {
    const J = this.J, b = this.body; const sp = Math.hypot(b.vel.x, b.vel.z);
    this.walk = damp(this.walk, clamp(sp / 4, 0, 1), 10, dt); const w = this.walk;
    this.phase += dt * (sp * 2.2 + (sp > 0.4 ? 3 : 0)); const s = Math.sin(this.phase), c = Math.cos(this.phase);
    if (!this.alive) {
      // slumped on the page until they respawn
      J.hips.parent.rotation.x = damp(J.hips.parent.rotation.x, Math.PI / 2, 5, dt); if (this.face) { this.face.eyes.visible = false; this.face.xeyes.visible = true; }
      return;
    }
    J.hips.parent.rotation.x = damp(J.hips.parent.rotation.x, 0, 8, dt); if (this.face) { this.face.eyes.visible = true; this.face.xeyes.visible = false; }
    J.legL.rotation.x = s * 0.9 * w; J.legR.rotation.x = -s * 0.9 * w; J.shinL.rotation.x = Math.max(0, c) * 1.1 * w; J.shinR.rotation.x = Math.max(0, -c) * 1.1 * w;
    if (!b.onGround) { J.legL.rotation.x = -0.5; J.legR.rotation.x = 0.6; J.shinL.rotation.x = 1.0; J.shinR.rotation.x = 0.5; }
    // guns are carried up and forward, two hands on them, tilting with where they look; the
    // blade hangs at the side until it is raised to guard
    const blade = this.weaponIndex === WEAPON_KINDS.length - 1; const aim = blade ? 0 : (this.aiming ? 1 : sp > 6.5 ? 0.8 : 0.95);
    const look = clamp(this.pitch, -1.1, 1.1);
    if (blade) {
      const g = this.blocking ? 1 : 0;
      J.armR.rotation.x = -0.9 - g * 0.9 - s * 0.6 * w * (1 - g); J.armR.rotation.z = -0.3 - g * 0.5; J.foreR.rotation.x = -1.0 - g * 0.6; J.armL.rotation.x = s * 0.8 * w * (1 - g) - g * 1.4; J.foreL.rotation.x = -0.5;
    } else {
      J.armR.rotation.x = (-1.35 - look * 0.85) * aim - s * 0.6 * w * (1 - aim); J.armR.rotation.z = -0.2 * (1 - aim); J.foreR.rotation.x = -0.2;
      J.armL.rotation.x = (-1.25 - look * 0.85) * aim + s * 0.6 * w * (1 - aim); J.armL.rotation.y = 0.55 * aim; J.foreL.rotation.x = -0.45;
    }
    J.torso.rotation.x = -0.2 * w + (this.sliding ? 0.5 : 0) + (this.crouching ? 0.25 : 0); J.torso.rotation.y = -0.3 * aim;
    J.hips.position.y = (this.crouching ? 0.55 : 0.86) + Math.abs(c) * 0.07 * w;
    J.headG.rotation.x = clamp(-this.pitch, -0.7, 0.7) * 0.7;
    this.tagG.rotation.y = -this.root.rotation.y + (this.ctx.player ? Math.atan2(this.ctx.player.eye.x - this.body.pos.x, this.ctx.player.eye.z - this.body.pos.z) : 0);
  }
  dispose() { if (this.root) this.ctx.scene.remove(this.root); this.ctx.scene.remove(this.rope); this.ctx.scene.remove(this.hook); }
}
