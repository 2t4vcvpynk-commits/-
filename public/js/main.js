// メニュー画面と画面遷移
import { Game } from './game.js';
import { Net } from './net.js';
import { hud } from './hud.js';
import { unlockAudio } from './sfx.js';
import {
  OPTIONS, COLOR_KEYS, STYLE_STATS, DEFAULT_PROFILE, sanitizeProfile, randomProfile,
} from './shared/profile.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'kobushi3d.profile';
const LABELS = { hair: '髪型', head: '顔', acc: 'アクセ', build: '体格', style: 'スタイル' };

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
        if (key === 'style') game.previewAttack('kick');
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
  $('styleDesc').textContent = `スタイル「${OPTIONS.style.find(([v]) => v === profile.style)[1]}」: ${STYLE_STATS[profile.style].desc}`;
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
