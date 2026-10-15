// 闘技場（コロシアム）ステージ
import * as THREE from 'three';

export const ARENA_RADIUS = 11.4; // ファイターが動ける範囲
export const WALL_RADIUS = 12.4; // 内壁
// 闘技場の中の柱（当たり判定あり）
export const PILLARS = [0, 1, 2, 3].map((i) => {
  const a = Math.PI / 4 + (i * Math.PI) / 2;
  return { x: Math.cos(a) * 7, z: Math.sin(a) * 7, r: 0.65 };
});

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const cx = 512;
  const grad = g.createRadialGradient(cx, cx, 50, cx, cx, 512);
  grad.addColorStop(0, '#c9a57a');
  grad.addColorStop(1, '#9c7b57');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 1024);
  // 砂のノイズ
  for (let i = 0; i < 14000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '60,40,20' : '255,240,210'},${Math.random() * 0.1})`;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  // 円のライン
  g.strokeStyle = 'rgba(90,50,20,0.45)';
  g.lineWidth = 8;
  for (const r of [130, 330]) {
    g.beginPath();
    g.arc(cx, cx, r, 0, Math.PI * 2);
    g.stroke();
  }
  g.lineWidth = 3;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * 140, cx + Math.sin(a) * 140);
    g.lineTo(cx + Math.cos(a) * 320, cx + Math.sin(a) * 320);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function stoneTexture(w, h, brickW, brickH, base) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  for (let y = 0, row = 0; y < h; y += brickH, row++) {
    for (let x = (row % 2) * (brickW / 2) - brickW; x < w; x += brickW) {
      const l = 0.85 + Math.random() * 0.3;
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.abs(1 - l) * 0.6})`;
      g.fillRect(x + 2, y + 2, brickW - 4, brickH - 4);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, y, w, 3);
  }
  for (let y = 0, row = 0; y < h; y += brickH, row++) {
    for (let x = (row % 2) * (brickW / 2); x < w; x += brickW) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, y, 3, brickH);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export function buildArena(scene) {
  scene.background = new THREE.Color('#1b1336');
  scene.fog = new THREE.Fog('#2a1a3a', 35, 90);

  // 夕焼けの空
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(120, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 top = vec3(0.10,0.07,0.28);
          vec3 mid = vec3(0.62,0.28,0.42);
          vec3 low = vec3(1.0,0.62,0.32);
          vec3 c = h > 0.05 ? mix(mid, top, smoothstep(0.05, 0.55, h)) : mix(low, mid, smoothstep(-0.1, 0.05, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  // ライト
  scene.add(new THREE.HemisphereLight(0xc9b8ff, 0x5a3a20, 1.0));
  const sun = new THREE.DirectionalLight(0xffdcb0, 2.4);
  sun.position.set(10, 18, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -16;
  sc.right = sc.top = 16;
  sc.near = 1;
  sc.far = 50;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x8f7bff, 0.9);
  rim.position.set(-8, 6, -10);
  scene.add(rim);

  // 砂の床
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(WALL_RADIUS + 0.1, 72),
    new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // 中央の紋章
  const ec = document.createElement('canvas');
  ec.width = ec.height = 256;
  const eg = ec.getContext('2d');
  eg.fillStyle = 'rgba(110,55,20,0.55)';
  eg.font = 'bold 190px serif';
  eg.textAlign = 'center';
  eg.textBaseline = 'middle';
  eg.fillText('拳', 128, 136);
  const emblemTex = new THREE.CanvasTexture(ec);
  emblemTex.colorSpace = THREE.SRGBColorSpace;
  const emblem = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.2),
    new THREE.MeshStandardMaterial({ map: emblemTex, transparent: true, depthWrite: false, roughness: 1 }),
  );
  emblem.rotation.x = -Math.PI / 2;
  emblem.position.y = 0.01;
  emblem.receiveShadow = true;
  scene.add(emblem);

  // 内壁
  const WALL_H = 2.4;
  const wallTex = stoneTexture(512, 128, 64, 32, '#8a7560');
  wallTex.repeat.set(10, 1);
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9, side: THREE.BackSide });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(WALL_RADIUS, WALL_RADIUS, WALL_H, 96, 1, true), wallMat);
  wall.position.y = WALL_H / 2;
  wall.receiveShadow = true;
  scene.add(wall);
  const capMat = new THREE.MeshStandardMaterial({ color: '#b39b7d', roughness: 0.8 });
  const cap = new THREE.Mesh(new THREE.RingGeometry(WALL_RADIUS - 0.05, WALL_RADIUS + 1.2, 96), capMat);
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = WALL_H;
  scene.add(cap);

  // 垂れ幕
  const bannerColors = ['#c0392b', '#2471a3', '#d4ac0d', '#7d3c98'];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const b = new THREE.Mesh(
      new THREE.PlaneGeometry(1.0, 1.7),
      new THREE.MeshStandardMaterial({ color: bannerColors[i % 4], roughness: 0.8, side: THREE.DoubleSide }),
    );
    b.position.set(Math.cos(a) * (WALL_RADIUS - 0.05), WALL_H - 0.95, Math.sin(a) * (WALL_RADIUS - 0.05));
    b.lookAt(0, b.position.y, 0);
    scene.add(b);
  }

  // 観客席（段々）
  const standMat = new THREE.MeshStandardMaterial({ color: '#6f5d4c', roughness: 0.95, side: THREE.DoubleSide });
  const TIERS = 7;
  const seats = [];
  for (let t = 0; t < TIERS; t++) {
    const r0 = WALL_RADIUS + 1.2 + t * 1.3;
    const y = WALL_H + t * 0.75;
    const riser = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, 0.75, 96, 1, true), standMat);
    riser.position.y = y + 0.375;
    scene.add(riser);
    const step = new THREE.Mesh(new THREE.RingGeometry(r0, r0 + 1.3, 96), standMat);
    step.rotation.x = -Math.PI / 2;
    step.position.y = y + 0.75;
    scene.add(step);
    const n = Math.floor(r0 * 3.2);
    for (let i = 0; i < n; i++) {
      if (Math.random() < 0.25) continue;
      const a = (i / n) * Math.PI * 2 + Math.random() * 0.05;
      seats.push({ a, r: r0 + 0.6, y: y + 0.75, ph: Math.random() * 10, sp: 6 + Math.random() * 6 });
    }
  }
  // 外周の壁
  const outerR = WALL_RADIUS + 1.2 + TIERS * 1.3;
  const outerTex = stoneTexture(512, 256, 64, 32, '#7a6550');
  outerTex.repeat.set(14, 1);
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(outerR, outerR, 3.5, 96, 1, true),
    new THREE.MeshStandardMaterial({ map: outerTex, roughness: 0.9, side: THREE.DoubleSide }),
  );
  outer.position.y = WALL_H + TIERS * 0.75 + 1.75;
  scene.add(outer);

  // 観客（InstancedMeshで軽量に）
  const crowdGeo = new THREE.CapsuleGeometry(0.22, 0.45, 3, 6);
  const crowdMat = new THREE.MeshStandardMaterial({ roughness: 0.8 });
  const crowd = new THREE.InstancedMesh(crowdGeo, crowdMat, seats.length);
  const col = new THREE.Color();
  const dummy = new THREE.Object3D();
  seats.forEach((s, i) => {
    col.setHSL(Math.random(), 0.55, 0.35 + Math.random() * 0.3);
    crowd.setColorAt(i, col);
  });
  scene.add(crowd);

  // 柱
  const pillarTex = stoneTexture(128, 256, 64, 32, '#a38f78');
  const pillarMat = new THREE.MeshStandardMaterial({ map: pillarTex, roughness: 0.85 });
  for (const p of PILLARS) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(p.r * 0.85, p.r, 4.2, 14), pillarMat);
    m.position.set(p.x, 2.1, p.z);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(p.r + 0.15, p.r + 0.2, 0.3, 14), capMat);
    base.position.set(p.x, 0.15, p.z);
    base.receiveShadow = true;
    scene.add(base);
    const top = new THREE.Mesh(new THREE.BoxGeometry(p.r * 2.4, 0.3, p.r * 2.4), capMat);
    top.position.set(p.x, 4.35, p.z);
    top.castShadow = true;
    scene.add(top);
  }

  // 壁の上のかがり火
  const fireMat = new THREE.MeshBasicMaterial({ color: '#ffae42' });
  const bowlMat = new THREE.MeshStandardMaterial({ color: '#3d3330', roughness: 0.6, metalness: 0.4 });
  const flames = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * (WALL_RADIUS + 0.5);
    const z = Math.sin(a) * (WALL_RADIUS + 0.5);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.2, 0.35, 12), bowlMat);
    bowl.position.set(x, WALL_H + 0.18, z);
    scene.add(bowl);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.75, 8), fireMat);
    flame.position.set(x, WALL_H + 0.7, z);
    scene.add(flame);
    flames.push(flame);
  }

  // 遠景の山
  const rockMat = new THREE.MeshStandardMaterial({ color: '#2a1d40', roughness: 1, flatShading: true });
  for (let i = 0; i < 24; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 60 + Math.random() * 25;
    const h = 10 + Math.random() * 22;
    const m = new THREE.Mesh(new THREE.ConeGeometry(6 + Math.random() * 8, h, 5), rockMat);
    m.position.set(Math.cos(a) * d, h / 2 - 1, Math.sin(a) * d);
    m.rotation.y = Math.random() * 3;
    scene.add(m);
  }
  const ground = new THREE.Mesh(new THREE.CircleGeometry(110, 32), new THREE.MeshStandardMaterial({ color: '#3a2a35', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);

  let excite = 0;
  return {
    // 観客を盛り上げる（ヒット時など）
    cheer(amount = 1) {
      excite = Math.min(2, excite + amount);
    },
    update(time, dt = 0.016) {
      excite = Math.max(0, excite - dt * 0.8);
      flames.forEach((f, i) => {
        const s = 1 + Math.sin(time * 9 + i * 1.7) * 0.15;
        f.scale.set(s, 1 + Math.sin(time * 13 + i) * 0.2, s);
      });
      const jump = 0.04 + excite * 0.18;
      for (let i = 0; i < seats.length; i++) {
        const s = seats[i];
        const y = s.y + 0.45 + Math.max(0, Math.sin(time * s.sp + s.ph)) * jump;
        dummy.position.set(Math.cos(s.a) * s.r, y, Math.sin(s.a) * s.r);
        dummy.updateMatrix();
        crowd.setMatrixAt(i, dummy.matrix);
      }
      crowd.instanceMatrix.needsUpdate = true;
    },
  };
}
