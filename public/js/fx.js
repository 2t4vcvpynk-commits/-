// ヒットエフェクトと必殺技の弾
import * as THREE from 'three';

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.3, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.tex = glowTexture();
    this.parts = [];
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.8, 1, 32);
  }

  sprite(color, size) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: this.tex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    s.scale.setScalar(size);
    this.scene.add(s);
    return s;
  }

  spark(pos, color = '#ffd27a', power = 1, toward = null) {
    const n = Math.round(10 + power * 10);
    for (let i = 0; i < n; i++) {
      const s = this.sprite(i % 3 === 0 ? '#ffffff' : color, 0.12 + Math.random() * 0.2 * power);
      s.position.copy(pos);
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize()
        .multiplyScalar(3 + Math.random() * 6 * power);
      if (toward) v.addScaledVector(toward, 2);
      this.parts.push({ s, v, life: 0.25 + Math.random() * 0.3, max: 0.55, g: 9 });
    }
    const flash = this.sprite('#ffffff', 0.9 * power + 0.4);
    flash.position.copy(pos);
    this.parts.push({ s: flash, v: new THREE.Vector3(), life: 0.1, max: 0.1, g: 0, grow: 10 });

    const ring = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({
      color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    ring.position.copy(pos);
    ring.scale.setScalar(0.2);
    this.scene.add(ring);
    this.rings.push({ m: ring, life: 0.3, max: 0.3, size: 1.2 * power + 0.4 });
  }

  dust(pos) {
    for (let i = 0; i < 8; i++) {
      const s = this.sprite('#a08870', 0.4);
      s.material.blending = THREE.NormalBlending;
      s.material.opacity = 0.5;
      s.position.set(pos.x, 0.1, pos.z);
      const a = Math.random() * Math.PI * 2;
      this.parts.push({ s, v: new THREE.Vector3(Math.cos(a) * 2, 0.5, Math.sin(a) * 2), life: 0.5, max: 0.5, g: 0, grow: 1.5 });
    }
  }

  update(dt, camera) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.s.removeFromParent();
        p.s.material.dispose();
        this.parts.splice(i, 1);
        continue;
      }
      p.v.y -= p.g * dt;
      p.s.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(Math.exp(-dt * 3));
      if (p.grow) p.s.scale.multiplyScalar(1 + p.grow * dt);
      p.s.material.opacity = Math.min(1, (p.life / p.max) * 1.5) * (p.s.material.blending === THREE.NormalBlending ? 0.5 : 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= dt;
      if (r.life <= 0) {
        r.m.removeFromParent();
        r.m.material.dispose();
        if (r.own) r.m.geometry.dispose();
        this.rings.splice(i, 1);
        continue;
      }
      let k = 1 - r.life / r.max;
      if (r.reverse) k = 1 - k;
      r.m.scale.setScalar(0.2 + k * r.size);
      r.m.material.opacity = (r.reverse ? k : 1 - k) * (r.flat ? 0.8 : 1);
      if (!r.flat) r.m.quaternion.copy(camera.quaternion);
    }
  }

  clear() {
    for (const p of this.parts) p.s.removeFromParent();
    for (const r of this.rings) r.m.removeFromParent();
    this.parts.length = 0;
    this.rings.length = 0;
  }
}

// 必殺技「気功弾」
export class Fireball {
  constructor(fx, owner, pos, dir, color) {
    this.fx = fx;
    this.owner = owner; // 発射したプレイヤー番号
    this.pos = pos.clone();
    this.dir = dir.clone().normalize();
    this.speed = 11;
    this.life = 1.9;
    this.dead = false;
    this.color = color;
    this.group = new THREE.Group();
    this.core = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 16, 12),
      new THREE.MeshBasicMaterial({ color: '#ffffff' }),
    );
    this.group.add(this.core);
    this.glow = fx.sprite(color, 1.4);
    this.glow.removeFromParent();
    this.group.add(this.glow);
    this.group.position.copy(this.pos);
    fx.scene.add(this.group);
    this.trailT = 0;
  }

  update(dt) {
    this.life -= dt;
    this.pos.addScaledVector(this.dir, this.speed * dt);
    this.group.position.copy(this.pos);
    const s = 1.3 + Math.sin(this.life * 40) * 0.15;
    this.glow.scale.setScalar(s);
    this.trailT -= dt;
    if (this.trailT <= 0) {
      this.trailT = 0.02;
      const t = this.fx.sprite(this.color, 0.5 + Math.random() * 0.3);
      t.position.copy(this.pos).add(new THREE.Vector3((Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2, (Math.random() - 0.5) * 0.2));
      this.fx.parts.push({ s: t, v: this.dir.clone().multiplyScalar(-1), life: 0.25, max: 0.25, g: 0 });
    }
    if (this.life <= 0) this.destroy();
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.group.removeFromParent();
    this.core.geometry.dispose();
    this.core.material.dispose();
    this.glow.material.dispose();
  }
}

