// ゲーム本体: シーン・プレイヤー操作・リモート同期・練習モード
import * as THREE from 'three';
import { Fighter } from './fighter.js';
import { buildArena, ARENA_RADIUS, WALL_RADIUS, PILLARS } from './arena.js';
import { Effects, Fireball, Beam, groundRing, stopSphere } from './fx.js';
import { PlayerInput, AIInput } from './input.js';
import { hud } from './hud.js';
import { sfx } from './sfx.js';
import { Room, METER_MAX } from './shared/room.js';
import { statMods, SKILLS, randomProfile } from './shared/profile.js';

// 技データ（時間は秒）
const ATK = {
  p1: { dur: 0.28, a0: 0.06, a1: 0.16, range: 1.5, step: 1.2 },
  p2: { dur: 0.3, a0: 0.07, a1: 0.17, range: 1.55, step: 1.5 },
  p3: { dur: 0.5, a0: 0.15, a1: 0.28, range: 1.5, step: 3 },
  kick: { dur: 0.55, a0: 0.17, a1: 0.32, range: 1.95, step: 1.8 },
  air: { dur: 0.45, a0: 0.05, a1: 0.38, range: 1.7, step: 0 },
  special: { dur: 0.62, fire: 0.26, step: 0 },
  dodge: { dur: 0.42, inv0: 0.02, inv1: 0.32, step: 0 },
  cast: { dur: 0.5, step: 0 },
  beam: { dur: 2.1, step: 0 },
  stomp: { dur: 0.55, a0: 0.27, step: 0 },
};
const ATTACKS = new Set(['p1', 'p2', 'p3', 'kick', 'air', 'special', 'beam']);
const MELEE = new Set(['p1', 'p2', 'p3', 'kick', 'air']);
const BUFF_SKILLS = ['accel', 'armor', 'vamp'];
const BEAM_DELAY = 0.7;
const WAVE_RADIUS = 3.4;
const DODGE_SPEED = 14;
const DODGE_COOLDOWN = 0.55;
// [のけぞり時間, ふっとび速度]
const STUN = {
  p1: [0.3, 2.5], p2: [0.3, 3], p3: [0.55, 7.5], kick: [0.55, 8.5], air: [0.45, 5], fire: [0.65, 9],
  beam: [0.28, 2.2], wave: [0.65, 10],
};
const HEAVY = new Set(['p3', 'kick', 'air', 'fire', 'wave']);
const SPAWN_X = [-5, 5];
const SEND_INTERVAL = 0.05;
const INTERP_DELAY = 100;

function angleLerp(a, b, k) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}

// 自分で操作する（またはCPUが操作する）ファイター
class Controller {
  constructor(game, fighter, input, channel, idx) {
    this.game = game;
    this.fighter = fighter;
    this.input = input;
    this.channel = channel;
    this.idx = idx;
    this.pos = new THREE.Vector3();
    this.kb = new THREE.Vector3();
    this.facing = new THREE.Vector3(0, 0, 1);
    this.vy = 0;
    this.onGround = true;
    this.mods = statMods(fighter.profile);
    this.maxHp = this.mods.maxHp;
    this.hp = this.maxHp;
    this.meter = 0;
    this.actId = 0;
    this.speedMul = this.mods.spd;
    this.skills = fighter.profile.skills;
    this.target = null;
    this.spawn();
  }

  get ko() {
    return this.isKO;
  }

  spawn() {
    const x = SPAWN_X[this.idx];
    this.pos.set(x, 0, 0);
    this.kb.set(0, 0, 0);
    this.vy = 0;
    this.onGround = true;
    this.act = null;
    this.stun = 0;
    this.stunKind = 'hit';
    this.blocking = false;
    this.lastBlk = false;
    this.lastInv = false;
    this.dodgeCd = 0;
    this.isKO = false;
    this.won = false;
    this.winT = 0;
    this.combo = 0;
    this.comboT = 0;
    this.buffer = null;
    this.bufferT = 0;
    this.airUsed = false;
    this.frozen = true;
    this.moving = 0;
    this.sendT = 0;
    this.skillCd = [0, 0];
    this.buffs = { accel: 0, armor: 0, vamp: 0 };
    this.stopT = 0;
    this.pendingHit = null;
    this.fighter.root.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    this.fighter.root.position.copy(this.pos);
    this.fighter.play('idle', true);
    this.input.reset();
  }

  onMessage(m) {
    const i = this.idx;
    switch (m.t) {
      case 'match':
        this.meter = 0;
        break;
      case 'round':
        this.hp = m.hp[i];
        this.meter = m.meter[i];
        this.spawn();
        break;
      case 'fight':
        this.frozen = false;
        break;
      case 'hit':
        this.hp = m.hp[i];
        this.meter = m.meter[i];
        if (m.by !== i) this.takeHit(m);
        break;
      case 'meter':
        this.meter = m.meter[i];
        break;
      case 'ability':
        this.hp = m.hp[i];
        this.meter = m.meter[i];
        if (m.id === 'timestop' && m.by !== i) {
          this.stopT = m.dur / 1000;
          this.act = null;
          this.buffer = null;
          this.sendT = 0;
        }
        break;
      case 'roundEnd':
        this.stopT = 0;
        this.pendingHit = null;
        this.frozen = true;
        this.act = null;
        this.buffer = null;
        if (m.winner === i) this.winT = 1.3;
        break;
    }
  }

