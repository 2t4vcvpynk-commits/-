// キーボード / マウス / タッチ入力
import { PILLARS } from './arena.js';

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyJ: 'punch', KeyZ: 'punch',
  KeyK: 'kick', KeyX: 'kick',
  KeyL: 'block', KeyC: 'block',
  Space: 'jump',
  KeyU: 'skill1', KeyV: 'skill1',
  KeyI: 'skill2', KeyB: 'skill2',
  ShiftLeft: 'dodge', ShiftRight: 'dodge', KeyO: 'dodge',
  Tab: 'lock', KeyF: 'lock',
  KeyQ: 'camL', KeyE: 'camR',
};
const ACTIONS = new Set(['punch', 'kick', 'jump', 'skill1', 'skill2', 'dodge']);
const MOUSE_SENS = 0.0028;
const TOUCH_SENS = 0.008;
const KEY_TURN = 2.4;

export class PlayerInput {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.held = { block: false };
    this.stick = { x: 0, y: 0 };
    this.touchBlock = false;
    this.mouseBlock = false;
    this.enabled = false;
    this.move = { x: 0, z: 0 };
    this.lockOn = false;
    this.onLockChange = () => {};
    this.lookX = 0;
    this.canvas = null;

    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const a = KEYMAP[e.code];
      if (!a || !this.enabled) return;
      e.preventDefault();
      if (!e.repeat) {
        if (ACTIONS.has(a)) this.pressed.add(a);
        if (a === 'lock') this.toggleLock();
      }
      this.keys.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.keys.delete(a);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  toggleLock() {
    this.lockOn = !this.lockOn;
    this.onLockChange(this.lockOn);
  }

  // マウス: クリックで視点固定 → 移動で視点回転、左クリック=パンチ、右クリック=キック、ホイールクリック=ガード
  bindMouse(canvas) {
    this.canvas = canvas;
    canvas.addEventListener('mousedown', (e) => {
      if (!this.enabled) return;
      if (document.pointerLockElement !== canvas) {
        if (canvas.requestPointerLock && !matchMedia('(pointer: coarse)').matches) canvas.requestPointerLock();
        return;
      }
      if (e.button === 0) this.pressed.add('punch');
      else if (e.button === 2) this.pressed.add('kick');
      else if (e.button === 1) this.mouseBlock = true;
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 1) this.mouseBlock = false;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (this.enabled && document.pointerLockElement === canvas) this.lookX += e.movementX * MOUSE_SENS;
    });
  }

  releaseMouse() {
    if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }

  bindTouch(root) {
    const stickZone = root.querySelector('#stick');
    const knob = root.querySelector('#knob');
    let id = null;
    let ox = 0;
    let oy = 0;
    const R = 50;
    stickZone.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      const r = stickZone.getBoundingClientRect();
      ox = r.left + r.width / 2;
      oy = r.top + r.height / 2;
      stickZone.setPointerCapture(id);
      move(e);
    });
    const move = (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox;
      let dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) {
        dx = (dx / d) * R;
        dy = (dy / d) * R;
      }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      const m = Math.hypot(dx, dy) / R;
      this.stick.x = m < 0.2 ? 0 : dx / R;
      this.stick.y = m < 0.2 ? 0 : -dy / R;
    };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.stick.x = this.stick.y = 0;
      knob.style.transform = '';
    };
    stickZone.addEventListener('pointermove', move);
    stickZone.addEventListener('pointerup', end);
    stickZone.addEventListener('pointercancel', end);

    // 画面ドラッグで視点を回す
    const pad = root.querySelector('#lookpad');
    let lookId = null;
    let lastX = 0;
    pad.addEventListener('pointerdown', (e) => {
      lookId = e.pointerId;
      lastX = e.clientX;
      pad.setPointerCapture(lookId);
    });
    pad.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId) return;
      this.lookX += (e.clientX - lastX) * TOUCH_SENS;
      lastX = e.clientX;
    });
    const lookEnd = (e) => {
      if (e.pointerId === lookId) lookId = null;
    };
    pad.addEventListener('pointerup', lookEnd);
    pad.addEventListener('pointercancel', lookEnd);

    root.querySelectorAll('[data-act]').forEach((btn) => {
      const act = btn.dataset.act;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('on');
        if (act === 'block') this.touchBlock = true;
        else if (act === 'lock') this.toggleLock();
        else this.pressed.add(act);
      });
      const up = () => {
        btn.classList.remove('on');
        if (act === 'block') this.touchBlock = false;
      };
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('pointerleave', up);
    });
  }

  // 視点の回転量（ラジアン）を取り出す
  takeLook(dt) {
    let d = this.lookX;
    this.lookX = 0;
    if (this.keys.has('camL')) d -= KEY_TURN * dt;
    if (this.keys.has('camR')) d += KEY_TURN * dt;
    return d;
  }

  // basis: カメラの右方向 / 奥方向（XZ平面）
  update(_dt, _me, _target, basis) {
    let sx = this.stick.x;
    let sy = this.stick.y;
    if (this.keys.has('right')) sx += 1;
    if (this.keys.has('left')) sx -= 1;
    if (this.keys.has('up')) sy += 1;
    if (this.keys.has('down')) sy -= 1;
    const len = Math.hypot(sx, sy);
    if (len > 1) {
      sx /= len;
      sy /= len;
    }
    this.move.x = basis.right.x * sx + basis.fwd.x * sy;
    this.move.z = basis.right.z * sx + basis.fwd.z * sy;
    this.held.block = this.keys.has('block') || this.touchBlock || this.mouseBlock;
  }

  consume(a) {
    return this.pressed.delete(a);
  }

  endFrame() {
    this.pressed.clear();
  }

  reset() {
    this.keys.clear();
    this.pressed.clear();
    this.stick.x = this.stick.y = 0;
    this.touchBlock = false;
    this.mouseBlock = false;
    this.lookX = 0;
  }
}

