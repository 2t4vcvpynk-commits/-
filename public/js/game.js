// ゲーム本体: シーン・プレイヤー操作・リモート同期・練習モード
import * as THREE from 'three';
import { Fighter } from './fighter.js';
import { buildArena, ARENA_RADIUS } from './arena.js';
import { Effects, Fireball } from './fx.js';
import { PlayerInput, AIInput } from './input.js';
import { hud } from './hud.js';
import { sfx } from './sfx.js';
import { Room, MAX_HP, METER_MAX } from './shared/room.js';
import { STYLE_STATS, randomProfile } from './shared/profile.js';

// 技データ（時間は秒）
const ATK = {
  p1: { dur: 0.28, a0: 0.06, a1: 0.16, range: 1.5, step: 1.2 },
  p2: { dur: 0.3, a0: 0.07, a1: 0.17, range: 1.55, step: 1.5 },
  p3: { dur: 0.5, a0: 0.15, a1: 0.28, range: 1.5, step: 3 },
  kick: { dur: 0.55, a0: 0.17, a1: 0.32, range: 1.95, step: 1.8 },
  air: { dur: 0.45, a0: 0.05, a1: 0.38, range: 1.7, step: 0 },
  special: { dur: 0.62, fire: 0.26, step: 0 },
};
// [のけぞり時間, ふっとび速度]
const STUN = {
  p1: [0.3, 2.5], p2: [0.3, 3], p3: [0.55, 7.5], kick: [0.55, 8.5], air: [0.45, 5], fire: [0.65, 9],
};
const HEAVY = new Set(['p3', 'kick', 'air', 'fire']);
const SPAWN_X = [-2.5, 2.5];
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
    this.hp = MAX_HP;
    this.meter = 0;
    this.actId = 0;
    this.speedMul = STYLE_STATS[fighter.profile.style].speed;
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
      case 'roundEnd':
        this.frozen = true;
        this.act = null;
        this.buffer = null;
        if (m.winner === i) this.winT = 1.3;
        break;
    }
  }

  takeHit(m) {
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
    this.act = { kind, t: 0, hit: false, fired: false };
    this.actId++;
    this.fighter.play(kind, true);
    this.kb.addScaledVector(this.facing, ATK[kind].step);
    if (kind[0] === 'p') this.comboT = ATK[kind].dur + 0.35;
    if (kind === 'air') this.airUsed = true;
    if (kind !== 'special') sfx('whoosh');
    this.sendT = 0;
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
    this.channel.send({ t: 'special', x: p.x, y: p.y, z: p.z, dx: dir.x, dz: dir.z });
    this.meter = 0;
  }

  update(dt, basis) {
    const f = this.fighter;
    const inp = this.input;
    const tgt = this.target;
    inp.update(dt, this, tgt, basis);
    const live = !this.frozen && !this.isKO;

    if (this.stun > 0) this.stun -= dt;
    this.comboT -= dt;
    this.bufferT -= dt;
    if (live) {
      for (const a of ['punch', 'kick', 'special', 'jump']) {
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
      a.t += dt;
      if (a.kind === 'special') {
        if (!a.fired && a.t >= spec.fire) {
          a.fired = true;
          this.fireSpecial();
        }
      } else if (!a.hit && a.t >= spec.a0 && a.t <= spec.a1) {
        this.checkHit(a);
      }
      if ((a.kind === 'air' && this.onGround && a.t > 0.05) || a.t >= spec.dur) this.act = null;
    }

    const free = live && !this.act && this.stun <= 0;
    this.blocking = this.onGround && inp.held.block && live
      && (free || (this.stun > 0 && this.stunKind === 'blockhit'));

    if (free && this.buffer && this.bufferT > 0 && !this.blocking) {
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
      } else if (b === 'special' && this.onGround && this.meter >= METER_MAX) {
        this.startAct('special');
      }
    }

    // 移動
    let mx = 0;
    let mz = 0;
    if (live && this.stun <= 0) {
      let sp = 4.2 * this.speedMul;
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
    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > ARENA_RADIUS) {
      this.pos.x *= ARENA_RADIUS / r;
      this.pos.z *= ARENA_RADIUS / r;
    }

    // 相手の方を向く
    if (tgt && !this.isKO && (!this.act || this.act.t < 0.04)) {
      const want = Math.atan2(tgt.pos.x - this.pos.x, tgt.pos.z - this.pos.z);
      f.root.rotation.y = angleLerp(f.root.rotation.y, want, 1 - Math.exp(-dt * 18));
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
    f.update(dt);

    this.sendT -= dt;
    if (this.sendT <= 0 || this.blocking !== this.lastBlk) this.sendState();
    inp.endFrame();
  }

  sendState() {
    this.sendT = SEND_INTERVAL;
    this.lastBlk = this.blocking;
    const f = this.fighter;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    this.channel.send({
      t: 's', x: r3(this.pos.x), y: r3(this.pos.y), z: r3(this.pos.z), r: r3(f.root.rotation.y),
      an: f.anim, at: r3(f.t), ai: this.actId, mv: r3(this.moving), blk: this.blocking,
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
    this.spawn();
  }

  get ko() {
    return this.fighter.anim === 'ko';
  }

  spawn() {
    const x = SPAWN_X[this.idx];
    this.buf.length = 0;
    this.pos.set(x, 0, 0);
    this.fighter.root.position.copy(this.pos);
    this.fighter.root.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
    this.fighter.play('idle', true);
  }

  push(m) {
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

    this.mode = 'menu'; // menu | wait | match
    this.events = {};
    this.preview = null;
    this.previewT = 0;
    this.projectiles = [];
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
    this.camDir = new THREE.Vector3(1, 0, 0);
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
    this.setMode('match');
    hud.setup([myF.profile.name, oppF.profile.name], [myF.profile.top, oppF.profile.top]);
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
      case 'fx':
        if (!this.practice) {
          this.spawnFireball(m.by, new THREE.Vector3(m.x, m.y, m.z), new THREE.Vector3(m.dx, 0, m.dz), null);
        }
        break;
      case 'roundEnd': {
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
    this.hitstop = m.blocked ? 0.04 : heavy ? 0.1 : 0.06;
    for (let i = 0; i < 2; i++) {
      hud.setHp(this.side(i), m.hp[i]);
      hud.setMeter(this.side(i), m.meter[i]);
    }
    if (kind === 'fire') {
      const p = this.projectiles.find((q) => q.owner === m.by && !q.dead);
      if (p) p.destroy();
    }
    if (m.hp[1 - m.by] <= 0) {
      this.timeScale = 0.25;
      this.slowT = 0.9;
      this.shake = 0.45;
      sfx('ko');
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
      p.update(dt);
      if (p.dead || !p.ctrl) continue;
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
    const a = this.local.pos;
    const b = this.opp.pos;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const dist = Math.hypot(dx, dz);
    if (dist > 0.3) this.camDir.set(dx / dist, 0, dz / dist);
    const n = new THREE.Vector3(-this.camDir.z, 0, this.camDir.x);
    const mid = new THREE.Vector3((a.x + b.x) / 2, 0, (a.z + b.z) / 2);
    const portrait = window.innerWidth < window.innerHeight;
    const camDist = Math.min(14, Math.max(5, dist * (portrait ? 1.3 : 0.75) + (portrait ? 6 : 4.2)));
    const want = mid.clone().addScaledVector(n, camDist);
    want.y = 1.7 + dist * 0.1 + Math.max(a.y, b.y) * 0.3;
    const look = mid.clone();
    look.y = 1.0 + Math.max(a.y, b.y) * 0.3;
    if (this.snapCamera) {
      this.camPos.copy(want);
      this.camLook.copy(look);
      this.snapCamera = false;
    } else {
      this.camPos.lerp(want, 1 - Math.exp(-dt * 4));
      this.camLook.lerp(look, 1 - Math.exp(-dt * 6));
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
    this.arena.update(this.time);

    if (this.mode === 'match' && this.local) {
      this.local.update(dt, this.basis);
      if (this.opp instanceof Controller) this.opp.update(dt, this.basis);
      else this.opp.update(dt);
      this.updateProjectiles(dt);
      if (this.fightEndsAt) {
        hud.setTimer(String(Math.max(0, Math.ceil((this.fightEndsAt - now) / 1000))));
      }
    } else if (this.preview) {
      const p = this.preview;
      p.root.rotation.y += realDt * 0.5;
      this.previewT -= realDt;
      if (this.previewT <= 0) {
        this.previewT = 2.2;
        const moves = ['p1', 'p2', 'p3', 'kick', 'special', 'idle', 'idle', 'win'];
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