  takeHit(m) {
    // 時間停止中は、止まっている間の攻撃をためておいて解除後にまとめて受ける
    if (this.stopT > 0 && this.hp > 0) {
      if (!this.pendingHit || HEAVY.has(m.kind)) this.pendingHit = m;
      return;
    }
    this.stopT = 0;
    const t = this.target;
    const dir = new THREE.Vector3(this.pos.x - t.pos.x, 0, this.pos.z - t.pos.z);
    if (dir.lengthSq() < 1e-6) dir.copy(this.facing).negate();
    dir.normalize();
    this.actId++;
    this.buffer = null;
    if (this.hp <= 0) {
      this.isKO = true;
      this.act = null;
      this.stun = 0;
      this.kb.copy(dir).multiplyScalar(7);
      this.vy = 5;
      this.onGround = false;
      this.fighter.play('ko', true);
    } else if (this.buffs.armor > 0) {
      // 鋼の肉体: ひるまない
      this.kb.addScaledVector(dir, 0.8);
      return;
    } else if (m.blocked) {
      this.stun = 0.16;
      this.stunKind = 'blockhit';
      this.kb.addScaledVector(dir, 2.4);
    } else {
      const [st, kv] = STUN[m.kind];
      this.stun = st;
      this.stunKind = 'hit';
      this.act = null;
      this.kb.copy(dir).multiplyScalar(kv);
      if (m.kind === 'p3' && this.onGround) {
        this.vy = 4.5;
        this.onGround = false;
      }
    }
    this.fighter.play(this.isKO ? 'ko' : this.stunKind, true);
    this.sendT = 0;
  }

  startAct(kind) {
    // 攻撃は近くの相手（ロックオン中は常に相手）へ振り向いてから出す
    const t = this.target;
    if (ATTACKS.has(kind) && t && !t.ko) {
      const dx = t.pos.x - this.pos.x;
      const dz = t.pos.z - this.pos.z;
      if (this.input.lockOn || Math.hypot(dx, dz) < 3.5) {
        this.fighter.root.rotation.y = Math.atan2(dx, dz);
        this.facing.set(Math.sin(this.fighter.root.rotation.y), 0, Math.cos(this.fighter.root.rotation.y));
      }
    }
    this.act = { kind, t: 0, hit: false, fired: false };
    this.actId++;
    this.fighter.play(kind, true);
    this.kb.addScaledVector(this.facing, ATK[kind].step);
    if (kind[0] === 'p') this.comboT = ATK[kind].dur + 0.35;
    if (kind === 'air') this.airUsed = true;
    if (kind !== 'special') sfx('whoosh');
    this.sendT = 0;
  }

  get invincible() {
    const a = this.act;
    return !!a && a.kind === 'dodge' && a.t >= ATK.dodge.inv0 && a.t <= ATK.dodge.inv1;
  }

  // 回避ステップ: スティックの方向（入力なしなら後ろ）へ素早く移動、途中は無敵
  startDodge() {
    const dir = new THREE.Vector3(this.input.move.x, 0, this.input.move.z);
    if (dir.lengthSq() < 0.04) dir.copy(this.facing).negate();
    dir.normalize();
    this.startAct('dodge');
    this.kb.copy(dir).multiplyScalar(DODGE_SPEED);
    this.dodgeCd = ATK.dodge.dur + DODGE_COOLDOWN;
    this.combo = 0;
  }

