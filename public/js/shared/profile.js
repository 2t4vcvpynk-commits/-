// キャラクター設定（サーバーとブラウザの両方で使う）

export const OPTIONS = {
  hair: [['none', 'なし'], ['spiky', 'ツンツン'], ['mohawk', 'モヒカン'], ['afro', 'アフロ'], ['long', 'ロング'], ['bun', 'おだんご']],
  head: [['round', 'まる'], ['square', 'しかく']],
  acc: [['none', 'なし'], ['headband', 'ハチマキ'], ['horns', 'ツノ'], ['crown', '王冠'], ['mask', 'マスク'], ['shades', 'サングラス']],
  build: [['slim', 'ほそみ'], ['normal', 'ふつう'], ['heavy', 'ガッチリ']],
};

export const COLOR_KEYS = [
  ['skin', '肌'],
  ['top', '服'],
  ['bottom', 'ズボン'],
  ['glove', 'グローブ'],
  ['hairColor', '髪'],
  ['accColor', 'アクセ'],
];

// ---- ステータス振り分け ----
export const STAT_KEYS = [
  ['atk', '攻撃'],
  ['def', '防御'],
  ['spd', '速さ'],
  ['hp', '体力'],
];
export const STAT_POINTS = 10; // 合計ポイント
export const STAT_MAX = 6; // 1項目の上限

// ステータスから実際の性能を計算
export function statMods(profile) {
  const s = profile.stats;
  return {
    atk: 0.8 + s.atk * 0.08, // 与ダメージ倍率 0.80〜1.28
    def: 1.15 - s.def * 0.07, // 被ダメージ倍率 1.15〜0.73
    spd: 0.85 + s.spd * 0.06, // 移動速度倍率 0.85〜1.21
    maxHp: 80 + s.hp * 8, // 最大HP 80〜128
  };
}

// ---- 超能力（2つまで装備） ----
// cd: クールダウン秒 / sp: SPゲージMAXを消費する必殺級
export const SKILLS = {
  fire: { name: '気功弾', icon: '🔥', cd: 5, sp: false, desc: 'まっすぐ飛ぶエネルギー弾。柱で防がれる' },
  accel: { name: '時間加速', icon: '⏩', cd: 14, sp: false, desc: '5秒間、移動も攻撃も超高速になる' },
  timestop: { name: 'タイムストップ', icon: '⏱', cd: 20, sp: true, desc: '3秒間、相手の時間を止める。止まった相手はガードできない' },
  beam: { name: '超破壊光線', icon: '💥', cd: 18, sp: true, desc: 'ためて放つ極太ビーム。柱も貫通する大ダメージ' },
  blink: { name: '瞬間移動', icon: '🌀', cd: 7, sp: false, desc: '一瞬で相手の背後にワープ' },
  wave: { name: '衝撃波', icon: '💢', cd: 8, sp: false, desc: '地面を踏み抜き、周りの相手を吹き飛ばす' },
  armor: { name: '鋼の肉体', icon: '🛡', cd: 15, sp: false, desc: '5秒間、ダメージ半減＆ひるまない' },
  vamp: { name: '吸血', icon: '🩸', cd: 15, sp: false, desc: '6秒間、与えたダメージの半分を回復' },
  heal: { name: '回復', icon: '💚', cd: 30, sp: false, desc: 'HPを20回復する' },
};
export const SKILL_IDS = Object.keys(SKILLS);

export const DEFAULT_PROFILE = {
  name: 'ファイター',
  skin: '#f1c27d',
  top: '#e74c3c',
  bottom: '#2c3e50',
  glove: '#ffffff',
  hairColor: '#2b1a0e',
  accColor: '#c0392b',
  hair: 'spiky',
  head: 'round',
  acc: 'headband',
  build: 'normal',
  height: 1,
  stats: { atk: 3, def: 2, spd: 3, hp: 2 },
  skills: ['fire', 'accel'],
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitizeProfile(p) {
  const out = { ...DEFAULT_PROFILE, stats: { ...DEFAULT_PROFILE.stats }, skills: [...DEFAULT_PROFILE.skills] };
  if (!p || typeof p !== 'object') return out;
  if (typeof p.name === 'string') {
    const n = p.name.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12);
    if (n) out.name = n;
  }
  for (const [k] of COLOR_KEYS) {
    if (typeof p[k] === 'string' && HEX.test(p[k])) out[k] = p[k].toLowerCase();
  }
  for (const k of Object.keys(OPTIONS)) {
    if (OPTIONS[k].some(([v]) => v === p[k])) out[k] = p[k];
  }
  const h = Number(p.height);
  if (Number.isFinite(h)) out.height = Math.min(1.12, Math.max(0.88, h));
  if (p.stats && typeof p.stats === 'object') {
    const st = {};
    let total = 0;
    for (const [k] of STAT_KEYS) {
      const v = Math.round(Number(p.stats[k]));
      st[k] = Number.isFinite(v) ? Math.min(STAT_MAX, Math.max(0, v)) : 0;
      total += st[k];
    }
    if (total <= STAT_POINTS) out.stats = st;
  }
  if (Array.isArray(p.skills)) {
    const sk = p.skills.filter((id) => SKILL_IDS.includes(id)).slice(0, 2);
    if (sk.length === 2 && sk[0] !== sk[1]) out.skills = sk;
  }
  return out;
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const SKINS = ['#ffe0bd', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#a3d977', '#9fb8ff'];
const HAIRS = ['#2b1a0e', '#090909', '#a0522d', '#f4d03f', '#e74c3c', '#ecf0f1', '#8e44ad', '#3498db', '#2ecc71'];
const NAMES = ['リュウ', 'タイガー', 'ケン', 'サクラ', 'ゴウ', 'ミカ', 'ジン', 'ライ', 'ハヤテ', 'ブル', 'カエデ', 'ゲンジ'];

function randomStats() {
  const st = { atk: 0, def: 0, spd: 0, hp: 0 };
  const keys = Object.keys(st);
  for (let i = 0; i < STAT_POINTS; i++) {
    const k = pick(keys.filter((x) => st[x] < STAT_MAX));
    st[k]++;
  }
  return st;
}

function randomSkills() {
  const a = pick(SKILL_IDS);
  return [a, pick(SKILL_IDS.filter((x) => x !== a))];
}

export function randomProfile(name) {
  const hue = Math.floor(Math.random() * 360);
  return sanitizeProfile({
    name: name || pick(NAMES),
    skin: pick(SKINS),
    top: hslToHex(hue, 70, 50),
    bottom: hslToHex((hue + 180 + Math.random() * 60) % 360, 35, 25),
    glove: Math.random() < 0.5 ? '#ffffff' : hslToHex((hue + 30) % 360, 80, 55),
    hairColor: pick(HAIRS),
    accColor: hslToHex((hue + 120) % 360, 75, 50),
    hair: pick(OPTIONS.hair)[0],
    head: pick(OPTIONS.head)[0],
    acc: pick(OPTIONS.acc)[0],
    build: pick(OPTIONS.build)[0],
    height: 0.92 + Math.random() * 0.16,
    stats: randomStats(),
    skills: randomSkills(),
  });
}
