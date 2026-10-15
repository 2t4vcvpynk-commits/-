// メニュー画面と画面遷移
import { Game } from './game.js';
import { Net } from './net.js';
import { hud } from './hud.js';
import { unlockAudio } from './sfx.js';
import {
  OPTIONS, COLOR_KEYS, DEFAULT_PROFILE, sanitizeProfile, randomProfile,
  STAT_KEYS, STAT_POINTS, STAT_MAX, SKILLS, SKILL_IDS, statMods,
} from './shared/profile.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'kobushi3d.profile';
const LABELS = { hair: '髪型', head: '顔', acc: 'アクセ', build: '体格' };

function loadProfile() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return sanitizeProfile(JSON.parse(raw));
  } catch { /* 保存データなし */ }
  return { ...DEFAULT_PROFILE };
}
function saveProfile() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(profile));
  } catch { /* 保存できなくても続行 */ }
}

let profile = loadProfile();
const game = new Game($('c'));
if (location.hash === '#debug') window.game = game; // 動作確認用
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
game.input.bindTouch($('touch'));
game.input.lockOn = isTouch; // スマホは最初からロックオン
$('lock').addEventListener('click', () => game.input.toggleLock());

// ---- トースト ----
let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ---- キャラメイク UI ----
function buildEditor() {
  const opts = $('opts');
  for (const key of Object.keys(OPTIONS)) {
    const row = document.createElement('div');
    row.className = 'field';
    row.innerHTML = `<span>${LABELS[key]}</span>`;
    const chips = document.createElement('div');
    chips.className = 'chips';
    chips.dataset.key = key;
    for (const [val, label] of OPTIONS[key]) {
      const b = document.createElement('button');
      b.className = 'chip';
      b.textContent = label;
      b.dataset.val = val;
      b.addEventListener('click', () => {
        profile[key] = val;
        onProfileChange();
      });
      chips.appendChild(b);
    }
    row.appendChild(chips);
    opts.appendChild(row);
  }
  const colors = $('colors');
  for (const [key, label] of COLOR_KEYS) {
    const l = document.createElement('label');
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.dataset.key = key;
    inp.addEventListener('input', () => {
      profile[key] = inp.value;
      onProfileChange();
    });
    l.append(inp, label);
    colors.appendChild(l);
  }
  $('pname').addEventListener('input', () => {
    profile.name = $('pname').value;
    saveProfile();
  });
  $('pname').addEventListener('change', () => {
    profile = sanitizeProfile(profile);
    $('pname').value = profile.name;
    saveProfile();
  });
  $('pheight').addEventListener('input', () => {
    profile.height = Number($('pheight').value);
    onProfileChange();
  });
  buildStats();
  buildSkills();
  $('random').addEventListener('click', () => {
    profile = randomProfile(profile.name);
    onProfileChange();
    game.previewAttack('win');
  });
}

function syncEditor() {
  $('pname').value = profile.name;
  $('pheight').value = profile.height;
  document.querySelectorAll('#opts .chips').forEach((c) => {
    c.querySelectorAll('.chip').forEach((b) => b.classList.toggle('on', b.dataset.val === profile[c.dataset.key]));
  });
  document.querySelectorAll('#colors input').forEach((i) => { i.value = profile[i.dataset.key]; });
  syncStats();
  syncSkills();
}

// ---- ステータス振り分け ----
const statTotal = () => STAT_KEYS.reduce((n, [k]) => n + profile.stats[k], 0);

function statLabel(k, mods) {
  if (k === 'atk') return `ダメージ×${mods.atk.toFixed(2)}`;
  if (k === 'def') return `被ダメ×${mods.def.toFixed(2)}`;
  if (k === 'spd') return `速さ×${mods.spd.toFixed(2)}`;
  return `HP ${mods.maxHp}`;
}

function buildStats() {
  const box = $('stats');
  for (const [k, label] of STAT_KEYS) {
    const row = document.createElement('div');
    row.className = 'stat';
    row.dataset.key = k;
    row.innerHTML = `<span>${label}</span><button data-d="-1">−</button><div class="pips">${'<i></i>'.repeat(STAT_MAX)}</div><button data-d="1">＋</button><em></em>`;
    row.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      const v = profile.stats[k] + Number(b.dataset.d);
      if (v < 0 || v > STAT_MAX) return;
      if (Number(b.dataset.d) > 0 && statTotal() >= STAT_POINTS) return;
      profile.stats[k] = v;
      syncStats();
      saveProfile();
    }));
    box.appendChild(row);
  }
}

function syncStats() {
  const left = STAT_POINTS - statTotal();
  const mods = statMods(profile);
  $('statLeft').textContent = `残り ${left} pt`;
  $('statLeft').classList.toggle('zero', left === 0);
  document.querySelectorAll('#stats .stat').forEach((row) => {
    const k = row.dataset.key;
    const v = profile.stats[k];
    row.querySelectorAll('.pips i').forEach((p, i) => p.classList.toggle('on', i < v));
    row.querySelector('[data-d="-1"]').disabled = v <= 0;
    row.querySelector('[data-d="1"]').disabled = v >= STAT_MAX || left <= 0;
    row.querySelector('em').textContent = statLabel(k, mods);
  });
}

// ---- 超能力えらび ----
let activeSlot = 0;
const SKILL_ANIM = { fire: 'special', beam: 'special', wave: 'stomp', blink: 'p2' };