  checkHit(a) {
    const t = this.target;
    if (!t || t.ko) return;
    const spec = ATK[a.kind];
    const dx = t.pos.x - this.pos.x;
    const dz = t.pos.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > spec.range) return;
    if (d > 0.3 && (dx * this.facing.x + dz * this.facing.z) / d < 0.35) return;
    const dy = t.pos.y - this.pos.y;
    if (a.kind === 'air') {
      if (dy > 0.7 || dy < -2.2) return;
    } else if (Math.abs(dy) > (a.kind === 'kick' ? 1.1 : 0.9)) {
      return;
    }
    a.hit = true;
    this.channel.send({ t: 'hit', kind: a.kind });
  }

  fireSpecial() {
    const dir = this.facing.clone();
    const p = this.pos.clone().addScaledVector(dir, 0.7);
    p.y += 1.3 * this.fighter.profile.height;
    this.game.spawnFireball(this.idx, p, dir, this);
  }

  skillReady(slot) {
    const def = SKILLS[this.skills[slot]];
    return this.skillCd[slot] <= 0 && (!def.sp || this.meter >= METER_MAX);
  }

  faceTarget() {
    const t = this.target;
    if (!t || t.ko) return;
    this.fighter.root.rotation.y = Math.atan2(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    this.facing.set(Math.sin(this.fighter.root.rotation.y), 0, Math.cos(this.fighter.root.rotation.y));
  }

  // 超能力を使う
  useSkill(slot) {
    const id = this.skills[slot];
    const def = SKILLS[id];
    if (!this.skillReady(slot)) {
      if (this.input instanceof PlayerInput) sfx('denied');
      return;
    }
    if (!this.onGround && id !== 'blink') return;
    this.skillCd[slot] = def.cd;
    if (def.sp) this.meter = 0;
    const h = this.fighter.profile.height;
    const msg = { t: 'ability', id, x: this.pos.x, y: this.pos.y, z: this.pos.z, dx: this.facing.x, dz: this.facing.z };
    const g = this.game;
    switch (id) {
      case 'fire':
        this.faceTarget();
        this.startAct('special');
        break;
      case 'beam': {
        this.faceTarget();
        this.startAct('beam');
        const o = this.pos.clone().addScaledVector(this.facing, 0.8);
        o.y += 1.3 * h;
        Object.assign(msg, { x: o.x, y: o.y, z: o.z, dx: this.facing.x, dz: this.facing.z });
        g.spawnBeam(this.idx, o, this.facing, this);
        break;
      }
      case 'wave':
        this.startAct('stomp');
        g.spawnWave(this.idx, this.pos, ATK.stomp.a0);
        break;
      case 'blink': {
        const t = this.target;
        const from = this.pos.clone();
        const dest = new THREE.Vector3();
        if (t && !t.ko) {
          const r = t.fighter.root.rotation.y;
          dest.set(t.pos.x - Math.sin(r) * 1.3, 0, t.pos.z - Math.cos(r) * 1.3);
        } else {
          dest.copy(this.pos).addScaledVector(this.facing, 5);
        }
        const dr = Math.hypot(dest.x, dest.z);
        if (dr > ARENA_RADIUS) dest.multiplyScalar(ARENA_RADIUS / dr);
        dest.y = this.pos.y;
        this.pos.copy(dest);
        this.kb.set(0, 0, 0);
        this.faceTarget();
        this.fighter.root.position.copy(this.pos);
        g.blinkFx(from, this.pos);
        this.actId++;
        break;
      }
      default: // accel / armor / vamp / heal / timestop
        this.startAct('cast');
        if (BUFF_SKILLS.includes(id)) this.buffs[id] = id === 'vamp' ? 6 : 5;
    }
    g.onSkillStart(this, id);
    this.channel.send(msg);
    this.sendT = 0;
  }

  // 衝撃波の当たり判定
  waveHit() {
    const t = this.target;
    if (!t || t.ko) return;
    const d = Math.hypot(t.pos.x - this.pos.x, t.pos.z - this.pos.z);
    if (d < WAVE_RADIUS && t.pos.y < 1.6) this.channel.send({ t: 'hit', kind: 'wave' });
  }

  update(dt, basis) {
    const f = this.fighter;
    const inp = this.input;
    const tgt = this.target;
    inp.update(dt, this, tgt, basis);

    // 時間を止められている間は何もできない
    if (this.stopT > 0) {
      this.stopT -= dt;
      inp.endFrame();
      if (this.stopT <= 0 && this.pendingHit) {
        const m = this.pendingHit;
        this.pendingHit = null;
        this.takeHit(m);
      }
      this.sendT -= dt;
      if (this.sendT <= 0) this.sendState();
      return;
    }

    const live = !this.frozen && !this.isKO;
    for (const k of BUFF_SKILLS) if (this.buffs[k] > 0) this.buffs[k] -= dt;
    if (!live) this.buffs.accel = 0;
    this.skillCd[0] -= dt;
    this.skillCd[1] -= dt;
    // 時間加速中は技の速さもアップ
    const ts = this.buffs.accel > 0 ? 1.6 : 1;

    if (this.stun > 0) this.stun -= dt;
    this.dodgeCd -= dt;
    this.comboT -= dt;
    this.bufferT -= dt;
    if (live) {
      for (const a of ['punch', 'kick', 'skill1', 'skill2', 'jump', 'dodge']) {
        if (inp.consume(a)) {
          this.buffer = a;
          this.bufferT = 0.22;
        }
      }
    }

    // 技の進行
    if (this.act) {
      const a = this.act;
      const spec = ATK[a.kind];
      a.t += dt * ts;
      if (a.kind === 'special') {
        if (!a.fired && a.t >= spec.fire) {
          a.fired = true;
          this.fireSpecial();
        }
      } else if (a.kind === 'stomp') {
        if (!a.fired && a.t >= spec.a0) {
          a.fired = true;
          this.waveHit();
        }
      } else if (MELEE.has(a.kind) && !a.hit && a.t >= spec.a0 && a.t <= spec.a1) {
        this.checkHit(a);
      }
      if ((a.kind === 'air' && this.onGround && a.t > 0.05) || a.t >= spec.dur) this.act = null;
    }

    const free = live && !this.act && this.stun <= 0;
    this.blocking = this.onGround && inp.held.block && live
      && (free || (this.stun > 0 && this.stunKind === 'blockhit'));

    if (free && this.buffer && this.bufferT > 0 && (!this.blocking || this.buffer === 'dodge')) {
      const b = this.buffer;
      this.buffer = null;
      if (b === 'jump') {
        if (this.onGround) {
          this.vy = 7.6;
          this.onGround = false;
          this.airUsed = false;
          sfx('jump');
        }
      } else if (b === 'punch' || b === 'kick') {
        if (!this.onGround) {
          if (!this.airUsed) this.startAct('air');
        } else if (b === 'kick') {
          this.startAct('kick');
        } else {
          this.combo = this.comboT > 0 ? (this.combo % 3) + 1 : 1;
          this.startAct(`p${this.combo}`);
        }
      } else if (b === 'skill1' || b === 'skill2') {
        this.useSkill(b === 'skill1' ? 0 : 1);
      } else if (b === 'dodge' && this.onGround && this.dodgeCd <= 0) {
        this.startDodge();
      }
    }

    // 移動
    let mx = 0;
    let mz = 0;
    if (live && this.stun <= 0) {
      let sp = (this.input.lockOn ? 4.3 : 5.4) * this.speedMul * (this.buffs.accel > 0 ? 1.9 : 1);
      if (this.act && this.onGround) sp *= 0.12;
      else if (this.blocking) sp *= 0.3;
      else if (!this.onGround) sp *= 0.85;
      mx = inp.move.x * sp;
      mz = inp.move.z * sp;
    }
    this.moving = Math.hypot(mx, mz);
    this.pos.x += (mx + this.kb.x) * dt;
    this.pos.z += (mz + this.kb.z) * dt;
    this.kb.multiplyScalar(Math.exp(-dt * (this.onGround ? 7 : 1.2)));

    if (!this.onGround) {
      this.vy -= 24 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= 0) {
        this.pos.y = 0;
        this.vy = 0;
        this.onGround = true;
        this.airUsed = false;
        if (this.isKO) {
          this.game.fx.dust(this.pos);
          sfx('land');
        }
      }
    }

    // 相手とのめり込み防止
    if (tgt && !tgt.ko && !this.isKO) {
      const dx = this.pos.x - tgt.pos.x;
      const dz = this.pos.z - tgt.pos.z;
      const d = Math.hypot(dx, dz);
      const minD = 0.85;
      if (d < minD && Math.abs(this.pos.y - tgt.pos.y) < 1.3) {
        if (d < 1e-4) {
          this.pos.addScaledVector(this.facing, -minD);
        } else {
          const k = (minD - d) / d;
          this.pos.x += dx * k;
          this.pos.z += dz * k;
        }
      }
    }
    // リングの外に出ない
    // 柱にめり込まない
    for (const p of PILLARS) {
      const dx = this.pos.x - p.x;
      const dz = this.pos.z - p.z;
      const d = Math.hypot(dx, dz);
      const minD = p.r + 0.4;
      if (d < minD && d > 1e-4) {
        this.pos.x = p.x + (dx / d) * minD;
        this.pos.z = p.z + (dz / d) * minD;
      }
    }
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > ARENA_RADIUS) {
      this.pos.x *= ARENA_RADIUS / r;
      this.pos.z *= ARENA_RADIUS / r;
    }

    // 向き: ロックオン中は相手、それ以外は走る方向。攻撃の出だしは近くの相手に自動で振り向く
    if (!this.isKO && this.stun <= 0) {
      let want = null;
      const early = this.act && this.act.t < 0.05 && ATTACKS.has(this.act.kind);
      if (tgt && !tgt.ko) {
        const tx = tgt.pos.x - this.pos.x;
        const tz = tgt.pos.z - this.pos.z;
        const toT = Math.atan2(tx, tz);
        if (this.input.lockOn && (!this.act || early)) want = toT;
        else if (early && Math.hypot(tx, tz) < 3.5) want = toT;
      }
      if (want === null && !this.act && this.moving > 0.3) want = Math.atan2(mx, mz);
      if (want === null && this.act && this.act.kind === 'dodge' && this.act.t < 0.05 && !this.input.lockOn) {
        want = Math.atan2(this.kb.x, this.kb.z);
      }
      if (want !== null) {
        const k = early ? 1 : 1 - Math.exp(-dt * 16);
        f.root.rotation.y = angleLerp(f.root.rotation.y, want, k);
      }
    }
    this.facing.set(Math.sin(f.root.rotation.y), 0, Math.cos(f.root.rotation.y));

    if (this.winT > 0) {
      this.winT -= dt;
      if (this.winT <= 0) this.won = true;
    }

    let an;
    if (this.isKO) an = 'ko';
    else if (this.won) an = 'win';
    else if (this.stun > 0) an = this.stunKind;
    else if (this.act) an = this.act.kind;
    else if (!this.onGround) an = 'jump';
    else if (this.blocking) an = 'block';
    else if (this.moving > 0.3) an = 'walk';
    else an = 'idle';
    f.play(an);
    f.moveSpeed = this.moving;
    f.root.position.copy(this.pos);
    f.update(dt * ts);

    this.sendT -= dt;
    if (this.sendT <= 0 || this.blocking !== this.lastBlk || this.invincible !== this.lastInv) this.sendState();
    inp.endFrame();
  }

  sendState() {
    this.sendT = SEND_INTERVAL;
    this.lastBlk = this.blocking;
    this.lastInv = this.invincible;
    const f = this.fighter;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    this.channel.send({
      t: 's', x: r3(this.pos.x), y: r3(this.pos.y), z: r3(this.pos.z), r: r3(f.root.rotation.y),
      an: f.anim, at: r3(f.t), ai: this.actId, mv: r3(this.moving), blk: this.blocking, inv: this.invincible,
    });
  }
}

