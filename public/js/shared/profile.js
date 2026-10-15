// キャラクター設定（サーバーとブラウザの両方で使う）

export const OPTIONS = {
  hair: [['none', 'なし'], ['spiky', 'ツンツン'], ['mohawk', 'モヒカン'], ['afro', 'アフロ'], ['long', 'ロング'], ['bun', 'おだんご']],
  head: [['round', 'まる'], ['square', 'しかく']],
  acc: [['none', 'なし'], ['headband', 'ハチマキ'], ['horns', 'ツノ'], ['crown', '王冠'], ['mask', 'マスク'], ['shades', 'サングラス']],
  build: [['slim', 'ほそみ'], ['normal', 'ふつう'], ['heavy', 'ガッチリ']],
  style: [['balanced', 'バランス'], ['power', 'パワー'], ['speed', 'スピード']],
};

export const COLOR_KEYS = [
  ['skin', '肌'],
  ['top', '服'],
  ['bottom', 'ズボン'],
  ['glove', 'グローブ'],
  ['hairColor', '髪'],
  ['accColor', 'アクセ'],
];

// スタイルごとの性能差
export const STYLE_STATS = {
  balanced: { dmg: 1.0, speed: 1.0, desc: '攻撃力・スピードともに標準' },
  power: { dmg: 1.2, speed: 0.88, desc: '攻撃力 +20% / 移動 -12%' },
  speed: { dmg: 0.85, speed: 1.2, desc: '攻撃力 -15% / 移動 +20%' },
};

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
  style: 'balanced',
};

const HEX = /^#[0-9a-fA-F]{6}$/;

export function sanitizeProfile(p) {
  const out = { ...DEFAULT_PROFILE };
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
    style: pick(OPTIONS.style)[0],
  });
}
