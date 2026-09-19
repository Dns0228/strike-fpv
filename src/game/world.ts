import * as THREE from "three";
import { FRONT_Z, TARGETS, WORLD_SIZE, type Armor, type TargetKind } from "./catalog";
import { fbm, hash2, lerp } from "./math";

export type Spawn = {
  kind: TargetKind;
  x: number;
  z: number;
  yaw: number;
};

export type WorldApi = {
  group: THREE.Group;
  heightAt: (x: number, z: number) => number;
  spawnPad: THREE.Vector3;
  spawns: Spawn[];
  buildings: { x: number; z: number; r: number; h: number }[];
  coverAt: (x: number, z: number) => number;
  tick: (t: number, camera: THREE.Camera) => void;
  dispose: () => void;
};

const HALF = WORLD_SIZE * 0.5;

const BEACON: Record<Armor, number> = {
  soft: 0x8fb87a,
  light: 0xc4a05a,
  heavy: 0xc45c4a,
};

const CRATERS: Array<[number, number, number, number]> = [
  [14, -32, 5.5, 1.7],
  [36, -46, 4.2, 1.2],
  [58, -18, 6.5, 2.0],
  [72, -52, 3.8, 1.1],
  [-8, -28, 4.6, 1.3],
  [44, 8, 5.0, 1.4],
  [88, -34, 4.4, 1.2],
];

export function terrainHeight(x: number, z: number): number {
  const nx = x * 0.011;
  const nz = z * 0.011;
  let h = fbm(nx + 20, nz + 8) * 14 - 4;
  h += Math.sin(x * 0.018) * Math.cos(z * 0.014) * 3.2;
  h += fbm(x * 0.045 + 4, z * 0.045) * 2.2;

  const road = Math.abs(z + x * 0.08);
  if (road < 9) h = lerp(h, 1.2, 1 - road / 9);

  const river = Math.abs(z - 70 - Math.sin(x * 0.02) * 16);
  if (river < 14) h = lerp(h, -1.6, 1 - river / 14);

  const trenchZ = Math.abs(z + 40);
  const trenchX = x > -30 && x < 90;
  if (trenchX && trenchZ < 4.5) h = Math.min(h, -1.1);

  const pad = Math.hypot(x + 18, z - 12);
  if (pad < 16) h = lerp(h, 1.6, 1 - pad / 16);

  for (let i = 0; i < CRATERS.length; i++) {
    const [cx, cz, r, d] = CRATERS[i];
    const dist = Math.hypot(x - cx, z - cz);
    if (dist < r) {
      const t = 1 - dist / r;
      h -= t * t * d;
    }
  }

  return h;
}

