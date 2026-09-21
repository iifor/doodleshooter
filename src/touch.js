// On-screen touch controls: floating joystick, drag-to-look and one button per PC action.
// Everything is fed into Input (setAction / touchMove / touchLook), so the game code never knows.
// Buttons can be moved, resized and faded in the layout editor (openEditor); positions are stored as screen fractions.

// stick offset in px -> game move vector. y is up = forward. mag has the dead zone removed, raw does not.
export function stickVector(dx, dy, R, dead = 0.12) {
  const len = Math.hypot(dx, dy), raw = Math.min(1, len / R);
  if (raw < dead) return { x: 0, y: 0, mag: 0, raw };
  const mag = (raw - dead) / (1 - dead);
  return { x: (dx / len) * mag, y: (-dy / len) * mag, mag, raw };
}

// 24x24 stroke icons, one per action (digits on the weapon slots stay as text)
const ICONS = {
  fire: '<circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
  aim: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/>',
  block: '<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/>',
  jump: '<path d="M6 13l6-6 6 6M6 19l6-6 6 6"/>',
  crouch: '<path d="M6 9l6 6 6-6M5 20h14"/>',
  dash: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
  grapple: '<circle cx="12" cy="5" r="2"/><path d="M12 7v13M7 11h10M5 14a7 7 0 0 0 14 0"/>',
  reload: '<path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5"/>',
  grenade: '<circle cx="12" cy="14" r="6"/><path d="M10 8h4l1-3M15 5l3-1"/>',
  melee: '<path d="M20 4L10 14M7 11l6 6M10 14l-6 6"/>',
  board: '<path d="M5 20V10M12 20V4M19 20v-7"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
};
const icon = (k) => (ICONS[k] ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>` : k);

const SPRINT_AT = 0.92, LOOK_PX = 0.0045, MIN_HOLD_MS = 50, DEFAULT_SENS = 200, ASK_AFTER_MS = 20000, ASK_MAX = 3;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// [action, icon, side, x, y, size, opts]  default spot: x/y in button units from the side / bottom (top for 't'); c = centre offset
// opts.key is the layout key (defaults to the action; two buttons can share an action)
const BUTTONS = [
  ['fire', 'fire', 'r', 0.5, 0.3, 1.5, { look: 1 }],
  ['jump', 'jump', 'r', 2.3, 0.3, 1.1],
  ['crouch', 'crouch', 'r', 3.6, 0.3, 1.0],
  ['aim', 'aim', 'r', 0.5, 1.95, 1.1, { look: 1, id: 'aim' }],
  ['dash', 'dash', 'r', 1.8, 1.95, 1.1, { id: 'dash' }],
  ['grapple', 'grapple', 'r', 3.1, 1.95, 1.1],
  ['reload', 'reload', 'r', 0.5, 3.3, 0.9],
  ['grenade', 'grenade', 'r', 1.6, 3.3, 0.9],
  ['melee', 'melee', 'r', 2.7, 3.3, 0.9],
  ['fire', 'fire', 'l', 0.5, 2.7, 1.1, { look: 1, key: 'fireL' }],
  ['slot1', '1', 'c', -1.4, 0.3, 0.75], ['slot2', '2', 'c', -0.47, 0.3, 0.75], ['slot3', '3', 'c', 0.47, 0.3, 0.75], ['slot4', '4', 'c', 1.4, 0.3, 0.75],
  ['score', 'board', 't', -0.6, 0.3, 0.7, { id: 'board' }],
  ['pause', 'pause', 't', 0.6, 0.3, 0.7],
];
const NAMES = { fire: 'Fire', fireL: 'Fire (left)', jump: 'Jump', crouch: 'Slide', aim: 'Scope / Block', dash: 'Dash', grapple: 'Hook', reload: 'Reload', grenade: 'Grenade', melee: 'Slash', slot1: 'Weapon 1', slot2: 'Weapon 2', slot3: 'Weapon 3', slot4: 'Weapon 4', score: 'Scoreboard', pause: 'Pause', stick: 'Joystick' };

export class Touch {
  // state() -> { weapon: index, katana: bool, dashReady: bool, online: bool }
  constructor(input, state) {
    this.input = input; this.state = state; this.pointers = new Map(); this.gen = {}; this.btns = []; this.editing = false; this.sel = null; this.played = 0; this._last = 0;
    let saved = {}; try { saved = JSON.parse(localStorage.getItem('doodle_touch') || '{}'); } catch (e) { /* ignore */ }
    if (saved.v !== 2) { saved.sens = DEFAULT_SENS; saved.v = 2; } // v2: default look speed raised to 200%, earlier saves get it once
    this.cfg = { sens: DEFAULT_SENS, size: 100, opacity: 80, fixed: false, layout: {}, asked: false, askCount: 0, ...saved };
    const root = this.root = document.getElementById('touch');
    root.innerHTML = '<div class="tz tzl"></div><div class="tz tzr"></div><div class="tring"><i></i></div>';
    this.ring = root.querySelector('.tring'); this.knob = this.ring.firstChild; this.stickB = { key: 'stick', el: this.ring, stick: true };
    this._wire(root.querySelector('.tzl'), (e) => this._stickDown(e), (e) => this._stickMove(e), () => this._stickUp());
    this._wire(root.querySelector('.tzr'), (e) => this._lookDown(e), (e) => this._lookMove(e), () => {});
    this._wire(this.ring, (e) => { if (this.editing) this._editDown(this.stickB, e); }, (e) => { if (this.editing) this._editMove(e); }, () => {});
    for (const def of BUTTONS) {
      const [action, label, , , , , o = {}] = def;
      const el = document.createElement('div'); el.className = 'tb'; el.innerHTML = icon(label); el.setAttribute('aria-label', action); root.appendChild(el);
      const b = { action, el, def, key: o.key || action, look: !!o.look, id: o.id, down: false };
      this.btns.push(b); if (o.id) this[o.id + 'El'] = el;
      this._wire(el, (e) => (this.editing ? this._editDown(b, e) : this._press(b, e)),
        (e) => { if (this.editing) this._editMove(e); else if (b.look) this._lookMove(e); },
        () => { if (!this.editing) this._release(b); });
    }
    this._buildCard(); this._buildBar();
    this.applyCfg(); window.addEventListener('resize', () => this.applyLayout());
    this._vis = false; this._kat = null; this._w = -1;
  }

  _wire(el, down, move, up) {
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ } down(e); });
    el.addEventListener('pointermove', (e) => { if (this.pointers.has(e.pointerId)) move(e); });
    for (const t of ['pointerup', 'pointercancel']) el.addEventListener(t, (e) => { if (this.pointers.has(e.pointerId)) up(e); this.pointers.delete(e.pointerId); });
  }

  applyCfg() {
    const c = this.cfg, s = this.root.style;
    s.setProperty('--ts', c.size / 100); s.setProperty('--topa', c.opacity / 100); this.root.classList.toggle('fixed', c.fixed);
    try { localStorage.setItem('doodle_touch', JSON.stringify(c)); } catch (e) { /* ignore */ }
    this.applyLayout();
  }

  // ---- layout: default spots come from BUTTONS, anything moved lives in cfg.layout as screen fractions ----
  _B() { return Math.min(innerHeight * 0.16, 84) * this.cfg.size / 100; }
  // centre (px), diameter, size factor and opacity of a button (or the stick)
  pos(b) {
    const W = innerWidth, H = innerHeight, B = this._B(), L = this.cfg.layout[b.key] || {}, k = L.k ?? 1, o = L.o ?? 1;
    if (b.stick) return { cx: (L.x ?? 2.2 * B / W) * W, cy: (L.y ?? (H - 2 * B) / H) * H, d: B * 2.4 * k, k, o };
    const [, , side, x, y, size] = b.def, d = B * size;
    let cx, cy;
    if (side === 'r') { cx = W - x * B - d / 2; cy = H - y * B - d / 2; }
    else if (side === 'l') { cx = x * B + d / 2; cy = H - y * B - d / 2; }
    else if (side === 'c') { cx = W / 2 + x * B; cy = H - y * B - d / 2; }
    else { cx = W / 2 + x * B; cy = y * B + d / 2; }
    return { cx: (L.x ?? cx / W) * W, cy: (L.y ?? cy / H) * H, d: d * k, k, o };
  }
  applyLayout() {
    for (const b of [...this.btns, this.stickB]) {
      const p = this.pos(b), s = b.el.style; s.setProperty('--po', p.o); s.left = p.cx + 'px'; s.top = p.cy + 'px';
      if (b.stick) s.setProperty('--rk', p.k); // floating mode overwrites left/top on touch
      else s.setProperty('--d', p.d + 'px');
    }
  }
  _L(b) { const l = this.cfg.layout; if (!l[b.key]) { const p = this.pos(b); l[b.key] = { x: p.cx / innerWidth, y: p.cy / innerHeight, k: 1, o: 1 }; } return l[b.key]; }

  // ---- layout editor ----
  _buildBar() {
    const bar = this.bar = document.createElement('div'); bar.id = 'tbar';
    bar.innerHTML = `<b id="tsel">Drag a button to move it. Tap to select.</b>
      <label>Size <input type="range" id="tbk" min="50" max="200" step="5"><span></span></label>
      <label>Opacity <input type="range" id="tbo" min="20" max="100" step="5"><span></span></label>
      <label>All buttons <input type="range" id="tbg" min="20" max="100" step="5"><span></span></label>
      <label class="chk"><input type="checkbox" id="tbf"> Fixed joystick</label>
      <div class="row"><button type="button" id="tbr">Reset</button><button type="button" id="tbc">Cancel</button><button type="button" id="tbs" class="go">Save</button></div>`;
    document.body.appendChild(bar);
    const q = (id) => bar.querySelector('#' + id), out = (el, v) => { el.nextElementSibling.textContent = v + '%'; };
    for (const ev of ['pointerdown', 'click']) bar.addEventListener(ev, (e) => e.stopPropagation());
    q('tbk').addEventListener('input', (e) => { if (!this.sel) return; this._L(this.sel).k = e.target.value / 100; out(e.target, e.target.value); this.applyLayout(); });
    q('tbo').addEventListener('input', (e) => { if (!this.sel) return; this._L(this.sel).o = e.target.value / 100; out(e.target, e.target.value); this.applyLayout(); });
    q('tbg').addEventListener('input', (e) => { this.cfg.opacity = Number(e.target.value); out(e.target, e.target.value); this.root.style.setProperty('--topa', this.cfg.opacity / 100); });
    q('tbf').addEventListener('change', (e) => { this.cfg.fixed = e.target.checked; this.root.classList.toggle('fixed', this.cfg.fixed); });
    q('tbr').addEventListener('click', () => { this.cfg.layout = {}; this.applyLayout(); this._syncBar(); });
    q('tbc').addEventListener('click', () => this.closeEditor(false));
    q('tbs').addEventListener('click', () => this.closeEditor(true));
  }
  openEditor() {
    if (this.editing) return;
    this.releaseAll(); this.editing = true; this.sel = null; this.backup = JSON.stringify({ layout: this.cfg.layout, opacity: this.cfg.opacity, fixed: this.cfg.fixed });
    this.root.classList.add('on', 'editing'); document.body.classList.add('tedit'); this._syncBar(); this.applyLayout();
  }
  closeEditor(save) {
    if (!this.editing) return;
    if (!save) Object.assign(this.cfg, JSON.parse(this.backup));
    this.editing = false; this.sel = null; this.pointers.clear(); this._vis = null;
    for (const b of [...this.btns, this.stickB]) b.el.classList.remove('sel');
    this.root.classList.remove('editing'); document.body.classList.remove('tedit'); this.applyCfg();
  }
  _syncBar() {
    const bar = this.bar, q = (id) => bar.querySelector('#' + id), p = this.sel && this.pos(this.sel);
    q('tsel').textContent = this.sel ? NAMES[this.sel.key] : 'Drag a button to move it. Tap to select.';
    for (const [id, v] of [['tbk', p ? Math.round(p.k * 100) : 100], ['tbo', p ? Math.round(p.o * 100) : 100], ['tbg', this.cfg.opacity]]) {
      const el = q(id); el.value = v; el.disabled = id !== 'tbg' && !this.sel; el.nextElementSibling.textContent = v + '%';
    }
    q('tbf').checked = this.cfg.fixed; this._placeBar();
    for (const b of [...this.btns, this.stickB]) b.el.classList.toggle('sel', b === this.sel);
  }
  // keep the panel on the opposite side of the selected button so it never covers what you are moving
  _placeBar() { const p = this.sel && this.pos(this.sel); this.bar.style.left = !p ? '50%' : p.cx < innerWidth / 2 ? '73%' : '27%'; }
  _editDown(b, e) { const p = this.pos(b); this.sel = b; this.pointers.set(e.pointerId, { kind: 'edit', b, dx: e.clientX - p.cx, dy: e.clientY - p.cy }); this._syncBar(); }
  _editMove(e) {
    const p = this.pointers.get(e.pointerId); if (!p || p.kind !== 'edit') return;
    const L = this._L(p.b); L.x = clamp((e.clientX - p.dx) / innerWidth, 0.03, 0.97); L.y = clamp((e.clientY - p.dy) / innerHeight, 0.05, 0.95); this.applyLayout(); this._placeBar();
  }

  // ---- sensitivity check: defaults high, then ask a few times whether the look speed feels right ----
  _buildCard() {
    const c = this.card = document.createElement('div'); c.className = 'tcard';
    c.innerHTML = '<b>Look speed <span></span></b><div><button type="button" data-d="-1">Slower</button><button type="button" data-d="0" class="go">Just right</button><button type="button" data-d="1">Faster</button></div>';
    this.root.appendChild(c);
    c.addEventListener('pointerdown', (e) => e.stopPropagation());
    c.addEventListener('click', (e) => {
      const d = e.target.dataset && e.target.dataset.d; if (d == null) return;
      if (d === '0') { this.cfg.asked = true; this._hideCard(); } else { this.cfg.sens = clamp(Math.round(this.cfg.sens * (d > 0 ? 1.25 : 0.8) / 5) * 5, 40, 400); this._showCard(); }
      this.applyCfg();
    });
  }
  _showCard() { this.card.querySelector('span').textContent = this.cfg.sens + '%'; this.card.classList.add('show'); clearTimeout(this._cardT); this._cardT = setTimeout(() => this._hideCard(), 12000); }
  _hideCard() { this.card.classList.remove('show'); clearTimeout(this._cardT); }

  // ---- joystick ----
  _stickDown(e) {
    if ([...this.pointers.values()].some((p) => p.kind === 'stick')) return;
    const fixed = this.cfg.fixed, r = this.ring;
    if (!fixed) { r.style.left = e.clientX + 'px'; r.style.top = e.clientY + 'px'; }
    r.classList.add('on'); const rc = r.getBoundingClientRect();
    this.pointers.set(e.pointerId, { kind: 'stick', ox: fixed ? rc.left + rc.width / 2 : e.clientX, oy: fixed ? rc.top + rc.height / 2 : e.clientY, R: rc.width / 2 });
    this.input.wake(); this._stickMove(e);
  }
  _stickMove(e) {
    const p = this.pointers.get(e.pointerId); if (!p) return;
    const dx = e.clientX - p.ox, dy = e.clientY - p.oy, v = stickVector(dx, dy, p.R), len = Math.hypot(dx, dy) || 1, k = Math.min(1, p.R / len);
    this.input.touchMove.x = v.x; this.input.touchMove.y = v.y; this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
    const sprint = v.raw >= SPRINT_AT; if (sprint !== !!this.input.keys.sprint) this.input.setAction('sprint', sprint);
    this.input.wake();
  }
  _stickUp() {
    this.input.touchMove.x = 0; this.input.touchMove.y = 0; this.input.setAction('sprint', false);
    this.knob.style.transform = ''; if (!this.cfg.fixed) this.ring.classList.remove('on');
  }

  // ---- look ----
  _lookDown(e) { this.pointers.set(e.pointerId, { kind: 'look', x: e.clientX, y: e.clientY }); this.input.wake(); }
  _lookMove(e) {
    const p = this.pointers.get(e.pointerId); if (!p || p.kind !== 'look') return;
    const k = LOOK_PX * this.cfg.sens / 100;
    this.input.touchLook.x -= (e.clientX - p.x) * k; this.input.touchLook.y -= (e.clientY - p.y) * k; p.x = e.clientX; p.y = e.clientY; this.input.wake();
  }

  // ---- buttons ----
  _press(b, e) {
    const inp = this.input, a = b.action; b.down = true; b.el.classList.add('down'); b.at = performance.now(); this.gen[a] = (this.gen[a] || 0) + 1;
    this.pointers.set(e.pointerId, b.look ? { kind: 'look', x: e.clientX, y: e.clientY } : { kind: 'btn' });
    if (b.id === 'aim' && !this.state().katana) { inp.setAction('aim', !inp.keys.aim); return; } // guns toggle, katana block is held
    inp.setAction(a, true);
  }
  _release(b) {
    const a = b.action; b.down = false; b.el.classList.remove('down');
    if (b.id === 'aim' && !this.state().katana) return;
    const gen = this.gen[a], wait = Math.max(0, MIN_HOLD_MS - (performance.now() - b.at)); // a quick tap must live for a whole frame
    if (wait) setTimeout(() => { if (this.gen[a] === gen) this.input.setAction(a, false); }, wait); else this.input.setAction(a, false);
  }

  releaseAll() {
    for (const b of this.btns) { b.down = false; b.el.classList.remove('down'); this.input.setAction(b.action, false); }
    this._stickUp(); this.pointers.clear();
  }

  fullscreen() {
    const el = document.documentElement; if (document.fullscreenElement || !el.requestFullscreen) return;
    try { const p = el.requestFullscreen({ navigationUI: 'hide' }); if (p && p.then) p.then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape')).catch(() => {}); } catch (e) { /* ignore */ }
  }

  // called every frame; visible = touch device, in the game, no menu open
  update(visible) {
    if (this.editing) return;
    if (visible !== this._vis) { this._vis = visible; this.root.classList.toggle('on', visible); if (!visible) this.releaseAll(); }
    const now = performance.now();
    if (!visible) { this._last = 0; return; }
    this.played += this._last ? Math.min(100, now - this._last) : 0; this._last = now;
    if (!this.cfg.asked && this.cfg.askCount < ASK_MAX && this.played > ASK_AFTER_MS) { this.played = -1e9; this.cfg.askCount++; this._showCard(); this.applyCfg(); }
    const s = this.state();
    if (s.katana !== this._kat) { this._kat = s.katana; this.aimEl.innerHTML = icon(s.katana ? 'block' : 'aim'); this.input.setAction('aim', false); }
    if (s.weapon !== this._w) { this._w = s.weapon; for (const b of this.btns) if (b.action.startsWith('slot')) b.el.classList.toggle('active', b.action === 'slot' + (s.weapon + 1)); }
    this.aimEl.classList.toggle('on', !!this.input.keys.aim); this.dashEl.classList.toggle('ready', !!s.dashReady); this.boardEl.classList.toggle('gone', !s.online);
  }
}
