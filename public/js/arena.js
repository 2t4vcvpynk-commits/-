// 闘技場ステージ
import * as THREE from 'three';

export const ARENA_RADIUS = 7.6;

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 1024;
  const g = c.getContext('2d');
  const cx = 512;
  const grad = g.createRadialGradient(cx, cx, 50, cx, cx, 512);
  grad.addColorStop(0, '#6b5a4a');
  grad.addColorStop(1, '#3e3229');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1024, 1024);
  // 石畳
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 3;
  for (let r = 80; r < 512; r += 70) {
    g.beginPath();
    g.arc(cx, cx, r, 0, Math.PI * 2);
    g.stroke();
    const n = Math.floor(r / 14);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + r;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
      g.lineTo(cx + Math.cos(a) * (r + 70), cx + Math.sin(a) * (r + 70));
      g.stroke();
    }
  }
  // 中央の紋章
  g.strokeStyle = 'rgba(255,200,120,0.55)';
  g.lineWidth = 10;
  g.beginPath();
  g.arc(cx, cx, 150, 0, Math.PI * 2);
  g.stroke();
  g.lineWidth = 4;
  g.beginPath();
  g.arc(cx, cx, 120, 0, Math.PI * 2);
  g.stroke();
  // 開始位置のライン
  g.lineWidth = 6;
  for (const sx of [-1, 1]) {
    g.beginPath();
    g.moveTo(cx + sx * 160, cx - 40);
    g.lineTo(cx + sx * 160, cx + 40);
    g.stroke();
  }
  // ノイズ
  for (let i = 0; i < 6000; i++) {
    g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 1024, Math.random() * 1024, 3, 3);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function buildArena(scene) {
  scene.background = new THREE.Color('#130d26');
  scene.fog = new THREE.Fog('#1b1336', 22, 60);

  // 空のグラデーション
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(90, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {},
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `varying vec3 vP;
        void main(){
          float h = normalize(vP).y;
          vec3 top = vec3(0.05,0.03,0.15);
          vec3 mid = vec3(0.45,0.16,0.35);
          vec3 low = vec3(0.95,0.45,0.25);
          vec3 c = h > 0.08 ? mix(mid, top, smoothstep(0.08, 0.6, h)) : mix(low, mid, smoothstep(-0.05, 0.08, h));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(sky);

  // 星
  const starGeo = new THREE.BufferGeometry();
  const pts = [];
  for (let i = 0; i < 600; i++) {
    const a = Math.random() * Math.PI * 2;
    const h = 0.15 + Math.random() * 0.85;
    const r = 80;
    pts.push(Math.cos(a) * r * Math.sqrt(1 - h * h), h * r, Math.sin(a) * r * Math.sqrt(1 - h * h));
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35, fog: false })));

  // ライト
  scene.add(new THREE.HemisphereLight(0xb9a8ff, 0x3a2418, 0.9));
  const sun = new THREE.DirectionalLight(0xffe2c0, 2.2);
  sun.position.set(6, 12, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = sc.bottom = -11;
  sc.right = sc.top = 11;
  sc.near = 1;
  sc.far = 40;
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0x7f6bff, 1.0);
  rim.position.set(-6, 5, -8);
  scene.add(rim);

  // 地面
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(80, 48),
    new THREE.MeshStandardMaterial({ color: '#2a1e2e', roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.6;
  ground.receiveShadow = true;
  scene.add(ground);

  // リング
  const R = ARENA_RADIUS + 1;
  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R + 0.4, 0.6, 64),
    [
      new THREE.MeshStandardMaterial({ color: '#4a3b30', roughness: 0.9 }),
      new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: '#4a3b30' }),
    ],
  );
  platform.position.y = -0.3;

  // 中央の「拳」の紋章（床に貼るデカール）
  const ec = document.createElement('canvas');
  ec.width = ec.height = 256;
  const eg = ec.getContext('2d');
  eg.fillStyle = 'rgba(255,200,120,0.55)';
  eg.font = 'bold 190px serif';
  eg.textAlign = 'center';
  eg.textBaseline = 'middle';
  eg.fillText('拳', 128, 136);
  const emblemTex = new THREE.CanvasTexture(ec);
  emblemTex.colorSpace = THREE.SRGBColorSpace;
  const emblem = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 2.6),
    new THREE.MeshStandardMaterial({ map: emblemTex, transparent: true, depthWrite: false, roughness: 0.9 }),
  );
  emblem.rotation.x = -Math.PI / 2;
  emblem.position.y = 0.005;
  emblem.receiveShadow = true;
  scene.add(emblem);
  platform.receiveShadow = true;
  scene.add(platform);

  const edge = new THREE.Mesh(
    new THREE.TorusGeometry(R, 0.06, 8, 96),
    new THREE.MeshBasicMaterial({ color: '#ffb347' }),
  );
  edge.rotation.x = Math.PI / 2;
  edge.position.y = 0.01;
  scene.add(edge);

  // 柱とかがり火
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#5d4e6d', roughness: 0.8 });
  const fireMat = new THREE.MeshBasicMaterial({ color: '#ffae42' });
  const flames = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const x = Math.cos(a) * (R + 2.2);
    const z = Math.sin(a) * (R + 2.2);
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 3.2, 10), pillarMat);
    pillar.position.set(x, 1.0, z);
    pillar.castShadow = true;
    scene.add(pillar);
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.3, 0.3, 12), pillarMat);
    bowl.position.set(x, 2.75, z);
    scene.add(bowl);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.35, 0.8, 8), fireMat);
    flame.position.set(x, 3.25, z);
    scene.add(flame);
    flames.push(flame);
  }

  // 遠くの山
  const rockMat = new THREE.MeshStandardMaterial({ color: '#1d1530', roughness: 1, flatShading: true });
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const d = 38 + Math.random() * 15;
    const h = 6 + Math.random() * 14;
    const m = new THREE.Mesh(new THREE.ConeGeometry(4 + Math.random() * 5, h, 5), rockMat);
    m.position.set(Math.cos(a) * d, h / 2 - 0.6, Math.sin(a) * d);
    m.rotation.y = Math.random() * 3;
    scene.add(m);
  }

  return {
    update(time) {
      flames.forEach((f, i) => {
        const s = 1 + Math.sin(time * 9 + i * 1.7) * 0.15;
        f.scale.set(s, 1 + Math.sin(time * 13 + i) * 0.2, s);
      });
    },
  };
}
