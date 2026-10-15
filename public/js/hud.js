// 画面上の体力ゲージなど
import { METER_MAX, WINS_NEEDED } from './shared/room.js';

const $ = (id) => document.getElementById(id);
let announceTimer = 0;
let skillDefs = [];
const maxHp = [100, 100];
const KEYS = ['U', 'I'];

export const hud = {
  show(on) {
    $('hud').hidden = !on;
  },
  setup(names, colors, maxHps = [100, 100]) {
    for (let s = 0; s < 2; s++) {
      maxHp[s] = maxHps[s];
      $(`name${s}`).textContent = names[s];
      $(`hud${s}`).style.setProperty('--pc', colors[s]);
      this.setHp(s, maxHp[s], true);
      this.setMeter(s, 0);
      this.setWins(s, 0);
    }
    this.setTimer('');
  },
  setHp(s, hp, instant = false) {
    const pct = `${(Math.max(0, hp) / maxHp[s]) * 100}%`;
    const fill = $(`hp${s}`);
    const lag = $(`hpl${s}`);
    fill.style.width = pct;
    fill.classList.toggle('low', hp <= maxHp[s] * 0.3);
    $(`hpn${s}`).textContent = `${Math.max(0, hp)} / ${maxHp[s]}`;
    if (instant) {
      lag.style.transition = 'none';
      lag.style.width = pct;
      void lag.offsetWidth;
      lag.style.transition = '';
    } else {
      lag.style.width = pct;
    }
  },
  setMeter(s, v) {
    $(`m${s}`).style.width = `${(v / METER_MAX) * 100}%`;
    $(`hud${s}`).classList.toggle('sp-ready', v >= METER_MAX);
  },
  setWins(s, n) {
    const el = $(`wins${s}`);
    el.innerHTML = '';
    for (let i = 0; i < WINS_NEEDED; i++) {
      const d = document.createElement('span');
      if (i < n) d.className = 'on';
      el.appendChild(d);
    }
  },
  setTimer(t) {
    $('timer').textContent = t;
  },
  // 自分の超能力アイコン
  setSkills(defs) {
    skillDefs = defs;
    const box = $('skills');
    box.innerHTML = '';
    defs.forEach((d, i) => {
      const el = document.createElement('div');
      el.className = `skill${d.sp ? ' sp' : ''}`;
      el.innerHTML = `<div class="ic">${d.icon}</div><div class="cd"></div><b>${d.name}</b><kbd>${KEYS[i]}</kbd>`;
      box.appendChild(el);
      const btn = document.querySelector(`[data-act=skill${i + 1}]`);
      if (btn) {
        btn.innerHTML = `<span>${d.icon}</span><small>${d.name}</small><i class="cd"></i>`;
        btn.classList.toggle('spb', d.sp);
      }
    });
  },
  updateSkills(cds, spFull) {
    const els = $('skills').children;
    skillDefs.forEach((d, i) => {
      const left = Math.max(0, cds[i]);
      const k = left > 0 ? left / d.cd : 0;
      const locked = d.sp && !spFull;
      const ready = k === 0 && !locked;
      const h = `${Math.round(k * 100)}%`;
      const el = els[i];
      if (el) {
        el.querySelector('.cd').style.height = h;
        el.classList.toggle('ready', ready);
        el.classList.toggle('locked', locked && k === 0);
      }
      const btn = document.querySelector(`[data-act=skill${i + 1}]`);
      if (btn) {
        const c = btn.querySelector('.cd');
        if (c) c.style.height = h;
        btn.classList.toggle('ready', ready);
        btn.classList.toggle('locked', locked && k === 0);
      }
    });
  },
  flashSkill(i) {
    const el = $('skills').children[i];
    if (!el) return;
    el.classList.remove('used');
    void el.offsetWidth;
    el.classList.add('used');
  },
  toastSkill(who, def) {
    const el = $('skillToast');
    el.textContent = `${who} の ${def.icon}${def.name}！`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  },
  setLock(on) {
    const el = $('lock');
    el.classList.toggle('on', on);
    el.textContent = on ? '🎯 ロックオン中' : '👁 フリーカメラ';
    document.querySelectorAll('[data-act=lock]').forEach((b) => b.classList.toggle('active', on));
  },
  setPing(ms) {
    $('ping').textContent = ms == null ? '' : `${Math.round(ms)}ms`;
  },
  announce(text, cls = '', ms = 1400) {
    const el = $('announce');
    el.textContent = text;
    el.className = '';
    void el.offsetWidth;
    el.className = `show ${cls}`;
    clearTimeout(announceTimer);
    if (ms > 0) announceTimer = setTimeout(() => { el.className = ''; }, ms);
  },
  clearAnnounce() {
    clearTimeout(announceTimer);
    $('announce').className = '';
  },
};
