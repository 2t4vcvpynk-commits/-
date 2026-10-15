// 対戦ルームのルール（HP・ラウンド・判定の検証）
// サーバー（オンライン対戦）とブラウザ（練習モード）の両方で同じコードを使う。

import { sanitizeProfile, STYLE_STATS } from './profile.js';

export const MAX_HP = 100;
export const ROUND_TIME = 60;
export const WINS_NEEDED = 2;
export const METER_MAX = 100;

// 技ごとのダメージ（ガード時は CHIP 倍）
export const DAMAGE = { p1: 5, p2: 6, p3: 10, kick: 12, air: 10, fire: 16 };
const CHIP = 0.2;
const MELEE_RANGE = 3.2; // 通信遅延を考慮した緩めの距離チェック
const FIRE_RANGE = 30;
const FIRE_LIFETIME = 3000;
const HIT_COOLDOWN = 110;

export const ANIMS = ['idle', 'walk', 'jump', 'block', 'blockhit', 'hit', 'ko', 'win',
  'p1', 'p2', 'p3', 'kick', 'air', 'special'];

const num = (v, lim = 50) => (Number.isFinite(v) ? Math.max(-lim, Math.min(lim, v)) : 0);

export class Room {
  constructor(code) {
    this.code = code;
    this.slots = [null, null];
    this.phase = 'waiting';
    this.wins = [0, 0];
    this.round = 0;
    this.roundEndsAt = 0;
    this.rematch = [false, false];
    this.timers = new Set();
  }

  get count() {
    return this.slots.filter(Boolean).length;
  }

  later(fn, ms) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  clearTimers() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
  }

  broadcast(msg) {
    for (const p of this.slots) if (p) p.send(msg);
  }

  add(player) {
    const i = this.slots.indexOf(null);
    if (i < 0) return -1;
    player.profile = sanitizeProfile(player.profile);
    player.idx = i;
    player.hp = MAX_HP;
    player.meter = 0;
    player.state = null;
    this.slots[i] = player;
    player.send({ t: 'joined', code: this.code, you: i });
    if (this.count === 2) this.startMatch();
    return i;
  }

  remove(player) {
    const i = this.slots.indexOf(player);
    if (i < 0) return;
    this.slots[i] = null;
    this.clearTimers();
    this.phase = 'waiting';
    const other = this.slots[1 - i];
    if (other) other.send({ t: 'oppLeft' });
  }

  dispose() {
    this.clearTimers();
    this.slots = [null, null];
  }

  startMatch() {
    this.clearTimers();
    this.wins = [0, 0];
    this.round = 0;
    this.rematch = [false, false];
    for (const p of this.slots) p.meter = 0;
    this.phase = 'intro';
    this.broadcast({ t: 'match', profiles: this.slots.map((p) => p.profile) });
    this.later(() => this.startRound(), 1800);
  }

  startRound() {
    this.round++;
    for (const p of this.slots) {
      p.hp = MAX_HP;
      p.fireAt = 0;
    }
    this.phase = 'countdown';
    this.broadcast({
      t: 'round', n: this.round, wins: this.wins,
      hp: this.slots.map((p) => p.hp), meter: this.slots.map((p) => p.meter),
    });
    this.later(() => {
      this.phase = 'fight';
      this.roundEndsAt = Date.now() + ROUND_TIME * 1000;
      this.broadcast({ t: 'fight', time: ROUND_TIME });
    }, 2400);
  }

  endRound(winner, reason) {
    this.phase = 'roundEnd';
    if (winner >= 0) this.wins[winner]++;
    this.broadcast({ t: 'roundEnd', winner, reason, wins: this.wins });
    const champ = this.wins.findIndex((w) => w >= WINS_NEEDED);
    if (champ >= 0) {
      this.later(() => {
        this.phase = 'matchEnd';
        this.broadcast({ t: 'matchEnd', winner: champ, wins: this.wins });
      }, 3000);
    } else {
      this.later(() => this.startRound(), 3600);
    }
  }

  tick(now = Date.now()) {
    if (this.phase === 'fight' && now >= this.roundEndsAt && this.count === 2) {
      const [a, b] = this.slots;
      const winner = a.hp > b.hp ? 0 : b.hp > a.hp ? 1 : -1;
      this.endRound(winner, 'time');
    }
  }

  handle(p, msg) {
    const i = this.slots.indexOf(p);
    if (i < 0 || !msg || typeof msg.t !== 'string') return;
    const opp = this.slots[1 - i];

    switch (msg.t) {
      case 's': {
        const s = {
          t: 's',
          x: num(msg.x), y: num(msg.y), z: num(msg.z), r: num(msg.r, 100),
          an: ANIMS.includes(msg.an) ? msg.an : 'idle',
          at: num(msg.at, 10), ai: num(msg.ai | 0, 1e9), mv: num(msg.mv, 10),
          blk: !!msg.blk,
        };
        p.state = s;
        if (opp) opp.send(s);
        break;
      }
      case 'hit': {
        if (this.phase !== 'fight' || !opp || !(msg.kind in DAMAGE)) return;
        const now = Date.now();
        if (now - (p.lastHit || 0) < HIT_COOLDOWN) return;
        const kind = msg.kind;
        if (p.state && opp.state) {
          const d = Math.hypot(p.state.x - opp.state.x, p.state.z - opp.state.z);
          if (d > (kind === 'fire' ? FIRE_RANGE : MELEE_RANGE)) return;
        }
        if (kind === 'fire') {
          if (!p.fireAt || now - p.fireAt > FIRE_LIFETIME) return;
          p.fireAt = 0;
        }
        p.lastHit = now;
        const blocked = !!(opp.state && opp.state.blk);
        let dmg = DAMAGE[kind] * (STYLE_STATS[p.profile.style]?.dmg || 1);
        if (blocked) dmg *= CHIP;
        dmg = Math.max(1, Math.round(dmg));
        opp.hp = Math.max(0, opp.hp - dmg);
        p.meter = Math.min(METER_MAX, p.meter + dmg * (blocked ? 1.5 : 1.6));
        opp.meter = Math.min(METER_MAX, opp.meter + dmg * 0.9);
        this.broadcast({
          t: 'hit', by: i, kind, blocked, dmg,
          hp: this.slots.map((s) => s.hp), meter: this.slots.map((s) => s.meter),
        });
        if (opp.hp <= 0) this.endRound(i, 'ko');
        break;
      }
      case 'special': {
        if (this.phase !== 'fight' || !opp || p.meter < METER_MAX) return;
        p.meter = 0;
        p.fireAt = Date.now();
        opp.send({ t: 'fx', by: i, x: num(msg.x), y: num(msg.y), z: num(msg.z), dx: num(msg.dx, 1), dz: num(msg.dz, 1) });
        this.broadcast({ t: 'meter', meter: this.slots.map((s) => s.meter) });
        break;
      }
      case 'rematch': {
        if (this.phase !== 'matchEnd' || !opp) return;
        this.rematch[i] = true;
        this.broadcast({ t: 'rematch', ready: this.rematch });
        if (this.rematch[0] && this.rematch[1]) this.startMatch();
        break;
      }
      case 'ping':
        p.send({ t: 'pong', t0: msg.t0 });
        break;
    }
  }
}