function buildSkills() {
  const list = $('skillList');
  for (const id of SKILL_IDS) {
    const d = SKILLS[id];
    const b = document.createElement('button');
    b.className = 'skill-card';
    b.dataset.id = id;
    b.innerHTML = `<div class="t">${d.icon} ${d.name}</div><p>${d.desc}</p><div class="meta">${d.sp ? '⚡ SPゲージMAXで使用' : `クールダウン ${d.cd}秒`}</div>`;
    b.addEventListener('click', () => {
      const other = 1 - activeSlot;
      if (profile.skills[other] === id) profile.skills[other] = profile.skills[activeSlot];
      profile.skills[activeSlot] = id;
      activeSlot = other;
      syncSkills();
      saveProfile();
      game.previewAttack(SKILL_ANIM[id] || 'cast');
    });
    list.appendChild(b);
  }
}

function syncSkills() {
  const slots = $('skillSlots');
  slots.innerHTML = '';
  profile.skills.forEach((id, i) => {
    const d = SKILLS[id];
    const el = document.createElement('div');
    el.className = `slot${i === activeSlot ? ' active' : ''}`;
    el.innerHTML = `<small>技${i + 1}（${i === 0 ? 'U' : 'I'}キー）${i === activeSlot ? '← 変更中' : ''}</small>${d.icon} ${d.name}`;
    el.addEventListener('click', () => {
      activeSlot = i;
      syncSkills();
    });
    slots.appendChild(el);
  });
  document.querySelectorAll('#skillList .skill-card').forEach((c) => {
    c.classList.toggle('on', profile.skills.includes(c.dataset.id));
  });
}

let rebuildTimer = 0;
function onProfileChange() {
  syncEditor();
  saveProfile();
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(() => game.setPreview(profile), 30);
}

buildEditor();
syncEditor();
game.setPreview(profile);

// ---- 画面切り替え ----
function show(screen) {
  $('menu').hidden = screen !== 'menu';
  $('waiting').hidden = screen !== 'waiting';
  $('result').hidden = screen !== 'result';
  $('touch').hidden = !(screen === 'match' && isTouch);
}

function backToMenu(msg) {
  game.leave();
  show('menu');
  if (msg) toast(msg);
  history.replaceState(null, '', location.pathname);
}

function currentProfile() {
  profile = sanitizeProfile(profile);
  saveProfile();
  return profile;
}

game.events = {
  onJoined(code, you) {
    $('roomCode').textContent = code;
    $('shareUrl').value = `${location.origin}${location.pathname}?room=${code}`;
    if (you === 0) show('waiting');
    history.replaceState(null, '', `?room=${code}`);
  },
  onMatch() {
    show('match');
  },
  onError(msg) {
    backToMenu(msg);
  },
  onOppLeft() {
    toast('相手が退出しました。新しい相手を待っています');
    show('waiting');
  },
  onMatchEnd(win, wins, me) {
    $('resultTitle').textContent = win ? 'YOU WIN!' : 'YOU LOSE…';
    $('resultTitle').className = win ? 'win' : 'lose';
    $('resultSub').textContent = `${wins[me]} - ${wins[1 - me]}`;
    $('again').disabled = false;
    $('again').textContent = 'もう一戦！';
    $('rematchStatus').textContent = '';
    show('result');
  },
  onRematch(ready, me) {
    if (ready[0] && ready[1]) return;
    if (ready[me]) $('rematchStatus').textContent = '相手の返事を待っています…';
    else if (ready[1 - me]) $('rematchStatus').textContent = '相手が再戦を希望しています！';
  },
};

async function goOnline(first) {
  unlockAudio();
  const btns = [$('create'), $('join')];
  btns.forEach((b) => { b.disabled = true; });
  const net = new Net();
  try {
    await net.connect();
  } catch (e) {
    toast(e.message);
    btns.forEach((b) => { b.disabled = false; });
    return;
  }
  btns.forEach((b) => { b.disabled = false; });
  net.onClose = () => backToMenu('サーバーとの接続が切れました');
  game.startOnline(net);
  net.send(first);
}

$('create').addEventListener('click', () => goOnline({ t: 'create', profile: currentProfile() }));
$('join').addEventListener('click', () => {
  const code = $('code').value.trim().toUpperCase();
  if (code.length !== 4) {
    toast('4文字のルームコードを入力してください');
    return;
  }
  goOnline({ t: 'join', code, profile: currentProfile() });
});
$('code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('join').click();
});
$('practice').addEventListener('click', () => {
  unlockAudio();
  game.startPractice(currentProfile());
});
$('cancelWait').addEventListener('click', () => backToMenu());
$('copy').addEventListener('click', async () => {
  const url = $('shareUrl').value;
  try {
    if (navigator.share && isTouch) await navigator.share({ title: 'KOBUSHI 3D', text: '殴りあおうぜ！', url });
    else {
      await navigator.clipboard.writeText(url);
      toast('リンクをコピーしました');
    }
  } catch {
    $('shareUrl').select();
  }
});
$('again').addEventListener('click', () => {
  game.rematch();
  if (!game.practice) {
    $('again').disabled = true;
    $('rematchStatus').textContent = '相手の返事を待っています…';
  }
});
$('toMenu').addEventListener('click', () => backToMenu());
$('quit').addEventListener('click', () => {
  if (confirm('対戦をやめてメニューに戻りますか？')) backToMenu();
});
document.addEventListener('pointerdown', unlockAudio, { once: true });

// 招待リンク ?room=XXXX
const invited = new URLSearchParams(location.search).get('room');
if (invited) {
  $('code').value = invited.toUpperCase().slice(0, 4);
  toast(`ルーム「${$('code').value}」に招待されています。キャラを決めて「参加」を押してください`);
}

show('menu');
hud.show(false);
