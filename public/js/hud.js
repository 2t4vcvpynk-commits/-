// 画面上の体力ゲージなど
import { MAX_HP, METER_MAX, WINS_NEEDED } from './shared/room.js';

const $ = (id) => document.getElementById(id);
let announceTimer = 0;

export const hud = {
  show(on) {
    $('hud').hidden = !on;
  },
  setup(names, colors) {
    for (let s = 0; s < 2; s++) {
      $(`name${s}`).textContent = names[s];
      $(`hud${s}`).style.setProperty('--pc', colors[s]);
      this.setHp(s, MAX_HP, true);
      this.setMeter(s, 0);
      this.setWins(s, 0);
    }
    this.setTimer('');
  },
  setHp(s, hp, instant = false) {
    const pct = `${(Math.max(0, hp) / MAX_HP) * 100}%`;
    const fill = $(`hp${s}`);
    const lag = $(`hpl${s}`);
    fill.style.width = pct;
    fill.classList.toggle('low', hp <= 30);
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
