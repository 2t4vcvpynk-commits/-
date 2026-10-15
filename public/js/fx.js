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
        this.rings.splice(i, 1);
        continue;
      }
      const k = 1 - r.life / r.max;
      r.m.scale.setScalar(0.2 + k * r.size);
      r.m.material.opacity = 1 - k;
      r.m.quaternion.copy(camera.quaternion);
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