// ネット越しの相手（受信した状態を補間して表示）
class RemoteView {
  constructor(fighter, idx) {
    this.fighter = fighter;
    this.idx = idx;
    this.pos = new THREE.Vector3();
    this.buf = [];
    this.lastAi = -1;
    this.buffs = { accel: 0, armor: 0, vamp: 0 };
    this.snapNext = false;
    this.spawn();
  }

  get ko() {
    return this.fighter.anim === 'ko';
  }

  spawn() {
    const x = SPAWN_X[this.idx];
    this.buf.length = 0;
    this.buffs = { accel: 0, armor: 0, vamp: 0 };
    this.pos.set(x, 0, 0);
    this.fighter.root.position.copy(this.pos);
    this.fighter.root.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    this.fighter.play('idle', true);
  }

  push(m) {
    if (this.snapNext) {
      // 瞬間移動: 補間せずに一瞬で移動させる
      this.buf.length = 0;
      this.snapNext = false;
    }
    this.buf.push({ time: performance.now(), x: m.x, y: m.y, z: m.z, r: m.r });
    if (this.buf.length > 40) this.buf.shift();
    const f = this.fighter;
    if (m.ai !== this.lastAi) {
      this.lastAi = m.ai;
      f.play(m.an, true, m.at);
    } else if (m.an !== f.anim) {
      f.play(m.an, false, m.at);
    }
    f.moveSpeed = m.mv;
  }

  update(dt) {
    const f = this.fighter;
    const b = this.buf;
    if (b.length) {
      const rt = performance.now() - INTERP_DELAY;
      let s0 = b[0];
      let s1 = b[0];
      if (rt >= b[b.length - 1].time) {
        s0 = s1 = b[b.length - 1];
      } else {
        for (let i = b.length - 2; i >= 0; i--) {
          if (b[i].time <= rt) {
            s0 = b[i];
            s1 = b[i + 1];
            break;
          }
        }
      }
      const k = s1.time > s0.time ? Math.min(1, Math.max(0, (rt - s0.time) / (s1.time - s0.time))) : 1;
      this.pos.set(s0.x + (s1.x - s0.x) * k, s0.y + (s1.y - s0.y) * k, s0.z + (s1.z - s0.z) * k);
      f.root.rotation.y = angleLerp(s0.r, s1.r, k);
    }
    f.root.position.copy(this.pos);
    f.update(dt);
  }
}

// 足元のリング（自分=青、相手=赤）
function addMarker(fighter, color) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.55, 32), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  fighter.root.add(ring);
  fighter.materials.push(mat);
}

// 相手の頭上の名前
function addNameTag(fighter, text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 6;
  g.strokeStyle = 'rgba(0,0,0,0.8)';
  g.strokeText(text, 128, 32);
  g.fillStyle = '#ffffff';
  g.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true });
  const tag = new THREE.Sprite(mat);
  tag.scale.set(1.6, 0.4, 1);
  tag.position.y = 2.25 * fighter.profile.height;
  tag.renderOrder = 10;
  fighter.root.add(tag);
  fighter.materials.push(mat);
}

export class Game {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
    this.camera.position.set(0, 1.6, 6);
    this.arena = buildArena(this.scene);
    this.fx = new Effects(this.scene);
    this.input = new PlayerInput();
    this.input.bindMouse(canvas);
    this.input.onLockChange = (on) => hud.setLock(on);

