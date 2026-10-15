// カスタマイズ可能なファイターの3Dモデルとアニメーション
import * as THREE from 'three';
import { sanitizeProfile } from './shared/profile.js';

const KEYS = ['hy', 'tx', 'ty', 'tz', 'hx', 'lsx', 'lsz', 'lex', 'rsx', 'rsz', 'rex',
  'lhx', 'lhz', 'lkx', 'rhx', 'rhz', 'rkx', 'bx', 'by'];

// 基本の構え（オーソドックス）
const G = {
  hy: -0.05, tx: 0.12, ty: -0.25, tz: 0, hx: -0.1,
  lsx: -1.05, lsz: 0.2, lex: -1.95,
  rsx: -0.75, rsz: 0.25, rex: -2.15,
  lhx: -0.35, lhz: 0.1, lkx: 0.35,
  rhx: 0.25, rhz: 0.12, rkx: 0.4,
  bx: 0, by: 0,
};
const P = (o) => ({ ...G, ...o });

const JAB = P({ lsx: -1.6, lsz: 0.05, lex: -0.08, ty: -0.7, tx: 0.18, hx: -0.05 });
const STR = P({ rsx: -1.6, rsz: 0.05, rex: -0.08, ty: 0.5, lhx: -0.45, rhx: 0.35, rkx: 0.2 });
const UPW = P({ hy: -0.18, rsx: -0.2, rex: -1.6, ty: -0.4, tx: 0.3, lkx: 0.8, rkx: 0.8 });
const UP = P({ hy: 0.03, rsx: -2.75, rsz: 0.1, rex: -0.45, ty: 0.5, tx: -0.15, hx: -0.2, lkx: 0.2, rkx: 0.2 });
const KCH = P({ rhx: -1.3, rkx: 1.9, tx: -0.1, ty: 0.15, lkx: 0.25, lsx: -0.9, rsx: -0.4, rex: -1.6 });
const KEX = P({ rhx: -1.55, rkx: 0.05, tx: -0.35, ty: 0.25, lkx: 0.15, lhx: -0.1, lsx: -0.9, rsx: -0.3, rsz: 0.5, rex: -1.4 });
const JUMP = P({ lhx: -0.9, lkx: 1.6, rhx: -0.3, rkx: 1.4, hy: 0.05 });
const AIRK = P({ lhx: -1.3, lkx: 1.9, rhx: -0.9, rkx: 0.05, tx: 0.1, lsx: -0.6, rsx: -0.6, lsz: 0.6, rsz: 0.6, lex: -1.0, rex: -1.0 });
const HIT = P({ tx: -0.45, hx: -0.5, ty: 0, lsx: -0.3, rsx: -0.4, lsz: 0.5, rsz: 0.5, lex: -0.6, rex: -0.6, hy: -0.08 });
const BLK = P({ lsx: -1.45, lsz: -0.25, lex: -2.35, rsx: -1.45, rsz: -0.25, rex: -2.35, tx: 0.25, hx: 0.25, hy: -0.1, lkx: 0.6, rkx: 0.6, ty: 0 });
const BLK2 = { ...BLK, tx: 0.02, hy: -0.15 };
const KO = P({ bx: -1.45, by: 0.14, tx: 0, hx: -0.2, ty: 0, hy: 0, lsx: -0.2, lsz: 1.3, lex: -0.3, rsx: -0.2, rsz: 1.3, rex: -0.3, lhx: -0.2, lkx: 0.3, rhx: -0.1, rkx: 0.1 });
const SPW = P({ lsx: -0.5, lsz: 0.3, lex: -1.9, rsx: -0.5, rsz: 0.3, rex: -1.9, ty: -0.8, tx: 0, hy: -0.12, lkx: 0.6, rkx: 0.6 });
const SPX = P({ lsx: -1.55, lsz: -0.2, lex: -0.05, rsx: -1.55, rsz: -0.2, rex: -0.05, ty: 0, tx: 0.15, hy: -0.12, lhx: -0.5, rhx: 0.4, lkx: 0.5, rkx: 0.3 });