// 超破壊光線: delay 秒ためてから dur 秒照射
export class Beam {
  constructor(fx, owner, origin, dir, color, length, delay = 0.7, dur = 1.3) {
    this.fx = fx;
    this.owner = owner;
    this.origin = origin.clone();
    this.dir = dir.clone().setY(0).normalize();
    this.length = length;
    this.delay = delay;
    this.dur = dur;
    this.t = 0;
    this.dead = false;
    this.color = color;
    this.tickT = 0;

    this.orb = fx.sprite(color, 0.2);
    this.orb.position.copy(this.origin);
    this.group = new THREE.Group();
    this.group.position.copy(this.origin);
    this.group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), this.dir);
    const mk = (r, c, op) => {
      const m = new THREE.Mesh(
        new THREE.CylinderGeometry(r, r, length, 20, 1, true),
        new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
      );
      m.position.y = length / 2;
      this.group.add(m);
      return m;
    };
    this.halo = mk(1.5, color, 0.22);
    this.outer = mk(0.95, color, 0.6);
    this.inner = mk(0.42, '#ffffff', 0.95);
    // ビームに沿った光の玉
    this.glows = [];
    for (let d = 0; d < length; d += 1.4) {
      const g = fx.sprite(color, 2.6);
      g.removeFromParent();
      g.position.set(0, d, 0);
      this.group.add(g);
      this.glows.push(g);
    }
    this.group.visible = false;
    fx.scene.add(this.group);
  }

  get active() {
    return this.t >= this.delay && this.t < this.delay + this.dur;
  }

  update(dt) {
    this.t += dt;
    if (this.t < this.delay) {
      const k = this.t / this.delay;
      this.orb.scale.setScalar(0.3 + k * 1.6 + Math.sin(this.t * 60) * 0.1);
      if (Math.random() < 0.6) {
        // エネルギーが集まる
        const s = this.fx.sprite(this.color, 0.25);
        const off = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(1.6);
        s.position.copy(this.origin).add(off);
        this.fx.parts.push({ s, v: off.multiplyScalar(-4), life: 0.3, max: 0.3, g: 0 });
      }
      return;
    }
    const bt = this.t - this.delay;
    this.group.visible = bt < this.dur;
    const fade = bt < 0.1 ? bt / 0.1 : bt > this.dur - 0.25 ? Math.max(0, (this.dur - bt) / 0.25) : 1;
    const w = fade * (1 + Math.sin(bt * 50) * 0.12);
    this.halo.scale.set(w * 1.1, 1, w * 1.1);
    this.outer.scale.set(w, 1, w);
    this.inner.scale.set(w, 1, w);
    for (const g of this.glows) g.scale.setScalar((2.2 + Math.random() * 0.8) * fade);
    this.orb.scale.setScalar(2.2 * fade + 0.01);
    if (Math.random() < 0.8 && fade > 0.5) {
      const end = this.origin.clone().addScaledVector(this.dir, this.length);
      this.fx.spark(end, this.color, 0.4);
    }
    if (bt >= this.dur) this.destroy();
  }

  // 点 p（ファイター位置）がビームに当たっているか
  hits(p, height = 1.1) {
    if (!this.active) return false;
    const dx = p.x - this.origin.x;
    const dz = p.z - this.origin.z;
    const along = dx * this.dir.x + dz * this.dir.z;
    if (along < 0 || along > this.length) return false;
    const side = Math.abs(dx * this.dir.z - dz * this.dir.x);
    return side < 1.15 && Math.abs(p.y + height - this.origin.y) < 1.6;
  }

  destroy() {
    if (this.dead) return;
    this.dead = true;
    this.group.removeFromParent();
    this.orb.removeFromParent();
    this.orb.material.dispose();
    for (const g of this.glows) g.material.dispose();
    for (const m of [this.halo, this.outer, this.inner]) {
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}

// 地面を走るリング（衝撃波など）
export function groundRing(fx, pos, color, radius, life = 0.45) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 48),
    new THREE.MeshBasicMaterial({ color, transparent: true, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(pos.x, 0.05, pos.z);
  ring.scale.setScalar(0.2);
  fx.scene.add(ring);
  fx.rings.push({ m: ring, life, max: life, size: radius, flat: true, own: true });
}

// タイムストップの空間が広がる球
export function stopSphere(fx, pos, reverse = false) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(1, 32, 16),
    new THREE.MeshBasicMaterial({ color: '#9f7bff', transparent: true, opacity: 0.35, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }),
  );
  m.position.copy(pos);
  fx.scene.add(m);
  fx.rings.push({ m, life: 0.7, max: 0.7, size: 40, flat: true, own: true, reverse });
}