    this.mode = 'menu'; // menu | wait | match
    this.events = {};
    this.preview = null;
    this.previewT = 0;
    this.projectiles = [];
    this.beams = [];
    this.scheduled = [];
    this.stopT = 0;
    this.stopBy = -1;
    this.local = null;
    this.opp = null;
    this.views = [];
    this.me = 0;
    this.net = null;
    this.practice = null;
    this.fightEndsAt = 0;
    this.hitstop = 0;
    this.shake = 0;
    this.timeScale = 1;
    this.slowT = 0;
    this.camPos = new THREE.Vector3(0, 2, 8);
    this.camLook = new THREE.Vector3(0, 1, 0);
    this.camYaw = 0;
    this.basis = { right: { x: 1, z: 0 }, fwd: { x: 0, z: -1 } };
    this.time = 0;
    this.last = performance.now();

    window.addEventListener('resize', () => this.resize());
    this.resize();
    requestAnimationFrame(() => this.frame());
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.updateViewOffset();
    this.camera.updateProjectionMatrix();
  }

  updateViewOffset() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.mode === 'menu') {
      if (w > 760) this.camera.setViewOffset(w, h, Math.min(220, w * 0.2), 0, w, h);
      else this.camera.setViewOffset(w, h, 0, h * 0.27, w, h);
    } else {
      this.camera.clearViewOffset();
    }
    this.camera.updateProjectionMatrix();
  }

  setMode(mode) {
    this.mode = mode;
    this.input.enabled = mode === 'match';
    this.input.reset();
    if (mode !== 'match') this.input.releaseMouse();
    if (this.preview) this.preview.root.visible = mode !== 'match';
    this.updateViewOffset();
  }

  // ---- メニュー用プレビュー ----
  setPreview(profile) {
    const rot = this.preview ? this.preview.root.rotation.y : 0.4;
    if (this.preview) this.preview.dispose();
    this.preview = new Fighter(profile);
    this.preview.root.rotation.y = rot;
    this.preview.root.visible = this.mode !== 'match';
    this.scene.add(this.preview.root);
    this.preview.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  }

  previewAttack(kind) {
    if (this.preview) this.preview.play(kind, true);
  }

  // ---- オンライン ----
  startOnline(net) {
    this.leave();
    this.net = net;
    this.channel = { send: (m) => net.send(m) };
    net.onMessage = (m) => this.onMessage(m);
    this.setMode('wait');
  }

  // ---- 練習モード（ブラウザ内でルームを動かす） ----
  startPractice(profile) {
    this.leave();
    const room = new Room('CPU');
    const local = { profile, send: (m) => queueMicrotask(() => this.onMessage(m)) };
    const bot = { profile: randomProfile('CPU'), send: (m) => queueMicrotask(() => this.opp && this.opp.onMessage && this.opp.onMessage(m)) };
    this.practice = { room, local, bot, tick: setInterval(() => room.tick(), 200) };
    this.channel = { send: (m) => room.handle(local, m) };
    this.botChannel = { send: (m) => room.handle(bot, m) };
    this.setMode('wait');
    room.add(local);
    room.add(bot);
  }

  rematch() {
    if (this.practice) this.practice.room.startMatch();
    else if (this.net) this.net.send({ t: 'rematch' });
  }

  leave() {
    if (this.net) {
      this.net.onMessage = () => {};
      this.net.send({ t: 'leave' });
      this.net.close();
      this.net = null;
    }
    if (this.practice) {
      clearInterval(this.practice.tick);
      this.practice.room.dispose();
      this.practice = null;
    }
    this.clearMatch();
    hud.show(false);
    hud.clearAnnounce();
    this.setMode('menu');
  }

  clearMatch() {
    for (const v of this.views) if (v) v.fighter.dispose();
    this.views = [];
    this.local = null;
    this.opp = null;
    for (const p of this.projectiles) p.destroy();
    this.projectiles = [];
    for (const b of this.beams) b.destroy();
    this.beams = [];
    this.scheduled = [];
    this.endTimeStop(true);
    this.fx.clear();
    this.fightEndsAt = 0;
    this.timeScale = 1;
  }

  setupMatch(profiles) {
    this.clearMatch();
    const me = this.me;
    const myF = new Fighter(profiles[me]);
    const oppF = new Fighter(profiles[1 - me]);
    this.scene.add(myF.root, oppF.root);
    this.local = new Controller(this, myF, this.input, this.channel, me);
    if (this.practice) {
      this.opp = new Controller(this, oppF, new AIInput(1), this.botChannel, 1 - me);
    } else {
      this.opp = new RemoteView(oppF, 1 - me);
    }
    this.local.target = this.opp;
    this.opp.target = this.local;
    this.views[me] = this.local;
    this.views[1 - me] = this.opp;
    addMarker(myF, '#3dd5ff');
    addMarker(oppF, '#ff4757');
    addNameTag(oppF, oppF.profile.name);
    this.setMode('match');
    hud.setLock(this.input.lockOn);
    hud.setup(
      [myF.profile.name, oppF.profile.name],
      [myF.profile.top, oppF.profile.top],
      [statMods(myF.profile).maxHp, statMods(oppF.profile).maxHp],
    );
    hud.setSkills(myF.profile.skills.map((id) => SKILLS[id]));
    hud.show(true);
    this.snapCamera = true;
  }

  side(idx) {
    return idx === this.me ? 0 : 1;
  }

  onMessage(m) {
    const ev = this.events;
    switch (m.t) {
      case 'joined':
        this.me = m.you;
        if (!this.practice) ev.onJoined?.(m.code, m.you);
        return;
      case 'match':
        this.setupMatch(m.profiles);
        ev.onMatch?.(m.profiles, this.me);
        hud.announce(`${m.profiles[this.me].name}  VS  ${m.profiles[1 - this.me].name}`, 'vs', 1700);
        break;
      case 'pong':
        if (this.net) hud.setPing(this.net.ping);
        return;
      case 'error':
        ev.onError?.(m.msg);
        return;
      case 'oppLeft':
        this.clearMatch();
        hud.show(false);
        this.setMode('wait');
        ev.onOppLeft?.();
        return;
      case 'rematch':
        ev.onRematch?.(m.ready, this.me);
        return;
    }
    if (!this.local) return;
    this.local.onMessage(m);

    switch (m.t) {
      case 's':
        if (this.opp instanceof RemoteView) this.opp.push(m);
        break;
      case 'round':
        if (this.opp instanceof RemoteView) this.opp.spawn();
        for (const p of this.projectiles) p.destroy();
        this.projectiles = [];
        for (const b of this.beams) b.destroy();
        this.beams = [];
        this.scheduled = [];
        this.endTimeStop(true);
        for (let i = 0; i < 2; i++) {
          hud.setHp(this.side(i), m.hp[i], true);
          hud.setMeter(this.side(i), m.meter[i]);
          hud.setWins(this.side(i), m.wins[i]);
        }
        this.fightEndsAt = 0;
        hud.setTimer('60');
        hud.announce(m.wins[0] === 1 && m.wins[1] === 1 ? 'FINAL ROUND' : `ROUND ${m.n}`, 'round', 1800);
        sfx('round');
        this.snapCamera = true;
        break;
      case 'fight':
        this.fightEndsAt = performance.now() + m.time * 1000;
        hud.announce('FIGHT!', 'fight', 900);
        sfx('fight');
        break;
      case 'hit':
        this.onHit(m);
        break;
      case 'meter':
        for (let i = 0; i < 2; i++) hud.setMeter(this.side(i), m.meter[i]);
        break;
      case 'ability':
        this.onAbility(m);
        break;
      case 'roundEnd': {
        this.endTimeStop();
        for (let i = 0; i < 2; i++) hud.setWins(this.side(i), m.wins[i]);
        this.fightEndsAt = 0;
        let text;
        if (m.reason === 'ko') text = 'K.O.!';
        else if (m.winner < 0) text = 'DRAW';
        else text = 'TIME UP';
        hud.announce(text, 'ko', 1800);
        if (m.reason !== 'ko') sfx('ko');
        setTimeout(() => {
          if (!this.local) return;
          if (m.winner < 0) hud.announce('引き分け', 'sub', 1400);
          else hud.announce(m.winner === this.me ? 'YOU WIN' : 'YOU LOSE', m.winner === this.me ? 'win' : 'lose', 1500);
        }, 1700);
        break;
      }
      case 'matchEnd':
        ev.onMatchEnd?.(m.winner === this.me, m.wins, this.me);
        break;
    }
  }

  onHit(m) {
    const atk = this.views[m.by];
    const vic = this.views[1 - m.by];
    if (!atk || !vic) return;
    const kind = m.kind;
    const heavy = HEAVY.has(kind);
    const toAtk = new THREE.Vector3(atk.pos.x - vic.pos.x, 0, atk.pos.z - vic.pos.z).normalize();
    const pos = vic.pos.clone().addScaledVector(toAtk, 0.35);
    pos.y += kind === 'kick' ? 1.05 : 1.35;
    const color = m.blocked ? '#7fd3ff' : heavy ? '#ff8a3d' : '#ffe37a';
    this.fx.spark(pos, color, m.blocked ? 0.5 : heavy ? 1.5 : 1, toAtk.clone().negate());
    sfx(m.blocked ? 'block' : heavy ? 'heavy' : 'hit');
    this.shake = Math.max(this.shake, m.blocked ? 0.05 : heavy ? 0.28 : 0.13);
    this.hitstop = kind === 'beam' ? 0.015 : m.blocked ? 0.04 : heavy ? 0.1 : 0.06;
    for (let i = 0; i < 2; i++) {
      hud.setHp(this.side(i), m.hp[i]);
      hud.setMeter(this.side(i), m.meter[i]);
    }
    if (kind === 'fire') {
      const p = this.projectiles.find((q) => q.owner === m.by && !q.dead);
      if (p) p.destroy();
    }
    this.arena.cheer(m.blocked ? 0.2 : heavy ? 0.8 : 0.4);
    if (m.hp[1 - m.by] <= 0) {
      this.arena.cheer(2);
      this.timeScale = 0.25;
      this.slowT = 0.9;
      this.shake = 0.45;
      sfx('ko');
    }
  }

  // 自分（またはCPU）が能力を使った瞬間の演出
  onSkillStart(ctrl, id) {
    const v = ctrl.fighter;
    const p = ctrl.pos.clone();
    p.y += 1.2;
    if (id === 'accel') {
      this.fx.spark(p, '#ffd23f', 1.2);
      sfx('accel');
    } else if (id === 'armor') {
      this.fx.spark(p, '#b8c7d9', 1.2);
      sfx('armor');
    } else if (id === 'vamp') {
      this.fx.spark(p, '#c0102a', 1.2);
      sfx('buff');
    } else if (id === 'beam') {
      sfx('charge');
    }
    if (ctrl === this.local) hud.flashSkill(ctrl.skills.indexOf(id));
    void v;
  }

  // サーバーから能力の発動が届いた
  onAbility(m) {
    for (let i = 0; i < 2; i++) {
      hud.setHp(this.side(i), m.hp[i]);
      hud.setMeter(this.side(i), m.meter[i]);
    }
    const owner = this.views[m.by];
    if (!owner) return;
    const def = SKILLS[m.id];
    const remote = owner instanceof RemoteView;
    if (remote) {
      // ネット越しの相手の能力は、ここで演出を出す
      const pos = new THREE.Vector3(m.x, m.y, m.z);
      const dir = new THREE.Vector3(m.dx, 0, m.dz);
      if (m.id === 'fire') {
        this.later(0.26, () => {
          const o = owner.pos.clone().addScaledVector(dir, 0.7);
          o.y += 1.3 * owner.fighter.profile.height;
          this.spawnFireball(m.by, o, dir, null);
        });
      } else if (m.id === 'beam') {
        this.spawnBeam(m.by, pos, dir, null);
        sfx('charge');
      } else if (m.id === 'wave') {
        this.spawnWave(m.by, pos, 0.27);
      } else if (m.id === 'blink') {
        owner.snapNext = true;
        this.blinkFx(pos, null);
      } else if (m.id in owner.buffs) {
        owner.buffs[m.id] = m.dur / 1000;
        const p = owner.pos.clone();
        p.y += 1.2;
        this.fx.spark(p, m.id === 'accel' ? '#ffd23f' : m.id === 'armor' ? '#b8c7d9' : '#c0102a', 1.2);
        sfx('buff');
      }
    }
    if (m.id === 'heal') {
      const p = owner.pos.clone();
      p.y += 1.2;
      this.fx.spark(p, '#4cff7a', 1.4);
      sfx('heal');
    }
    if (m.id === 'timestop') this.startTimeStop(m.by, m.dur / 1000);
    if (def.sp && m.id !== 'timestop') hud.announce(def.name, 'skill', 1100);
    if (m.by !== this.me && m.id !== 'timestop' && !def.sp) hud.toastSkill(owner.fighter.profile.name, def);
  }

  startTimeStop(by, dur) {
    this.stopT = dur;
    this.stopBy = by;
    const o = this.views[by];
    const p = o.pos.clone();
    p.y += 1.2;
    stopSphere(this.fx, p);
    this.renderer.domElement.classList.add('timestop');
    hud.announce('タイムストップ！', 'stop', 1300);
    sfx('stop');
    this.shake = 0.3;
  }

  endTimeStop(silent = false) {
    if (this.stopBy < 0) return;
    const o = this.views[this.stopBy];
    this.stopBy = -1;
    this.stopT = 0;
    this.renderer.domElement.classList.remove('timestop');
    if (!silent && o) {
      const p = o.pos.clone();
      p.y += 1.2;
      stopSphere(this.fx, p, true);
      sfx('resume');
    }
  }

  later(sec, fn) {
    this.scheduled.push({ t: sec, fn });
  }

  spawnBeam(owner, origin, dir, ctrl) {
    const v = this.views[owner];
    const color = v ? v.fighter.profile.accColor : '#66ccff';
    // 壁までの長さ
    const d = dir.clone().setY(0).normalize();
    const od = origin.x * d.x + origin.z * d.z;
    const oo = origin.x * origin.x + origin.z * origin.z;
    const len = Math.max(2, -od + Math.sqrt(Math.max(0, od * od - (oo - WALL_RADIUS * WALL_RADIUS))));
    const b = new Beam(this.fx, owner, origin, d, color, len, BEAM_DELAY, 1.3);
    b.ctrl = ctrl;
    this.beams.push(b);
    this.later(BEAM_DELAY, () => {
      sfx('beam');
      this.shake = Math.max(this.shake, 0.35);
    });
  }

  spawnWave(owner, pos, delay) {
    const p = pos.clone();
    this.later(delay, () => {
      groundRing(this.fx, p, '#ffcf5a', WAVE_RADIUS, 0.4);
      groundRing(this.fx, p, '#ffffff', WAVE_RADIUS * 0.7, 0.3);
      this.fx.dust(p);
      sfx('wave');
      this.shake = Math.max(this.shake, 0.25);
    });
  }

  blinkFx(from, to) {
    for (const p of [from, to]) {
      if (!p) continue;
      const q = p.clone();
      q.y += 1.1;
      this.fx.spark(q, '#b46bff', 1.1);
    }
    sfx('blink');
  }

  updateBeams(dt) {
    for (const b of this.beams) {
      if (this.stopT > 0 && b.owner !== this.stopBy) continue;
      b.update(dt);
      if (b.dead || !b.ctrl) continue;
      b.tickT -= dt;
      const t = b.ctrl.target;
      if (b.active && b.tickT <= 0 && t && !t.ko && b.hits(t.pos)) {
        b.tickT = 0.17;
        b.ctrl.channel.send({ t: 'hit', kind: 'beam' });
      }
    }
    this.beams = this.beams.filter((b) => !b.dead);
  }

  // 能力中の見た目（発光・残像）
  updateAuras(dt) {
    for (const v of this.views) {
      if (!v) continue;
      const b = v.buffs;
      if (v instanceof RemoteView) for (const k in b) if (b[k] > 0) b[k] -= dt;
      const f = v.fighter;
      if (b.armor > 0) f.setTint('#8fa3b8', 0.55);
      else if (b.vamp > 0) f.setTint('#b0102a', 0.45);
      else if (b.accel > 0) f.setTint('#ffcc33', 0.3);
      else f.setTint(null);
      if (b.accel > 0 || b.vamp > 0) {
        v.auraT = (v.auraT || 0) - dt;
        if (v.auraT <= 0) {
          v.auraT = b.accel > 0 ? 0.03 : 0.08;
          const s = this.fx.sprite(b.accel > 0 ? f.profile.top : '#ff2040', b.accel > 0 ? 0.9 : 0.35);
          s.position.set(v.pos.x, v.pos.y + 1.0 + Math.random() * 0.5, v.pos.z);
          this.fx.parts.push({ s, v: new THREE.Vector3(0, b.accel > 0 ? 0 : 1.5, 0), life: 0.3, max: 0.3, g: 0 });
        }
      }
    }
  }

  spawnFireball(owner, pos, dir, ctrl) {
    const v = this.views[owner];
    const color = v ? v.fighter.profile.accColor : '#66ccff';
    const fb = new Fireball(this.fx, owner, pos, dir, color);
    fb.ctrl = ctrl;
    this.projectiles.push(fb);
    sfx('fire');
  }

  updateProjectiles(dt) {
    for (const p of this.projectiles) {
      if (this.stopT > 0 && p.owner !== this.stopBy) continue;
      p.update(dt);
      if (p.dead) continue;
      // 柱や壁に当たったら消える
      const blocked = Math.hypot(p.pos.x, p.pos.z) > WALL_RADIUS - 0.2
        || PILLARS.some((q) => Math.hypot(p.pos.x - q.x, p.pos.z - q.z) < q.r + 0.15);
      if (blocked) {
        this.fx.spark(p.pos, p.color, 0.7);
        p.destroy();
        continue;
      }
      if (!p.ctrl) continue;
      const t = p.ctrl.target;
      if (!t || t.ko) continue;
      const d = Math.hypot(t.pos.x - p.pos.x, t.pos.z - p.pos.z);
      if (d < 0.75 && Math.abs(t.pos.y + 1.1 - p.pos.y) < 1.0) {
        p.ctrl.channel.send({ t: 'hit', kind: 'fire' });
        p.destroy();
      }
    }
    this.projectiles = this.projectiles.filter((p) => !p.dead);
  }

  updateCamera(dt) {
    const cam = this.camera;
    if (this.mode !== 'match' || !this.local) {
      const narrow = window.innerWidth <= 760;
      this.camPos.set(0, narrow ? 1.5 : 1.35, narrow ? 7 : 4.3);
      this.camLook.set(0, narrow ? 0.85 : 1.0, 0);
      cam.position.copy(this.camPos);
      cam.lookAt(this.camLook);
      return;
    }
    // 3人称カメラ: 自分の背中から追いかける。ロックオン中は相手の方へ自動で向く
    const me = this.local.pos;
    const opp = this.opp;
    const lock = this.input.lockOn && opp && !opp.ko;
    const toOpp = Math.atan2(opp.pos.x - me.x, opp.pos.z - me.z);
    const look = this.input.takeLook(dt);
    if (this.snapCamera) this.camYaw = toOpp;
    else if (lock) this.camYaw = angleLerp(this.camYaw, toOpp, 1 - Math.exp(-dt * 6));
    else this.camYaw += look;
    const portrait = window.innerWidth < window.innerHeight;
    const dist = portrait ? 6.8 : 5.2;
    const fx = Math.sin(this.camYaw);
    const fz = Math.cos(this.camYaw);
    // 少し右肩越しにして、相手が自分の体に隠れにくくする
    const sh = portrait ? 0.3 : 0.65;
    const rx = -fz * sh;
    const rz = fx * sh;
    const want = new THREE.Vector3(me.x - fx * dist + rx, (portrait ? 3.1 : 2.5) + me.y * 0.5, me.z - fz * dist + rz);
    // 観客席の壁の外にカメラが出ないようにする
    const wr = Math.hypot(want.x, want.z);
    const maxR = WALL_RADIUS - 0.4;
    if (wr > maxR) {
      want.x *= maxR / wr;
      want.z *= maxR / wr;
    }
    const target = lock
      ? new THREE.Vector3(me.x + (opp.pos.x - me.x) * 0.35 + rx, 1.1 + me.y * 0.5, me.z + (opp.pos.z - me.z) * 0.35 + rz)
      : new THREE.Vector3(me.x + fx * 2 + rx, 1.2 + me.y * 0.5, me.z + fz * 2 + rz);
    if (this.snapCamera) {
      this.camPos.copy(want);
      this.camLook.copy(target);
      this.snapCamera = false;
    } else {
      this.camPos.lerp(want, 1 - Math.exp(-dt * 10));
      this.camLook.lerp(target, 1 - Math.exp(-dt * 12));
    }
    cam.position.copy(this.camPos);
    if (this.shake > 0.001) {
      cam.position.x += (Math.random() - 0.5) * this.shake;
      cam.position.y += (Math.random() - 0.5) * this.shake;
      cam.position.z += (Math.random() - 0.5) * this.shake;
    }
    cam.lookAt(this.camLook);
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    this.basis.fwd.x = fwd.x;
    this.basis.fwd.z = fwd.z;
    this.basis.right.x = -fwd.z;
    this.basis.right.z = fwd.x;
  }

  frame() {
    requestAnimationFrame(() => this.frame());
    const now = performance.now();
    let dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.time += dt;
    const realDt = dt;

    if (this.hitstop > 0) {
      this.hitstop -= dt;
      dt *= 0.08;
    }
    if (this.slowT > 0) {
      this.slowT -= realDt;
      if (this.slowT <= 0) this.timeScale = 1;
      dt *= this.timeScale;
    }
    this.shake *= Math.exp(-realDt * 9);
    this.arena.update(this.time, realDt);

    if (this.mode === 'match' && this.local) {
      for (let i = this.scheduled.length - 1; i >= 0; i--) {
        const s = this.scheduled[i];
        s.t -= dt;
        if (s.t <= 0) {
          this.scheduled.splice(i, 1);
          s.fn();
        }
      }
      if (this.stopT > 0) {
        this.stopT -= realDt;
        if (this.stopT <= 0) this.endTimeStop();
      }
      this.local.update(dt, this.basis);
      if (this.opp instanceof Controller) this.opp.update(dt, this.basis);
      else this.opp.update(this.stopT > 0 && this.stopBy === this.me ? 0 : dt);
      this.updateProjectiles(dt);
      this.updateBeams(dt);
      this.updateAuras(dt);
      hud.updateSkills(this.local.skillCd, this.local.meter >= METER_MAX);
      if (this.fightEndsAt) {
        hud.setTimer(String(Math.max(0, Math.ceil((this.fightEndsAt - now) / 1000))));
      }
    } else if (this.preview) {
      const p = this.preview;
      p.root.rotation.y += realDt * 0.5;
      this.previewT -= realDt;
      if (this.previewT <= 0) {
        this.previewT = 2.2;
        const moves = ['p1', 'p2', 'p3', 'kick', 'special', 'cast', 'stomp', 'idle', 'win'];
        p.play(moves[Math.floor(Math.random() * moves.length)], true);
      }
      if (p.anim !== 'idle' && p.anim !== 'win' && p.t > 0.8) p.play('idle');
      if (p.anim === 'win' && p.t > 1.6) p.play('idle');
      p.update(realDt);
    }
    this.fx.update(dt, this.camera);
    this.updateCamera(realDt);
    this.renderer.render(this.scene, this.camera);
  }
}