const DGE = P({ hy: -0.32, tx: 0.7, ty: 0, hx: -0.3, lsx: 0.4, lsz: 0.3, lex: -1.2, rsx: 0.4, rsz: 0.3, rex: -1.2, lhx: -1.0, lkx: 1.6, rhx: 0.2, rkx: 1.4 });

const TRACKS = {
  p1: [[0, G], [0.07, JAB], [0.16, JAB], [0.28, G]],
  p2: [[0, G], [0.08, STR], [0.17, STR], [0.3, G]],
  p3: [[0, G], [0.12, UPW], [0.2, UP], [0.32, UP], [0.5, G]],
  kick: [[0, G], [0.14, KCH], [0.22, KEX], [0.33, KEX], [0.55, G]],
  air: [[0, JUMP], [0.06, AIRK], [0.36, AIRK], [0.45, JUMP]],
  special: [[0, G], [0.18, SPW], [0.27, SPX], [0.5, SPX], [0.62, G]],
  hit: [[0, G], [0.06, HIT], [0.3, HIT], [0.5, G]],
  blockhit: [[0, BLK], [0.05, BLK2], [0.15, BLK]],
  ko: [[0, HIT], [0.15, HIT], [0.7, KO]],
  dodge: [[0, G], [0.07, DGE], [0.3, DGE], [0.42, G]],
};

const smooth = (x) => x * x * (3 - 2 * x);

function sampleTrack(track, t, out) {
  let i = 0;
  while (i < track.length - 1 && t >= track[i + 1][0]) i++;
  const [t0, a] = track[i];
  const next = track[i + 1];
  if (!next) {
    for (const k of KEYS) out[k] = a[k];
    return out;
  }
  const [t1, b] = next;
  const f = smooth(Math.min(1, Math.max(0, (t - t0) / (t1 - t0))));
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * f;
  return out;
}

const FAST = new Set(['p1', 'p2', 'p3', 'kick', 'air', 'special', 'hit', 'blockhit', 'dodge']);

export class Fighter {
  constructor(profile) {
    this.profile = sanitizeProfile(profile);
    this.root = new THREE.Group(); // 位置と向き
    this.body = new THREE.Group(); // ダウン時の傾き
    this.root.add(this.body);
    this.anim = 'idle';
    this.t = 0;
    this.moveSpeed = 0;
    this.walkPh = 0;
    this.pose = { ...G };
    this.target = { ...G };
    this.build();
    this.applyPose();
  }

