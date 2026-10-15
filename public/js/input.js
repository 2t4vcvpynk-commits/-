// キーボード / タッチ入力
const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyJ: 'punch', KeyZ: 'punch',
  KeyK: 'kick', KeyX: 'kick',
  KeyL: 'block', KeyC: 'block', ShiftLeft: 'block',
  Space: 'jump',
  KeyU: 'special', KeyV: 'special',
};
const ACTIONS = new Set(['punch', 'kick', 'jump', 'special']);

export class PlayerInput {
  constructor() {
    this.keys = new Set();
    this.pressed = new Set();
    this.held = { block: false };
    this.stick = { x: 0, y: 0 };
    this.touchBlock = false;
    this.enabled = false;
    this.move = { x: 0, z: 0 };

    window.addEventListener('keydown', (e) => {
      const tag = e.target && e.target.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const a = KEYMAP[e.code];
      if (!a || !this.enabled) return;
      e.preventDefault();
      if (!e.repeat && ACTIONS.has(a)) this.pressed.add(a);
      this.keys.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.keys.delete(a);
    });
    window.addEventListener('blur', () => this.keys.clear());
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

    root.querySelectorAll('[data-act]').forEach((btn) => {
      const act = btn.dataset.act;
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        btn.classList.add('on');
        if (act === 'block') this.touchBlock = true;
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
    this.held.block = this.keys.has('block') || this.touchBlock;
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
  }
}

// CPU（練習モード用）
const ATTACK_ANIMS = new Set(['p1', 'p2', 'p3', 'kick', 'air', 'special']);

export class AIInput {
  constructor(level = 1) {
    this.level = level;
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

    // 相手の攻撃に反応してガード
    const oa = target.fighter.anim;
    if (ATTACK_ANIMS.has(oa) && oa !== this.lastOppAnim && d < 3.5 && Math.random() < 0.35 + this.level * 0.1) {
      this.blockT = 0.35 + Math.random() * 0.3;
    }
    this.lastOppAnim = oa;

    // 予約した入力
    for (let i = this.queue.length - 1; i >= 0; i--) {
      this.queue[i].t -= dt;
      if (this.queue[i].t <= 0) {
        this.pressed.add(this.queue[i].a);
        this.queue.splice(i, 1);
      }
    }

    if (this.thinkT <= 0) {
      this.thinkT = 0.18 + Math.random() * 0.3;
      const r = Math.random();
      this.plan.mx = 0;
      this.plan.mz = 0;
      if (me.meter >= 100 && d > 3 && r < 0.5) {
        this.pressed.add('special');
      } else if (d > 1.7) {
        const side = r < 0.2 ? (Math.random() < 0.5 ? 1 : -1) : 0;
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
