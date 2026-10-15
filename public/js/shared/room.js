// 対戦ルームのルール（HP・ラウンド・判定の検証・超能力）
// サーバー（オンライン対戦）とブラウザ（練習モード）の両方で同じコードを使う。

import { sanitizeProfile, statMods, SKILLS } from './profile.js';

export const ROUND_TIME = 60;
export const WINS_NEEDED = 2;
export const METER_MAX = 100;
export const TIMESTOP_MS = 3000;

// 技ごとのダメージ（ガード時は CHIP 倍）
export const DAMAGE = { p1: 5, p2: 6, p3: 10, kick: 12, air: 10, fire: 16, beam: 7, wave: 11 };
const CHIP = 0.2;
const MELEE_RANGE = 3.2; // 通信遅延を考慮した緩めの距離チェック
const RANGES = { fire: 30, beam: 40, wave: 5 };
const HIT_COOLDOWN = 110;
const CD_SLACK = 400; // クールダウン判定の余裕（ms）
// 能力ごとの持続時間（ms）
const BUFF = { accel: 5000, armor: 5000, vamp: 6000 };
// 能力で出した攻撃が有効な時間と回数
const WINDOW = { fire: [4000, 1], beam: [4500, 8], wave: [2500, 1] };

export const ANIMS = ['idle', 'walk', 'jump', 'block', 'blockhit', 'hit', 'ko', 'win',
  'p1', 'p2', 'p3', 'kick', 'air', 'special', 'dodge', 'cast', 'beam', 'stomp'];

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
    this.stop = null; // { by, until } タイムストップ
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
    player.mods = statMods(player.profile);
    player.idx = i;
    player.hp = player.mods.maxHp;
    player.meter = 0;
    player.state = null;
    this.resetPlayer(player);
    this.slots[i] = player;
    player.send({ t: 'joined', code: this.code, you: i });
    if (this.count === 2) this.startMatch();
    return i;
  }

  resetPlayer(p) {
    p.cdUntil = {};
    p.buffUntil = {};
    p.windows = {};
    p.lastHit = 0;
  }

  remove(player) {
    const i = this.slots.indexOf(player);
    if (i < 0) return;
    this.slots[i] = null;
    this.clearTimers();
    this.phase = 'waiting';
    this.stop = null;
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
    this.stop = null;
    for (const p of this.slots) {
      p.hp = p.mods.maxHp;
      this.resetPlayer(p);
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
    this.stop = null;
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
      const ra = a.hp / a.mods.maxHp;
      const rb = b.hp / b.mods.maxHp;
      const winner = ra > rb ? 0 : rb > ra ? 1 : -1;
      this.endRound(winner, 'time');
    }
  }

  // タイムストップで止められている？
  isStopped(i, now) {
    return !!this.stop && now < this.stop.until && this.stop.by !== i;
  }

  hpList() {
    return this.slots.map((s) => (s ? s.hp : 0));
  }

  meterList() {
    return this.slots.map((s) => (s ? s.meter : 0));
  }

  handle(p, msg) {
    const i = this.slots.indexOf(p);
    if (i < 0 || !msg || typeof msg.t !== 'string') return;
    const opp = this.slots[1 - i];
    const now = Date.now();

    switch (msg.t) {
      case 's': {
        const s = {
          t: 's',
          x: num(msg.x), y: num(msg.y), z: num(msg.z), r: num(msg.r, 100),
          an: ANIMS.includes(msg.an) ? msg.an : 'idle',
          at: num(msg.at, 10), ai: num(msg.ai | 0, 1e9), mv: num(msg.mv, 20),
          blk: !!msg.blk, inv: !!msg.inv,
        };
        p.state = s;
        if (opp) opp.send(s);
        break;
      }
      case 'hit': {
        if (this.phase !== 'fight' || !opp || !(msg.kind in DAMAGE)) return;
        if (this.isStopped(i, now)) return;
        const kind = msg.kind;
        if (now - p.lastHit < HIT_COOLDOWN) return;
        if (p.state && opp.state) {
          const d = Math.hypot(p.state.x - opp.state.x, p.state.z - opp.state.z);
          if (d > (RANGES[kind] || MELEE_RANGE)) return;
        }
        // 能力で出した攻撃は、発動後の一定時間・回数だけ有効
        if (WINDOW[kind]) {
          const w = p.windows[kind];
          if (!w || now > w.until || w.left <= 0) return;
          w.left--;
        }
        const stopped = this.isStopped(1 - i, now);
        if (!stopped && opp.state && opp.state.inv) return; // 回避中は無敵
        p.lastHit = now;
        const blocked = !stopped && !!(opp.state && opp.state.blk);
        let dmg = DAMAGE[kind] * p.mods.atk * opp.mods.def;
        if (now < (opp.buffUntil.armor || 0)) dmg *= 0.5;
        if (blocked) dmg *= CHIP;
        dmg = Math.max(1, Math.round(dmg));
        opp.hp = Math.max(0, opp.hp - dmg);
        if (now < (p.buffUntil.vamp || 0)) p.hp = Math.min(p.mods.maxHp, p.hp + Math.ceil(dmg * 0.5));
        p.meter = Math.min(METER_MAX, p.meter + dmg * (blocked ? 1.5 : 1.6));
        opp.meter = Math.min(METER_MAX, opp.meter + dmg * 0.9);
        this.broadcast({
          t: 'hit', by: i, kind, blocked, dmg, stopped,
          hp: this.hpList(), meter: this.meterList(),
        });
        if (opp.hp <= 0) this.endRound(i, 'ko');
        break;
      }
      case 'ability': {
        const id = msg.id;
        const def = SKILLS[id];
        if (this.phase !== 'fight' || !opp || !def || !p.profile.skills.includes(id)) return;
        if (this.isStopped(i, now)) return;
        if (now < (p.cdUntil[id] || 0)) return;
        if (def.sp && p.meter < METER_MAX) return;
        p.cdUntil[id] = now + def.cd * 1000 - CD_SLACK;
        if (def.sp) p.meter = 0;
        if (BUFF[id]) p.buffUntil[id] = now + BUFF[id];
        if (WINDOW[id]) p.windows[id] = { until: now + WINDOW[id][0], left: WINDOW[id][1] };
        if (id === 'heal') p.hp = Math.min(p.mods.maxHp, p.hp + 20);
        if (id === 'timestop') this.stop = { by: i, until: now + TIMESTOP_MS };
        this.broadcast({
          t: 'ability', by: i, id,
          x: num(msg.x), y: num(msg.y), z: num(msg.z), dx: num(msg.dx, 1), dz: num(msg.dz, 1),
          dur: id === 'timestop' ? TIMESTOP_MS : BUFF[id] || 0,
          hp: this.hpList(), meter: this.meterList(),
        });
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