  build() {
    const p = this.profile;
    const bw = { slim: 0.85, normal: 1, heavy: 1.25 }[p.build];
    const mats = [];
    const mat = (color, extra = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05, ...extra });
      mats.push(m);
      return m;
    };
    const skin = mat(p.skin);
    const top = mat(p.top);
    const bottom = mat(p.bottom);
    const glove = mat(p.glove, { roughness: 0.35 });
    const hairM = mat(p.hairColor, { roughness: 0.8 });
    const accM = mat(p.accColor, { roughness: 0.4 });
    const dark = mat('#151515', { roughness: 0.3 });
    const white = mat('#ffffff', { roughness: 0.3 });
    const gold = mat('#f5c542', { roughness: 0.25, metalness: 0.8 });
    const ivory = mat('#f3ead3', { roughness: 0.5 });
    this.materials = mats;

    const mesh = (geo, m, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(geo, m);
      o.position.set(x, y, z);
      o.castShadow = true;
      return o;
    };
    const group = (x = 0, y = 0, z = 0) => {
      const g = new THREE.Group();
      g.position.set(x, y, z);
      return g;
    };

    const j = {};
    j.hips = group(0, 0.95, 0);
    this.body.add(j.hips);
    j.hips.add(mesh(new THREE.BoxGeometry(0.4 * bw, 0.2, 0.25 * bw), bottom, 0, 0, 0));
    // ベルト
    const belt = mesh(new THREE.CylinderGeometry(0.21 * bw, 0.21 * bw, 0.07, 16), accM, 0, 0.08, 0);
    belt.scale.z = 0.65;
    j.hips.add(belt);

    j.torso = group(0, 0.1, 0);
    j.hips.add(j.torso);
    const chest = mesh(new THREE.CylinderGeometry(0.27 * bw, 0.2 * bw, 0.56, 16), top, 0, 0.3, 0);
    chest.scale.z = 0.65;
    j.torso.add(chest);
    const shoulders = mesh(new THREE.SphereGeometry(0.27 * bw, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), top, 0, 0.56, 0);
    shoulders.scale.set(1, 0.35, 0.65);
    j.torso.add(shoulders);
    j.torso.add(mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.14, 10), skin, 0, 0.66, 0));

    // 頭
    j.head = group(0, 0.7, 0);
    j.torso.add(j.head);
    const hr = 0.19;
    if (p.head === 'square') {
      j.head.add(mesh(new THREE.BoxGeometry(0.34, 0.38, 0.34), skin, 0, 0.18, 0));
    } else {
      const h = mesh(new THREE.SphereGeometry(hr, 24, 18), skin, 0, 0.18, 0);
      h.scale.set(1, 1.1, 1);
      j.head.add(h);
    }
    const faceZ = p.head === 'square' ? 0.172 : 0.17;
    for (const s of [-1, 1]) {
      j.head.add(mesh(new THREE.BoxGeometry(0.045, 0.06, 0.02), dark, s * 0.07, 0.2, faceZ));
      j.head.add(mesh(new THREE.BoxGeometry(0.02, 0.02, 0.01), white, s * 0.06, 0.215, faceZ + 0.011));
      const brow = mesh(new THREE.BoxGeometry(0.08, 0.018, 0.02), hairM, s * 0.075, 0.255, faceZ - 0.005);
      brow.rotation.z = s * 0.25;
      j.head.add(brow);
    }
    j.head.add(mesh(new THREE.BoxGeometry(0.07, 0.015, 0.02), dark, 0, 0.1, faceZ - 0.01));

    this.buildHair(j.head, p.hair, hairM, mesh);
    this.buildAcc(j.head, p.acc, { accM, gold, ivory, dark }, mesh, p.head === 'square');

    // 腕
    for (const s of [1, -1]) {
      const side = s === 1 ? 'l' : 'r';
      const sh = group(s * 0.31 * bw, 0.52, 0);
      j.torso.add(sh);
      sh.add(mesh(new THREE.SphereGeometry(0.095 * bw, 12, 10), top, 0, 0, 0));
      sh.add(mesh(new THREE.CapsuleGeometry(0.075 * bw, 0.2, 4, 10), skin, 0, -0.16, 0));
      const el = group(0, -0.3, 0);
      sh.add(el);
      el.add(mesh(new THREE.CapsuleGeometry(0.065 * bw, 0.18, 4, 10), skin, 0, -0.13, 0));
      const fist = mesh(new THREE.SphereGeometry(0.1 * Math.sqrt(bw), 14, 12), glove, 0, -0.31, 0);
      fist.scale.set(1, 1.05, 1.15);
      el.add(fist);
      el.add(mesh(new THREE.CylinderGeometry(0.075, 0.08, 0.06, 12), glove, 0, -0.22, 0));
      j[side + 'Sh'] = sh;
      j[side + 'El'] = el;
    }
    // 脚
    for (const s of [1, -1]) {
      const side = s === 1 ? 'l' : 'r';
      const hip = group(s * 0.12 * bw, 0, 0);
      j.hips.add(hip);
      hip.add(mesh(new THREE.CapsuleGeometry(0.1 * bw, 0.27, 4, 10), bottom, 0, -0.22, 0));
      const kn = group(0, -0.45, 0);
      hip.add(kn);
      kn.add(mesh(new THREE.CapsuleGeometry(0.085 * bw, 0.27, 4, 10), bottom, 0, -0.21, 0));
      kn.add(mesh(new THREE.BoxGeometry(0.14, 0.09, 0.26), dark, 0, -0.45, 0.05));
      j[side + 'Hip'] = hip;
      j[side + 'Kn'] = kn;
    }
    this.j = j;
    this.body.scale.setScalar(p.height);
  }

  buildHair(head, style, m, mesh) {
    const cap = () => {
      const c = mesh(new THREE.SphereGeometry(0.205, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.4), m, 0, 0.215, -0.01);
      c.scale.set(1, 1.08, 1.02);
      return c;
    };
    if (style === 'none') return;
    if (style === 'spiky') {
      head.add(cap());
      const n = 9;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const cone = mesh(new THREE.ConeGeometry(0.06, 0.22, 6), m, Math.sin(a) * 0.12, 0.36, Math.cos(a) * 0.12 - 0.03);
        cone.rotation.set(Math.cos(a) * 0.9 - 0.2, 0, -Math.sin(a) * 0.9);
        head.add(cone);
      }
      head.add(mesh(new THREE.ConeGeometry(0.07, 0.25, 6), m, 0, 0.45, -0.02));
    } else if (style === 'mohawk') {
      for (let i = 0; i < 7; i++) {
        const z = 0.15 - i * 0.055;
        const cone = mesh(new THREE.ConeGeometry(0.045, 0.22 - Math.abs(i - 3) * 0.02, 5), m, 0, 0.38 + Math.cos((i / 6) * Math.PI - Math.PI / 2) * 0.03, z);
        cone.rotation.x = -0.25 + i * 0.12;
        cone.scale.z = 0.5;
        head.add(cone);
      }
    } else if (style === 'afro') {
      head.add(mesh(new THREE.SphereGeometry(0.28, 18, 14), m, 0, 0.27, -0.05));
    } else if (style === 'long') {
      head.add(cap());
      head.add(mesh(new THREE.BoxGeometry(0.4, 0.42, 0.12), m, 0, 0.08, -0.14));
      for (const s of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.06, 0.3, 0.16), m, s * 0.19, 0.12, 0.0));
    } else if (style === 'bun') {
      head.add(cap());
      head.add(mesh(new THREE.SphereGeometry(0.1, 14, 10), m, 0, 0.42, -0.1));
    }
  }

  buildAcc(head, acc, { accM, gold, ivory, dark }, mesh, square) {
    const r = square ? 0.185 : 0.2;
    if (acc === 'headband') {
      const band = mesh(new THREE.CylinderGeometry(r * 0.97, r * 1.02, 0.06, 20, 1, true), accM, 0, 0.3, 0);
      band.material.side = THREE.DoubleSide;
      head.add(band);
      for (const s of [-1, 1]) {
        const tail = mesh(new THREE.BoxGeometry(0.05, 0.22, 0.015), accM, s * 0.05, 0.21, -r - 0.02);
        tail.rotation.set(0.5, 0, s * 0.35);
        head.add(tail);
      }
    } else if (acc === 'horns') {
      for (const s of [-1, 1]) {
        const h = mesh(new THREE.ConeGeometry(0.045, 0.2, 10), ivory, s * 0.13, 0.38, 0.02);
        h.rotation.z = -s * 0.55;
        head.add(h);
      }
    } else if (acc === 'crown') {
      const c = mesh(new THREE.CylinderGeometry(0.13, 0.12, 0.08, 12, 1, true), gold, 0, 0.42, 0);
      c.material.side = THREE.DoubleSide;
      head.add(c);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        head.add(mesh(new THREE.ConeGeometry(0.025, 0.07, 6), gold, Math.sin(a) * 0.125, 0.49, Math.cos(a) * 0.125));
      }
      head.add(mesh(new THREE.SphereGeometry(0.025, 8, 8), accM, 0, 0.42, 0.13));
    } else if (acc === 'mask') {
      const m = mesh(new THREE.CylinderGeometry(r + 0.01, r + 0.005, 0.13, 20, 1, true, -Math.PI / 2, Math.PI), accM, 0, 0.1, 0);
      m.material.side = THREE.DoubleSide;
      head.add(m);
    } else if (acc === 'shades') {
      const z = square ? 0.18 : 0.175;
      for (const s of [-1, 1]) head.add(mesh(new THREE.BoxGeometry(0.11, 0.06, 0.02), dark, s * 0.07, 0.21, z));
      head.add(mesh(new THREE.BoxGeometry(0.34, 0.015, 0.015), dark, 0, 0.23, z));
    }
  }

  play(name, force = false, t = 0) {
    if (name !== this.anim || force) {
      this.anim = name;
      this.t = t;
    }
  }

  computeTarget() {
    const out = this.target;
    const t = this.t;
    const a = this.anim;
    if (TRACKS[a]) return sampleTrack(TRACKS[a], t, out);
    Object.assign(out, G);
    switch (a) {
      case 'block': Object.assign(out, BLK); break;
      case 'jump': Object.assign(out, JUMP); break;
      case 'walk': {
        const ph = this.walkPh;
        out.lhx = G.lhx + Math.sin(ph) * 0.5;
        out.rhx = G.rhx - Math.sin(ph) * 0.5;
        out.lkx = 0.35 + Math.max(0, -Math.cos(ph)) * 0.7;
        out.rkx = 0.4 + Math.max(0, Math.cos(ph)) * 0.7;
        out.hy = -0.06 + Math.abs(Math.sin(ph)) * 0.035;
        out.lsx = G.lsx + Math.sin(ph) * 0.06;
        out.rsx = G.rsx - Math.sin(ph) * 0.06;
        break;
      }
      case 'win': {
        Object.assign(out, {
          rsx: -2.9, rsz: 0.15, rex: -0.25, lsx: -0.3, lsz: 0.2, lex: -1.6, ty: 0.1, tx: -0.05,
          hx: -0.15, hy: Math.abs(Math.sin(t * 6)) * 0.08 - 0.03, lhx: -0.1, rhx: 0.1, lkx: 0.1, rkx: 0.1,
        });
        break;
      }
      default: { // idle
        const b = Math.sin(t * 5);
        out.hy = G.hy + b * 0.022;
        out.lsx = G.lsx + b * 0.04;
        out.rsx = G.rsx - b * 0.04;
        out.lkx = G.lkx - b * 0.04;
        out.rkx = G.rkx - b * 0.04;
      }
    }
    return out;
  }

  update(dt) {
    this.t += dt;
    if (this.anim === 'walk') this.walkPh += dt * (7 + Math.abs(this.moveSpeed) * 1.4);
    const target = this.computeTarget();
    const rate = this.anim === 'ko' ? 9 : FAST.has(this.anim) ? 32 : 15;
    const k = 1 - Math.exp(-dt * rate);
    for (const key of KEYS) this.pose[key] += (target[key] - this.pose[key]) * k;
    this.applyPose();
  }

  applyPose() {
    const p = this.pose;
    const j = this.j;
    j.hips.position.y = 0.95 + p.hy;
    j.torso.rotation.set(p.tx, p.ty, p.tz);
    j.head.rotation.set(p.hx, -p.ty * 0.8, 0);
    j.lSh.rotation.set(p.lsx, 0, p.lsz);
    j.lEl.rotation.set(p.lex, 0, 0);
    j.rSh.rotation.set(p.rsx, 0, -p.rsz);
    j.rEl.rotation.set(p.rex, 0, 0);
    j.lHip.rotation.set(p.lhx, 0, p.lhz);
    j.lKn.rotation.set(p.lkx, 0, 0);
    j.rHip.rotation.set(p.rhx, 0, -p.rhz);
    j.rKn.rotation.set(p.rkx, 0, 0);
    this.body.rotation.x = p.bx;
    this.body.position.y = p.by;
  }

  dispose() {
    this.root.removeFromParent();
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    for (const m of this.materials) m.dispose();
  }
}