function canvasTex(size: number, paint: (ctx: CanvasRenderingContext2D, size: number) => void): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  paint(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

function groundTexture(): THREE.CanvasTexture {
  return canvasTex(512, (ctx, s) => {
    ctx.fillStyle = "#35502c";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 16 + Math.random() * 48;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dirt = 70 + Math.random() * 40;
      g.addColorStop(0, `rgba(${dirt + 20},${dirt * 0.72},${dirt * 0.4},0.5)`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 5200; i++) {
      const g = 72 + Math.random() * 78;
      ctx.fillStyle = `rgba(${g * 0.42},${g},${g * 0.3},${0.12 + Math.random() * 0.4})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 2 + Math.random() * 6);
    }
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(110,108,90,${0.18 + Math.random() * 0.35})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1 + Math.random() * 2);
    }
  });
}

function waterTexture(): THREE.CanvasTexture {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = "#1c4a48";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(160,210,200,${0.06 + Math.random() * 0.12})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      const y = Math.random() * s;
      ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += 16) {
        ctx.lineTo(x, y + Math.sin(x * 0.08 + i) * 6);
      }
      ctx.stroke();
    }
  });
}

function cloudTexture(): THREE.CanvasTexture {
  return canvasTex(256, (ctx, s) => {
    ctx.clearRect(0, 0, s, s);
    for (let i = 0; i < 18; i++) {
      const x = 40 + Math.random() * 176;
      const y = 70 + Math.random() * 110;
      const r = 28 + Math.random() * 50;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,248,236,0.55)");
      g.addColorStop(0.55, "rgba(232,220,200,0.22)");
      g.addColorStop(1, "rgba(232,220,200,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function glowTexture(): THREE.CanvasTexture {
  return canvasTex(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(255,236,196,0.95)");
    g.addColorStop(0.25, "rgba(255,210,140,0.45)");
    g.addColorStop(0.55, "rgba(210,140,70,0.12)");
    g.addColorStop(1, "rgba(210,140,70,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

function isMobile(): boolean {
  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 700;
}

export function buildWorld(scene: THREE.Scene): WorldApi {
  const group = new THREE.Group();
  scene.add(group);
  const disposers: Array<() => void> = [];
  const track = (...obj: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture>) => {
    for (const o of obj) disposers.push(() => o.dispose());
  };
  const mobile = isMobile();
  const dummy = new THREE.Object3D();
  const tmpC = new THREE.Color();

  const segs = mobile ? 96 : 140;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const ridge = new THREE.Color(0x7a8c6a);
  const clay = new THREE.Color(0x6a5a40);
  const mud = new THREE.Color(0x3a4030);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    const road = Math.abs(z + x * 0.08) < 7;
    const river = Math.abs(z - 70 - Math.sin(x * 0.02) * 16) < 11;
    const trench = Math.abs(z + 40) < 5 && x > -30 && x < 90;
    if (river) col.setRGB(0.12, 0.28, 0.26);
    else if (road) col.setRGB(0.32, 0.28, 0.2);
    else if (trench) col.copy(clay);
    else {
      const n = fbm(x * 0.03, z * 0.03);
      col.setRGB(0.18 + n * 0.1, 0.32 + n * 0.16, 0.11 + n * 0.05);
      if (y < 0.4) col.lerp(mud, 0.55);
      if (y > 10) col.lerp(ridge, 0.4);
      if (y > 14) col.lerp(new THREE.Color(0x8a8c78), 0.25);
    }
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const groundTex = groundTexture();
  groundTex.repeat.set(56, 56);
  const groundMat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    map: groundTex,
    shininess: 6,
    specular: new THREE.Color(0x1c1c14),
  });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);
  track(geo, groundMat, groundTex);

  const riverGeo = new THREE.PlaneGeometry(WORLD_SIZE, 18, 28, 6);
  riverGeo.rotateX(-Math.PI / 2);
  const rp = riverGeo.attributes.position as THREE.BufferAttribute;
  const riverBase = new Float32Array(rp.count * 3);
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const z = 70 + Math.sin(x * 0.02) * 16 + rp.getZ(i);
    const y = terrainHeight(x, z) + 0.16;
    rp.setXYZ(i, x, y, z);
    riverBase[i * 3] = x;
    riverBase[i * 3 + 1] = y;
    riverBase[i * 3 + 2] = z;
  }
  riverGeo.computeVertexNormals();
  const riverTex = waterTexture();
  riverTex.repeat.set(14, 2);
  const riverMat = new THREE.MeshPhongMaterial({
    map: riverTex,
    color: 0x3a8a82,
    transparent: true,
    opacity: 0.82,
    shininess: 90,
    specular: new THREE.Color(0xb7e0d8),
    depthWrite: false,
  });
  const river = new THREE.Mesh(riverGeo, riverMat);
  group.add(river);
  track(riverGeo, riverMat, riverTex);

  const FOG = 0xc2b496;
  const skyGeo = new THREE.SphereGeometry(520, 32, 20);
  const skyCol = new Float32Array(skyGeo.attributes.position.count * 3);
  const skyC = new THREE.Color();
  const zenith = new THREE.Color(0x6d8fb0);
  const horizon = new THREE.Color(0xd4c4a0);
  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const y = skyGeo.attributes.position.getY(i) / 520;
    const t = Math.max(0, Math.min(1, y * 1.15 + 0.08));
    skyC.copy(horizon).lerp(zenith, t * t);
    if (y < 0.02) skyC.lerp(new THREE.Color(FOG), 0.45);
    skyCol[i * 3] = skyC.r;
    skyCol[i * 3 + 1] = skyC.g;
    skyCol[i * 3 + 2] = skyC.b;
  }
  skyGeo.setAttribute("color", new THREE.BufferAttribute(skyCol, 3));
  const skyMat = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  group.add(new THREE.Mesh(skyGeo, skyMat));
  track(skyGeo, skyMat);

  const sunGlowTex = glowTexture();
  const sunGlowMat = new THREE.SpriteMaterial({
    map: sunGlowTex,
    color: 0xffe6c0,
    transparent: true,
    opacity: 0.82,
    depthWrite: false,
    fog: false,
  });
  const sunGlow = new THREE.Sprite(sunGlowMat);
  sunGlow.position.set(-210, 118, -240);
  sunGlow.scale.set(34, 34, 1);
  group.add(sunGlow);
  const sunGeo = new THREE.CircleGeometry(16, 28);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff1d0, fog: false });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.copy(sunGlow.position);
  sun.lookAt(0, 20, 0);
  group.add(sun);
  track(sunGeo, sunMat, sunGlowTex, sunGlowMat);

  const cloudTex = cloudTexture();
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
    side: THREE.DoubleSide,
    fog: true,
  });
  const cloudGeo = new THREE.PlaneGeometry(1, 1);
  const cloudN = mobile ? 8 : 12;
  const clouds = new THREE.InstancedMesh(cloudGeo, cloudMat, cloudN);
  const cloudPos: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < cloudN; i++) {
    const a = (i / cloudN) * Math.PI * 2 + hash2(i, 2);
    const r = 90 + hash2(i, 5) * 160;
    cloudPos.push([
      Math.cos(a) * r,
      42 + hash2(i, 7) * 28,
      Math.sin(a) * r - 40,
      38 + hash2(i, 8) * 36,
      14 + hash2(i, 9) * 10,
    ]);
  }
  dummy.quaternion.identity();
  for (let i = 0; i < cloudPos.length; i++) {
    const [x, y, z, sx, sy] = cloudPos[i];
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, 1);
    dummy.updateMatrix();
    clouds.setMatrixAt(i, dummy.matrix);
  }
  clouds.instanceMatrix.needsUpdate = true;
  group.add(clouds);
  track(cloudGeo, cloudMat, cloudTex);

  const mountGeo = new THREE.IcosahedronGeometry(1, 0);
  const mountMat = new THREE.MeshPhongMaterial({ color: 0x6a7360, shininess: 4, flatShading: true });
  const mountN = 18;
  const mounts = new THREE.InstancedMesh(mountGeo, mountMat, mountN);
  for (let i = 0; i < mountN; i++) {
    const a = (i / mountN) * Math.PI * 2;
    const r = 248;
    dummy.position.set(Math.cos(a) * r, 8, Math.sin(a) * r);
    dummy.rotation.set(hash2(i, 1), hash2(i, 2), hash2(i, 3));
    dummy.scale.set(22 + hash2(i, 4) * 18, 28 + hash2(i, 5) * 34, 22 + hash2(i, 6) * 18);
    dummy.updateMatrix();
    mounts.setMatrixAt(i, dummy.matrix);
    tmpC.setRGB(0.32 + hash2(i, 8) * 0.08, 0.36 + hash2(i, 9) * 0.08, 0.28);
    mounts.setColorAt(i, tmpC);
  }
  if (mounts.instanceColor) mounts.instanceColor.needsUpdate = true;
  group.add(mounts);
  track(mountGeo, mountMat);

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 2.4, 6);
  const crownGeo = new THREE.SphereGeometry(1.55, 6, 5);
  const crown2Geo = new THREE.SphereGeometry(1.1, 5, 4);
  const trunkMat = new THREE.MeshPhongMaterial({ color: 0x3e2c20, shininess: 8 });
  const crownMat = new THREE.MeshPhongMaterial({ color: 0x3d6a34, shininess: 10, specular: 0x1a2a14 });
  const treeCount = mobile ? 140 : 240;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCount);
  const crowns2 = new THREE.InstancedMesh(crown2Geo, crownMat, treeCount);
  trunks.castShadow = crowns.castShadow = true;
  const canopy: { x: number; z: number; r: number }[] = [];
  let placed = 0;
  for (let i = 0; i < 800 && placed < treeCount; i++) {
    const x = (hash2(i, 3) - 0.5) * (WORLD_SIZE - 24);
    const z = (hash2(i, 9) - 0.5) * (WORLD_SIZE - 24);
    if (Math.abs(z + x * 0.08) < 12) continue;
    if (Math.abs(z - 70 - Math.sin(x * 0.02) * 16) < 16) continue;
    if (Math.hypot(x + 18, z - 12) < 22) continue;
    if (Math.abs(z + 40) < 8 && x > -32 && x < 92) continue;
    const y = terrainHeight(x, z);
    if (y < 0.7) continue;
    const s = 0.75 + hash2(i, 11) * 1.05;
    dummy.position.set(x, y + 1.2 * s, z);
    dummy.rotation.set(0, hash2(i, 4) * 6, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    dummy.position.set(x, y + 3.2 * s, z);
    dummy.scale.set(s * 1.05, s * 0.95, s * 1.05);
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);
    tmpC.setRGB(0.16 + hash2(i, 12) * 0.12, 0.34 + hash2(i, 13) * 0.16, 0.12 + hash2(i, 14) * 0.06);
    crowns.setColorAt(placed, tmpC);
    dummy.position.set(x + 0.4 * s, y + 3.9 * s, z - 0.2 * s);
    dummy.scale.set(s * 0.75, s * 0.7, s * 0.75);
    dummy.updateMatrix();
    crowns2.setMatrixAt(placed, dummy.matrix);
    canopy.push({ x, z, r: 1.9 * s });
    placed++;
  }
  trunks.count = crowns.count = crowns2.count = placed;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  group.add(trunks, crowns, crowns2);
  track(trunkGeo, crownGeo, crown2Geo, trunkMat, crownMat);

  const bushGeo = new THREE.SphereGeometry(0.7, 5, 4);
  const bushMat = new THREE.MeshPhongMaterial({ color: 0x2f542c, shininess: 6, flatShading: true });
  const bushN = mobile ? 60 : 110;
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushN);
  let bi = 0;
  for (let i = 0; i < 240 && bi < bushN; i++) {
    const x = (hash2(i, 31) - 0.5) * WORLD_SIZE * 0.85;
    const z = (hash2(i, 32) - 0.5) * WORLD_SIZE * 0.85;
    if (Math.abs(z + x * 0.08) < 10) continue;
    const y = terrainHeight(x, z);
    if (y < 0.4) continue;
    dummy.position.set(x, y + 0.35, z);
    dummy.scale.setScalar(0.6 + hash2(i, 33) * 1.1);
    dummy.rotation.y = hash2(i, 34) * 6;
    dummy.updateMatrix();
    bushes.setMatrixAt(bi++, dummy.matrix);
  }
  bushes.count = bi;
  bushes.castShadow = true;
  group.add(bushes);
  track(bushGeo, bushMat);

  const grassGeo = new THREE.ConeGeometry(0.16, 0.55, 3);
  const grassMat = new THREE.MeshPhongMaterial({ color: 0x4a6e38, shininess: 4, flatShading: true });
  const grassN = mobile ? 160 : 420;
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, grassN);
  let gi = 0;
  for (let i = 0; i < 900 && gi < grassN; i++) {
    const x = -40 + hash2(i, 41) * 140;
    const z = -80 + hash2(i, 42) * 130;
    if (Math.abs(z + x * 0.08) < 8) continue;
    const y = terrainHeight(x, z);
    if (y < 0.5 || y > 8) continue;
    dummy.position.set(x, y + 0.22, z);
    dummy.rotation.set(0.05, hash2(i, 43) * 6, 0.08);
    dummy.scale.set(0.7 + hash2(i, 44), 0.8 + hash2(i, 45) * 1.4, 0.7);
    dummy.updateMatrix();
    grass.setMatrixAt(gi, dummy.matrix);
    tmpC.setRGB(0.22 + hash2(i, 46) * 0.12, 0.38 + hash2(i, 47) * 0.18, 0.12);
    grass.setColorAt(gi, tmpC);
    gi++;
  }
  grass.count = gi;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  group.add(grass);
  track(grassGeo, grassMat);

  const rockGeo = new THREE.IcosahedronGeometry(1.1, 0);
  const rockMat = new THREE.MeshPhongMaterial({ color: 0x5c5e54, shininess: 8, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 80);
  for (let i = 0; i < 80; i++) {
    const x = (hash2(i, 21) - 0.5) * WORLD_SIZE * 0.9;
    const z = (hash2(i, 22) - 0.5) * WORLD_SIZE * 0.9;
    dummy.position.set(x, terrainHeight(x, z) + 0.25, z);
    dummy.rotation.set(hash2(i, 1), hash2(i, 2), hash2(i, 3));
    dummy.scale.setScalar(0.45 + hash2(i, 5) * 1.5);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);
  track(rockGeo, rockMat);

  const buildings: { x: number; z: number; r: number; h: number }[] = [];
  const boxMat = {
    concrete: new THREE.MeshPhongMaterial({ color: 0x6e6f64, shininess: 12 }),
    dark: new THREE.MeshPhongMaterial({ color: 0x35362f, shininess: 18 }),
    rust: new THREE.MeshPhongMaterial({ color: 0x5c4636, shininess: 14 }),
    camo: new THREE.MeshPhongMaterial({ color: 0x4a533c, shininess: 10 }),
    metal: new THREE.MeshPhongMaterial({ color: 0x4d524c, shininess: 42, specular: 0x888888 }),
    pane: new THREE.MeshPhongMaterial({
      color: 0x1a221c,
      emissive: 0x1c2418,
      emissiveIntensity: 0.18,
      shininess: 80,
    }),
  };
  track(...Object.values(boxMat));

  function box(x: number, z: number, w: number, h: number, d: number, mat: THREE.Material, yaw = 0, yOff = 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(g, mat);
    const y = terrainHeight(x, z) + h * 0.5 + yOff;
    m.position.set(x, y, z);
    m.rotation.y = yaw;
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    buildings.push({ x, z, r: Math.max(w, d) * 0.55, h });
    track(g);
    return m;
  }

  function windows(x: number, z: number, w: number, h: number, d: number, yaw: number, yOff = 0) {
    const cols = Math.max(2, Math.round(w / 3.2));
    const rows = Math.max(1, Math.round(h / 2.6));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const lx = -w * 0.38 + (c / Math.max(1, cols - 1)) * w * 0.76;
        const ly = terrainHeight(x, z) + 1.1 + r * 1.7 + yOff;
        const g = new THREE.BoxGeometry(0.7, 0.9, 0.08);
        const m = new THREE.Mesh(g, boxMat.pane);
        m.position.set(x + Math.cos(yaw) * lx, ly, z + Math.sin(yaw) * lx);
        m.position.x += Math.sin(yaw) * (d * 0.51);
        m.position.z += Math.cos(yaw) * (d * 0.51);
        m.rotation.y = yaw;
        group.add(m);
        track(g);
      }
    }
  }

  box(-8, 8, 18, 6, 12, boxMat.concrete, 0.1);
  box(-8, 8, 18.6, 0.45, 12.6, boxMat.dark, 0.1, 3.15);
  windows(-8, 8, 18, 6, 12, 0.1);
  box(-28, 18, 10, 4.2, 16, boxMat.camo, 0.2);
  box(-28, 18, 10.4, 0.3, 16.4, boxMat.rust, 0.2, 2.2);
  box(8, -6, 6, 8, 6, boxMat.concrete, 0);
  box(8, -6, 2.2, 3.5, 2.2, boxMat.dark, 0, 4);
  box(22, 24, 14, 3.2, 8, boxMat.rust, -0.4);
  box(-40, -8, 22, 5, 10, boxMat.concrete, 0.05);
  box(-40, -8, 22.4, 0.4, 10.4, boxMat.metal, 0.05, 2.55);
  windows(-40, -8, 22, 5, 10, 0.05);
  box(40, -30, 9, 3, 9, boxMat.camo, 0.7);
  box(-60, 40, 8, 3.5, 18, boxMat.dark, 1.1);

  for (let i = 0; i < 12; i++) {
    const x = -22 + i * 8;
    const z = -42;
    box(x, z, 1.7, 0.95, 1.15, boxMat.camo, 0.04 * i);
  }

  const wireMat = new THREE.MeshBasicMaterial({ color: 0x2a2c26 });
  track(wireMat);
  for (let i = 0; i < 9; i++) {
    const x = -20 + i * 12;
    const z = FRONT_Z - 1.4;
    const y = terrainHeight(x, z) + 1.05;
    const wg = new THREE.BoxGeometry(11, 0.03, 0.03);
    const w1 = new THREE.Mesh(wg, wireMat);
    w1.position.set(x + 5, y, z);
    group.add(w1);
    const w2 = w1.clone();
    w2.position.y = y - 0.35;
    group.add(w2);
    track(wg);
  }

  const spawnPad = new THREE.Vector3(-18, terrainHeight(-18, 12) + 0.8, 12);
  const padGeo = new THREE.CylinderGeometry(5.5, 5.5, 0.35, 20);
  const padMat = new THREE.MeshPhongMaterial({ color: 0x4a4c46, shininess: 20 });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.position.copy(spawnPad).setY(spawnPad.y - 0.4);
  pad.receiveShadow = true;
  group.add(pad);
  track(padGeo, padMat);

  const ringGeo = new THREE.RingGeometry(4.6, 5.2, 28);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xb7c4a8, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(pad.position).setY(pad.position.y + 0.2);
  group.add(ring);
  track(ringGeo, ringMat);

  const spawns: Spawn[] = [
    { kind: "infantry", x: 12, z: -44, yaw: 0.4 },
    { kind: "infantry", x: 28, z: -48, yaw: -0.2 },
    { kind: "infantry", x: 64, z: 18, yaw: 1.2 },
    { kind: "jeep", x: 6, z: 2, yaw: 0.3 },
    { kind: "jeep", x: 48, z: -8, yaw: -0.8 },
    { kind: "truck", x: 18, z: 6, yaw: 0.15 },
    { kind: "truck", x: -48, z: 36, yaw: 1.4 },
    { kind: "ifv", x: 72, z: -22, yaw: -0.5 },
    { kind: "ifv", x: 88, z: 8, yaw: 2.1 },
    { kind: "radar", x: -52, z: -28, yaw: 0 },
    { kind: "bunker", x: 96, z: -58, yaw: 0.4 },
    { kind: "fuel", x: -36, z: 48, yaw: 0.2 },
    { kind: "sam", x: 54, z: 42, yaw: -0.9 },
    { kind: "sam", x: 110, z: -12, yaw: 0.6 },
  ];

  const tapeMat = new THREE.MeshBasicMaterial({ color: 0xc45c4a });
  const poleMat = new THREE.MeshPhongMaterial({ color: 0x3e403a, shininess: 12 });
  const tapeGeo = new THREE.BoxGeometry(118, 0.08, 0.18);
  const tape = new THREE.Mesh(tapeGeo, tapeMat);
  const midX = 30;
  tape.position.set(midX, terrainHeight(midX, FRONT_Z) + 1.15, FRONT_Z);
  group.add(tape);
  track(tapeGeo, tapeMat, poleMat);
  for (let x = -28; x <= 88; x += 12) {
    const pg = new THREE.CylinderGeometry(0.07, 0.09, 2.4, 6);
    const p = new THREE.Mesh(pg, poleMat);
    const y = terrainHeight(x, FRONT_Z);
    p.position.set(x, y + 1.2, FRONT_Z);
    p.castShadow = true;
    group.add(p);
    track(pg);
  }

  scene.fog = new THREE.Fog(FOG, 95, 400);
  scene.background = new THREE.Color(FOG);

  function coverAt(x: number, z: number) {
    let c = 0;
    for (const b of buildings) {
      if (Math.hypot(x - b.x, z - b.z) < b.r + 1.2) c = Math.max(c, 0.94);
    }
    for (const t of canopy) {
      if (Math.hypot(x - t.x, z - t.z) < t.r) c = Math.max(c, 0.72);
    }
    const h = terrainHeight(x, z);
    if (h < 0.15) c = Math.max(c, 0.58);
    return c;
  }

  function tick(t: number, camera: THREE.Camera) {
    for (let i = 0; i < rp.count; i++) {
      const x = riverBase[i * 3];
      const z = riverBase[i * 3 + 2];
      const y0 = riverBase[i * 3 + 1];
      rp.setY(i, y0 + Math.sin(x * 0.09 + t * 1.35) * 0.07 + Math.sin(z * 0.14 + t * 0.9) * 0.05);
    }
    rp.needsUpdate = true;
    riverTex.offset.x = t * 0.018;
    riverTex.offset.y = Math.sin(t * 0.07) * 0.04;
    dummy.quaternion.copy(camera.quaternion);
    for (let i = 0; i < cloudPos.length; i++) {
      const [x, y, z, sx, sy] = cloudPos[i];
      dummy.position.set(x + Math.sin(t * 0.02 + i) * 6, y, z);
      dummy.scale.set(sx, sy, 1);
      dummy.updateMatrix();
      clouds.setMatrixAt(i, dummy.matrix);
    }
    clouds.instanceMatrix.needsUpdate = true;
  }

  return {
    group,
    heightAt: terrainHeight,
    spawnPad,
    spawns,
    buildings,
    coverAt,
    tick,
    dispose: () => {
      scene.remove(group);
      group.clear();
      for (const d of disposers) d();
    },
  };
}

const beaconShaft = new THREE.CylinderGeometry(0.055, 0.12, 14, 5);
const beaconCap = new THREE.SphereGeometry(0.26, 8, 8);

export function createTargetMesh(kind: TargetKind): THREE.Group {
  const g = new THREE.Group();
  const def = TARGETS[kind];
  const mats = {
    olive: new THREE.MeshPhongMaterial({ color: 0x4c5538, shininess: 14 }),
    dark: new THREE.MeshPhongMaterial({ color: 0x2c2e28, shininess: 20 }),
    sand: new THREE.MeshPhongMaterial({ color: 0x6b6754, shininess: 12 }),
    rust: new THREE.MeshPhongMaterial({ color: 0x6a4e3a, shininess: 16 }),
    skin: new THREE.MeshPhongMaterial({ color: 0x6a5a48, shininess: 8 }),
    metal: new THREE.MeshPhongMaterial({ color: 0x5c615a, shininess: 48, specular: 0x777777 }),
    amber: new THREE.MeshPhongMaterial({ color: 0x8a7a4a, shininess: 30 }),
    glass: new THREE.MeshPhongMaterial({
      color: 0x8aa090,
      transparent: true,
      opacity: 0.45,
      shininess: 90,
    }),
  };

  const add = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  };

  if (kind === "infantry") {
    add(new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 3, 6), mats.olive), 0, 0.9, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mats.skin), 0, 1.52, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mats.olive), 0, 1.62, 0.02);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.16), mats.dark), 0, 1.18, 0.18);
    const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.1), mats.dark);
    rifle.rotation.x = -0.15;
    add(rifle, 0.28, 1.15, 0.45);
  } else if (kind === "jeep") {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 3.4), mats.olive), 0, 0.72, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.62, 1.35), mats.dark), 0, 1.22, -0.35);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.42, 0.08), mats.glass);
    glass.rotation.x = -0.35;
    add(glass, 0, 1.22, 0.42);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.22), mats.metal), 0, 0.55, 1.72);
    for (const [x, z] of [
      [-0.85, 1.15],
      [0.85, 1.15],
      [-0.85, -1.15],
      [0.85, -1.15],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 10), mats.dark);
      wheel.rotation.z = Math.PI / 2;
      add(wheel, x, 0.38, z);
    }
  } else if (kind === "truck") {
    add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.7, 5.6), mats.sand), 0, 0.85, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.05, 2.0), mats.dark), 0, 1.55, 1.65);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.5, 3.2), mats.olive), 0, 1.8, -1.1);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.5, 0.08), mats.glass);
    add(glass, 0, 1.7, 2.62);
    for (const z of [1.6, 0.2, -1.6]) {
      for (const x of [-1.05, 1.05]) {
        const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 10), mats.dark);
        wheel.rotation.z = Math.PI / 2;
        add(wheel, x, 0.42, z);
      }
    }
  } else if (kind === "ifv") {
    add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 5.2), mats.olive), 0, 0.85, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 2.2), mats.olive), 0, 1.6, -0.2);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2.75, 0.35, 5.0), mats.dark);
    add(skirt, 0, 0.45, 0);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 8), mats.dark);
    barrel.rotation.x = Math.PI / 2;
    add(barrel, 0, 1.7, 2.0);
  } else if (kind === "radar") {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 5.5, 8), mats.metal), 0, 2.8, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.5, 1.6), mats.dark), 0, 0.3, 0);
    const dish = new THREE.Mesh(new THREE.CircleGeometry(2.1, 20), mats.metal);
    dish.rotation.x = -0.7;
    add(dish, 0, 5.6, 0.4);
  } else if (kind === "bunker") {
    add(new THREE.Mesh(new THREE.BoxGeometry(8.5, 2.6, 6.5), mats.sand), 0, 1.3, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 2.2), mats.dark), 0, 2.5, 1.6);
    add(new THREE.Mesh(new THREE.BoxGeometry(9, 0.35, 7), mats.metal), 0, 2.7, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.2), mats.dark), 1.4, 1.6, 3.3);
  } else if (kind === "fuel") {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 4.2, 12), mats.rust);
    tank.rotation.z = Math.PI / 2;
    add(tank, 0, 1.4, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 1), mats.dark), 2.2, 1.2, 0);
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6), mats.metal), 0, 2.7, 0);
  } else if (kind === "sam") {
    add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 4.4), mats.olive), 0, 0.8, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.8), mats.dark), 0, 1.5, -0.4);
    for (const x of [-0.45, 0.45]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.8, 8), mats.amber);
      m.rotation.x = -0.9;
      add(m, x, 2.1, 0.9);
    }
  }

  const beaconMat = new THREE.MeshBasicMaterial({
    color: BEACON[def.armor],
    transparent: true,
    opacity: 0.4,
    depthWrite: false,
    fog: false,
  });
  const shaft = new THREE.Mesh(beaconShaft, beaconMat);
  shaft.position.y = def.height + 7.2;
  shaft.userData.beacon = true;
  g.add(shaft);
  const cap = new THREE.Mesh(beaconCap, beaconMat);
  cap.position.y = def.height + 0.35;
  cap.userData.beacon = true;
  g.add(cap);

  g.userData.height = def.height;
  return g;
}

export function createDroneBody(): THREE.Group {
  const g = new THREE.Group();
  const carbon = new THREE.MeshPhongMaterial({ color: 0x161814, shininess: 40, specular: 0x333333 });
  const accent = new THREE.MeshPhongMaterial({ color: 0xb7c4a8, shininess: 30 });
  const motor = new THREE.MeshPhongMaterial({ color: 0x2a2c28, shininess: 50 });
  const ledR = new THREE.MeshBasicMaterial({ color: 0xc45c4a });
  const ledG = new THREE.MeshBasicMaterial({ color: 0x7d9a6e });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.3), carbon);
  g.add(body);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.07, 0.09), accent);
  cam.position.set(0, -0.02, -0.17);
  g.add(cam);
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.16, 5), carbon);
  ant.position.set(0.04, 0.1, 0.08);
  g.add(ant);

  for (const [x, z] of [
    [-0.22, -0.22],
    [0.22, -0.22],
    [-0.22, 0.22],
    [0.22, 0.22],
  ] as const) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.025, 0.32), carbon);
    arm.position.set(x * 0.5, 0, z * 0.5);
    arm.lookAt(x, 0, z);
    g.add(arm);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.04, 8), motor);
    m.position.set(x, 0.02, z);
    g.add(m);
    const prop = new THREE.Mesh(
      new THREE.CircleGeometry(0.16, 14),
      new THREE.MeshBasicMaterial({ color: 0xc5cbb8, transparent: true, opacity: 0.32, side: THREE.DoubleSide }),
    );
    prop.rotation.x = -Math.PI / 2;
    prop.position.set(x, 0.05, z);
    prop.userData.prop = true;
    g.add(prop);
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), z < 0 ? ledG : ledR);
    led.position.set(x, 0.0, z);
    g.add(led);
  }
  return g;
}

export const WORLD_HALF = HALF;