// CPU（練習モード用）
const ATTACK_ANIMS = new Set(['p1', 'p2', 'p3', 'kick', 'air', 'special', 'beam', 'stomp']);

// CPUがその能力を今使いたいか
function wantSkill(id, d, me, target) {
  switch (id) {
    case 'fire': return d > 3 && !pillarDetour(me, target);
    case 'beam': return d < 14 && target.pos.y < 0.5;
    case 'timestop': return d < 5;
    case 'blink': return d > 4.5;
    case 'wave': return d < 2.8;
    case 'heal': return me.hp < me.maxHp * 0.6;
    default: return d < 5; // 加速・鋼の肉体・吸血
  }
}

// 自分→相手の直線上に柱があれば、よける向きを返す
function pillarDetour(me, target) {
  const dx = target.pos.x - me.pos.x;
  const dz = target.pos.z - me.pos.z;
  const len = Math.hypot(dx, dz) || 1;
  for (const p of PILLARS) {
    const px = p.x - me.pos.x;
    const pz = p.z - me.pos.z;
    const t = (px * dx + pz * dz) / len;
    if (t < 0 || t > len) continue;
    const cross = (px * dz - pz * dx) / len;
    if (Math.abs(cross) < p.r + 0.6) return cross > 0 ? 1 : -1;
  }
  return 0;
}

export class AIInput {
  constructor(level = 1) {
    this.level = level;
    this.lockOn = true;
    this.move = { x: 0, z: 0 };
    this.held = { block: false };
    this.pressed = new Set();
    this.thinkT = 0.5;
    this.blockT = 0;
    this.plan = { mx: 0, mz: 0 };
    this.queue = [];
    this.lastOppAnim = 'idle';
  }

  update(dt, me, target) {
    this.thinkT -= dt;
    this.blockT -= dt;
    const dx = target.pos.x - me.pos.x;
    const dz = target.pos.z - me.pos.z;
    const d = Math.hypot(dx, dz) || 1;
    const fx = dx / d;
    const fz = dz / d;

    // 相手の攻撃に反応してガード or 回避
    const oa = target.fighter.anim;
    if (ATTACK_ANIMS.has(oa) && oa !== this.lastOppAnim && d < 3.5) {
      const r = Math.random();
      if (r < 0.15 + this.level * 0.05) {
        const s = Math.random() < 0.5 ? 1 : -1;
        this.plan.mx = -fz * s;
        this.plan.mz = fx * s;
        this.pressed.add('dodge');
      } else if (r < 0.45 + this.level * 0.1) {
        this.blockT = 0.35 + Math.random() * 0.3;
      }
    }
    this.lastOppAnim = oa;

    for (let i = this.queue.length - 1; i >= 0; i--) {
      this.queue[i].t -= dt;
      if (this.queue[i].t <= 0) {
        this.pressed.add(this.queue[i].a);
        this.queue.splice(i, 1);
      }
    }

    // 超能力
    if (me.skillReady && !target.ko) {
      for (let k = 0; k < 2; k++) {
        if (me.skillReady(k) && Math.random() < dt * 0.9 && wantSkill(me.skills[k], d, me, target)) {
          this.pressed.add(`skill${k + 1}`);
        }
      }
    }

    if (this.thinkT <= 0) {
      this.thinkT = 0.18 + Math.random() * 0.3;
      const r = Math.random();
      this.plan.mx = 0;
      this.plan.mz = 0;
      if (d > 1.7) {
        let side = r < 0.2 ? (Math.random() < 0.5 ? 1 : -1) : 0;
        const det = pillarDetour(me, target);
        if (det) side = det * 1.5;
        this.plan.mx = fx - fz * side * 1.5;
        this.plan.mz = fz + fx * side * 1.5;
        if (r > 0.93) this.pressed.add('jump');
      } else if (target.pos.y < 0.8) {
        if (r < 0.5) {
          const n = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < n; i++) this.queue.push({ a: 'punch', t: i * 0.22 });
          this.thinkT = 0.3 + n * 0.22;
        } else if (r < 0.75) {
          this.pressed.add('kick');
          this.thinkT = 0.6;
        } else if (r < 0.85) {
          this.plan.mx = -fx;
          this.plan.mz = -fz;
        } else {
          this.plan.mx = -fz;
          this.plan.mz = fx;
        }
      }
    }
    const l = Math.hypot(this.plan.mx, this.plan.mz);
    this.move.x = l > 0 ? this.plan.mx / l : 0;
    this.move.z = l > 0 ? this.plan.mz / l : 0;
    this.held.block = this.blockT > 0;
  }

  takeLook() {
    return 0;
  }

  consume(a) {
    return this.pressed.delete(a);
  }

  endFrame() {
    this.pressed.clear();
  }

  reset() {
    this.pressed.clear();
    this.queue.length = 0;
    this.blockT = 0;
  }
}
