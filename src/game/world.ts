import * as THREE from "three";
import { FRONT_Z, ROAD_PATHS, TARGETS, WORLD_SIZE, type Armor, type TargetKind } from "./catalog";
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
  obstacles: { x: number; z: number; r: number }[];
  coverAt: (x: number, z: number) => number;
  surfaceAt: (x: number, z: number) => "road" | "field" | "grass" | "water";
  roads: Array<Array<[number, number]>>;
  tick: (t: number, camera: THREE.Camera) => void;
  setNight: (on: boolean) => void;
  getWind: () => { x: number; z: number; gust: number };
  dispose: () => void;
};

const HALF = WORLD_SIZE * 0.5;

const BEACON: Record<Armor, number> = {
  soft: 0x8fb87a,
  light: 0xc4a05a,
  heavy: 0xc45c4a,
};

type FieldKind = "wheat" | "crop" | "fallow" | "sunflower" | "pasture" | "corn";

type Field = { x: number; z: number; w: number; d: number; yaw: number; kind: FieldKind };

/** Plots on and around the assault corridor (−14,38) → (18,−40). */
const FIELDS: Field[] = [
  { x: -6, z: 26, w: 18, d: 14, yaw: 0.1, kind: "wheat" },
  { x: 22, z: 8, w: 24, d: 16, yaw: -0.14, kind: "wheat" },
  { x: 18, z: 34, w: 14, d: 11, yaw: 0.06, kind: "corn" },
  { x: 42, z: 0, w: 18, d: 14, yaw: 0.22, kind: "corn" },
  { x: 6, z: -10, w: 16, d: 12, yaw: -0.18, kind: "crop" },
  { x: -24, z: 22, w: 18, d: 14, yaw: 0.16, kind: "sunflower" },
  { x: -8, z: 6, w: 14, d: 11, yaw: 0.28, kind: "pasture" },
  { x: 4, z: -26, w: 13, d: 9, yaw: 0.12, kind: "crop" },
  { x: 34, z: -22, w: 14, d: 10, yaw: -0.24, kind: "fallow" },
  { x: 58, z: -14, w: 20, d: 14, yaw: 0.1, kind: "wheat" },
  { x: 70, z: 28, w: 24, d: 18, yaw: 0.05, kind: "wheat" },
  { x: -48, z: 8, w: 16, d: 12, yaw: -0.1, kind: "sunflower" },
  { x: 88, z: 12, w: 18, d: 14, yaw: 0.18, kind: "corn" },
  { x: -36, z: -12, w: 14, d: 10, yaw: 0.2, kind: "pasture" },
];

const GROVES: Array<[number, number, number]> = [
  [52, 6, 24],
  [-38, 26, 20],
  [86, -8, 18],
  [8, -62, 16],
  [-72, -18, 22],
  [22, -16, 14],
  [-16, -78, 18],
  [14, -18, 12],
  [40, -8, 11],
  [-12, -22, 10],
  [28, 36, 9],
  [-2, -8, 8],
];

const PINES = { x: 118, z: 46, r: 52 };
const BIRCH = { x: -78, z: -36, r: 40 };
const POND = { x: 34, z: 84, r: 15 };
const POND2 = { x: 8, z: 14, r: 6.2 };
const QUARRY = { x: 126, z: -6, r: 18 };
const ORCHARD = { x: -32, z: 34, w: 10, d: 8 };
const ISLAND = { x: -14, z: 76, r: 9 };

const ROADS = ROAD_PATHS;

const HEDGES: Array<[number, number, number, number]> = [
  [8, 18, 34, 2],
  [-16, 34, 4, 20],
  [14, -2, 32, -16],
  [-20, -12, -4, -28],
  [-34, 28, -16, 16],
  [30, 16, 48, 6],
  [0, -18, 16, -32],
];

const CRATERS: Array<[number, number, number, number]> = [
  [14, -32, 5.5, 1.7],
  [36, -46, 4.2, 1.2],
  [58, -18, 6.5, 2.0],
  [72, -52, 3.8, 1.1],
  [-8, -28, 4.6, 1.3],
  [44, 8, 5.0, 1.4],
  [88, -34, 4.4, 1.2],
  [10, -36, 3.6, 1.0],
];

function distToSeg(x: number, z: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
  return Math.hypot(x - (ax + t * dx), z - (az + t * dz));
}

function roadDist(x: number, z: number): number {
  let m = 1e9;
  for (const path of ROADS) {
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      m = Math.min(m, distToSeg(x, z, a[0], a[1], b[0], b[1]));
    }
  }
  return m;
}

function hedgeDist(x: number, z: number): number {
  let m = 1e9;
  for (const [ax, az, bx, bz] of HEDGES) m = Math.min(m, distToSeg(x, z, ax, az, bx, bz));
  return m;
}

function fieldAt(x: number, z: number): FieldKind | null {
  for (const f of FIELDS) {
    const dx = x - f.x;
    const dz = z - f.z;
    const c = Math.cos(-f.yaw);
    const s = Math.sin(-f.yaw);
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (Math.abs(lx) < f.w * 0.5 && Math.abs(lz) < f.d * 0.5) return f.kind;
  }
  return null;
}

function groveT(x: number, z: number): number {
  let m = 1e9;
  for (const [gx, gz, r] of GROVES) m = Math.min(m, Math.hypot(x - gx, z - gz) / r);
  return m;
}

function riverDist(x: number, z: number): number {
  return Math.abs(z - 70 - Math.sin(x * 0.02) * 16);
}

function streamDist(x: number, z: number): number {
  if (x < -56 || x > 48) return 99;
  const cz = 15.5 + Math.sin(x * 0.048) * 5.2;
  return Math.abs(z - cz);
}

function ditchDist(x: number, z: number): number {
  if (z > 34 || z < -24) return 99;
  return Math.abs(x - (13 + Math.sin(z * 0.09) * 2.4));
}

export function terrainHeight(x: number, z: number): number {
  const nx = x * 0.011;
  const nz = z * 0.011;
  let h = fbm(nx + 20, nz + 8) * 12.5 - 3.4;
  h += Math.sin(x * 0.018) * Math.cos(z * 0.014) * 2.8;
  h += fbm(x * 0.045 + 4, z * 0.045) * 1.8;

  const east = Math.max(0, (x - 78) / 70);
  h += east * east * 9;
  const west = Math.max(0, (-x - 52) / 80);
  h += west * west * 5.5;

  const rd = roadDist(x, z);
  if (rd < 5.5) h = lerp(h, 1.15, 1 - rd / 5.5);

  const rv = riverDist(x, z);
  if (rv < 14) h = lerp(h, -1.7, 1 - rv / 14);
  const island = Math.hypot(x - ISLAND.x, z - ISLAND.z);
  if (island < ISLAND.r) h = lerp(h, 1.4, 1 - island / ISLAND.r);

  const st = streamDist(x, z);
  if (st < 4.2) h = lerp(h, 0.15, 1 - st / 4.2);

  const p1 = Math.hypot(x - POND.x, z - POND.z);
  if (p1 < POND.r) h = lerp(h, -0.85, 1 - p1 / POND.r);
  const p2 = Math.hypot(x - POND2.x, z - POND2.z);
  if (p2 < POND2.r) h = lerp(h, -0.55, 1 - p2 / POND2.r);

  const dt = ditchDist(x, z);
  if (dt < 2.1) h = Math.min(h, lerp(h, 0.05, 1 - dt / 2.1));

  const q = Math.hypot(x - QUARRY.x, z - QUARRY.z);
  if (q < QUARRY.r) {
    const t = 1 - q / QUARRY.r;
    h = lerp(h, -2.4 + t * 0.4, t * t);
  }

  const trenchZ = Math.abs(z + 40);
  const trenchX = x > -30 && x < 90;
  if (trenchX && trenchZ < 4.5) h = Math.min(h, -1.1);

  const pad = Math.hypot(x + 18, z - 12);
  if (pad < 16) h = lerp(h, 1.6, 1 - pad / 16);

  const fld = fieldAt(x, z);
  if (fld) h = lerp(h, 1.05, 0.72);

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
    ctx.fillStyle = "#4d6c38";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * s;
      const y = Math.random() * s;
      const r = 16 + Math.random() * 48;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dirt = 88 + Math.random() * 40;
      g.addColorStop(0, `rgba(${dirt + 16},${dirt * 0.78},${dirt * 0.42},0.42)`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 5200; i++) {
      const g = 90 + Math.random() * 78;
      ctx.fillStyle = `rgba(${g * 0.42},${g},${g * 0.32},${0.1 + Math.random() * 0.38})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 2, 2 + Math.random() * 6);
    }
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = `rgba(130,122,96,${0.14 + Math.random() * 0.32})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1 + Math.random() * 2);
    }
  });
}

function dirtTexture(): THREE.CanvasTexture {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = "#6b5a40";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `rgba(${90 + Math.random() * 50},${70 + Math.random() * 30},${40 + Math.random() * 20},0.35)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 8 + Math.random() * 28, 3 + Math.random() * 10);
    }
    for (let i = 0; i < 1800; i++) {
      ctx.fillStyle = `rgba(${70 + Math.random() * 80},${60 + Math.random() * 50},${40 + Math.random() * 30},0.45)`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 1, 1 + Math.random() * 2);
    }
  });
}

function waterTexture(): THREE.CanvasTexture {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = "#2a6a62";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) {
      ctx.strokeStyle = `rgba(180,220,210,${0.07 + Math.random() * 0.14})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      const y = Math.random() * s;
      ctx.moveTo(0, y);
      for (let x = 0; x <= s; x += 16) ctx.lineTo(x, y + Math.sin(x * 0.08 + i) * 6);
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
      g.addColorStop(0, "rgba(255,252,246,0.58)");
      g.addColorStop(0.55, "rgba(220,230,236,0.2)");
      g.addColorStop(1, "rgba(220,230,236,0)");
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
    g.addColorStop(0, "rgba(255,244,210,0.95)");
    g.addColorStop(0.25, "rgba(255,220,150,0.4)");
    g.addColorStop(0.55, "rgba(210,160,80,0.1)");
    g.addColorStop(1, "rgba(210,160,80,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

function isMobile(): boolean {
  return window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 700;
}

function ribbon(path: Array<[number, number]>, width: number): THREE.BufferGeometry {
  const n = path.length;
  const pos = new Float32Array(n * 2 * 3);
  const uv = new Float32Array(n * 2 * 2);
  const idx: number[] = [];
  let along = 0;
  for (let i = 0; i < n; i++) {
    const [x, z] = path[i];
    const [x0, z0] = path[Math.max(0, i - 1)];
    const [x1, z1] = path[Math.min(n - 1, i + 1)];
    let tx = x1 - x0;
    let tz = z1 - z0;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    const nx = -tz * width;
    const nz = tx * width;
    const y = terrainHeight(x, z) + 0.07;
    const i0 = i * 2;
    pos[i0 * 3] = x + nx;
    pos[i0 * 3 + 1] = y;
    pos[i0 * 3 + 2] = z + nz;
    pos[(i0 + 1) * 3] = x - nx;
    pos[(i0 + 1) * 3 + 1] = y;
    pos[(i0 + 1) * 3 + 2] = z - nz;
    if (i > 0) along += Math.hypot(x - path[i - 1][0], z - path[i - 1][1]);
    uv[i0 * 2] = 0;
    uv[i0 * 2 + 1] = along / 10;
    uv[(i0 + 1) * 2] = 1;
    uv[(i0 + 1) * 2 + 1] = along / 10;
    if (i > 0) {
      const a = (i - 1) * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
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
  const obstacles: { x: number; z: number; r: number }[] = [];
  const canopy: { x: number; z: number; r: number }[] = [];

  const segs = mobile ? 96 : 140;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const wheatC = new THREE.Color(0xc4b45a);
  const cornC = new THREE.Color(0x3f6a32);
  const sunC = new THREE.Color(0x6a7a38);
  const cropC = new THREE.Color(0x4e7a3c);
  const fallowC = new THREE.Color(0x7a6a48);
  const pastureC = new THREE.Color(0x5a8a48);
  const ridge = new THREE.Color(0x8aa078);
  const clay = new THREE.Color(0x7a6a4c);
  const mud = new THREE.Color(0x4a5240);
  const pineFl = new THREE.Color(0x3a4e32);
  const birchFl = new THREE.Color(0x6a704c);
  const scorched = new THREE.Color(0x4a4638);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    const rd = roadDist(x, z);
    const rv = riverDist(x, z);
    const st = streamDist(x, z);
    const trench = Math.abs(z + 40) < 5 && x > -30 && x < 90;
    const fld = fieldAt(x, z);
    const p1 = Math.hypot(x - POND.x, z - POND.z);
    const p2 = Math.hypot(x - POND2.x, z - POND2.z);
    const q = Math.hypot(x - QUARRY.x, z - QUARRY.z);
    if (rv < 11 || p1 < POND.r * 0.92 || p2 < POND2.r * 0.92) col.setRGB(0.16, 0.38, 0.36);
    else if (st < 3.2) col.setRGB(0.28, 0.42, 0.3);
    else if (rd < 4.4) col.setRGB(0.46, 0.38, 0.26);
    else if (trench) col.copy(clay);
    else if (q < QUARRY.r) col.setRGB(0.52, 0.5, 0.44);
    else if (fld === "wheat") col.copy(wheatC);
    else if (fld === "corn") col.copy(cornC);
    else if (fld === "sunflower") col.copy(sunC);
    else if (fld === "crop") col.copy(cropC);
    else if (fld === "fallow") col.copy(fallowC);
    else if (fld === "pasture") col.copy(pastureC);
    else {
      const n = fbm(x * 0.03, z * 0.03);
      col.setRGB(0.26 + n * 0.1, 0.42 + n * 0.16, 0.16 + n * 0.05);
      if (groveT(x, z) < 1) col.lerp(new THREE.Color(0x2e4a28), 0.35);
      if (Math.hypot(x - PINES.x, z - PINES.z) < PINES.r) col.lerp(pineFl, 0.55);
      if (Math.hypot(x - BIRCH.x, z - BIRCH.z) < BIRCH.r) col.lerp(birchFl, 0.4);
      if (y < 0.35) col.lerp(mud, 0.5);
      if (y > 10) col.lerp(ridge, 0.4);
      if (Math.abs(z + 40) < 18 && x > -30 && x < 90) col.lerp(scorched, 0.35);
    }
    const hd = hedgeDist(x, z);
    if (hd < 1.1 && !fld) col.lerp(new THREE.Color(0x2c4a26), 0.55);
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

  const dirtTex = dirtTexture();
  dirtTex.repeat.set(1, 8);
  const dirtMat = new THREE.MeshPhongMaterial({
    map: dirtTex,
    color: 0x8a7350,
    shininess: 4,
  });
  track(dirtTex, dirtMat);
  for (const path of ROADS) {
    const rg = ribbon(path, 2.35);
    const rm = new THREE.Mesh(rg, dirtMat);
    rm.receiveShadow = true;
    group.add(rm);
    track(rg);
  }

  const riverTex = waterTexture();
  riverTex.repeat.set(14, 2);
  const riverMat = new THREE.MeshPhongMaterial({
    map: riverTex,
    color: 0x4a9a90,
    transparent: true,
    opacity: 0.8,
    shininess: 90,
    specular: new THREE.Color(0xc4ece4),
    depthWrite: false,
  });
  track(riverTex, riverMat);

  const riverGeo = new THREE.PlaneGeometry(WORLD_SIZE, 18, 28, 6);
  riverGeo.rotateX(-Math.PI / 2);
  const rp = riverGeo.attributes.position as THREE.BufferAttribute;
  const riverBase = new Float32Array(rp.count * 3);
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const z = 70 + Math.sin(x * 0.02) * 16 + rp.getZ(i);
    const y = terrainHeight(x, z) + 0.18;
    rp.setXYZ(i, x, y, z);
    riverBase[i * 3] = x;
    riverBase[i * 3 + 1] = y;
    riverBase[i * 3 + 2] = z;
  }
  riverGeo.computeVertexNormals();
  const river = new THREE.Mesh(riverGeo, riverMat);
  group.add(river);
  track(riverGeo);

  const streamPath: Array<[number, number]> = [];
  for (let x = -52; x <= 44; x += 6) streamPath.push([x, 15.5 + Math.sin(x * 0.048) * 5.2]);
  const streamGeo = ribbon(streamPath, 1.55);
  const stream = new THREE.Mesh(streamGeo, riverMat);
  group.add(stream);
  track(streamGeo);

  function addPond(cx: number, cz: number, r: number) {
    const g = new THREE.CircleGeometry(r * 0.96, 22);
    g.rotateX(-Math.PI / 2);
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + cx;
      const z = p.getZ(i) + cz;
      p.setXYZ(i, x, terrainHeight(x, z) + 0.2, z);
    }
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, riverMat);
    group.add(m);
    track(g);
  }
  addPond(POND.x, POND.z, POND.r);
  addPond(POND2.x, POND2.z, POND2.r);

  const FOG = 0xd2e0d4;
  const skyGeo = new THREE.SphereGeometry(520, 32, 20);
  const skyCol = new Float32Array(skyGeo.attributes.position.count * 3);
  const skyC = new THREE.Color();
  const zenith = new THREE.Color(0x6ea8dc);
  const horizon = new THREE.Color(0xdcead8);
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
    color: 0xfff0c8,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
    fog: false,
  });
  const sunGlow = new THREE.Sprite(sunGlowMat);
  sunGlow.position.set(-210, 128, -240);
  sunGlow.scale.set(32, 32, 1);
  group.add(sunGlow);
  const sunGeo = new THREE.CircleGeometry(15, 28);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff6d8, fog: false });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.copy(sunGlow.position);
  sun.lookAt(0, 20, 0);
  group.add(sun);
  track(sunGeo, sunMat, sunGlowTex, sunGlowMat);

  const moonGeo = new THREE.CircleGeometry(9, 24);
  const moonMat = new THREE.MeshBasicMaterial({ color: 0xdce6f0, fog: false });
  const moon = new THREE.Mesh(moonGeo, moonMat);
  moon.position.set(180, 110, 160);
  moon.lookAt(0, 20, 0);
  moon.visible = false;
  group.add(moon);
  track(moonGeo, moonMat);

  const cloudTex = cloudTexture();
  const cloudMat = new THREE.MeshBasicMaterial({
    map: cloudTex,
    transparent: true,
    opacity: 0.68,
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
    cloudPos.push([Math.cos(a) * r, 44 + hash2(i, 7) * 28, Math.sin(a) * r - 40, 38 + hash2(i, 8) * 36, 14 + hash2(i, 9) * 10]);
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

  const birdGeo = new THREE.BufferGeometry();
  birdGeo.setAttribute(
    "position",
    new THREE.BufferAttribute(
      new Float32Array([0, 0, 0, -0.9, 0.18, 0.15, -0.12, 0, 0, 0, 0, 0, 0.9, 0.18, 0.15, 0.12, 0, 0]),
      3,
    ),
  );
  birdGeo.computeVertexNormals();
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x1c1e18, side: THREE.DoubleSide, fog: true });
  const birdN = 10;
  const birds = new THREE.InstancedMesh(birdGeo, birdMat, birdN);
  const birdOrbit: Array<[number, number, number, number, number]> = [];
  for (let i = 0; i < birdN; i++) {
    birdOrbit.push([
      -4 + hash2(i, 11) * 48,
      14 + hash2(i, 12) * 10,
      8 + hash2(i, 13) * 36,
      10 + hash2(i, 14) * 16,
      hash2(i, 15) * Math.PI * 2,
    ]);
  }
  group.add(birds);
  track(birdGeo, birdMat);

  const mountGeo = new THREE.IcosahedronGeometry(1, 0);
  const mountMat = new THREE.MeshPhongMaterial({ color: 0x7a8a6c, shininess: 4, flatShading: true });
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
    tmpC.setRGB(0.38 + hash2(i, 8) * 0.08, 0.42 + hash2(i, 9) * 0.08, 0.3);
    mounts.setColorAt(i, tmpC);
  }
  if (mounts.instanceColor) mounts.instanceColor.needsUpdate = true;
  group.add(mounts);
  track(mountGeo, mountMat);

  function occupied(x: number, z: number, pad = 16): boolean {
    if (roadDist(x, z) < 5.5) return true;
    if (riverDist(x, z) < 13) return true;
    if (streamDist(x, z) < 5) return true;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 3) return true;
    if (Math.hypot(x - POND2.x, z - POND2.z) < POND2.r + 2.4) return true;
    if (Math.hypot(x + 18, z - 12) < pad) return true;
    if (Math.abs(z + 40) < 8 && x > -32 && x < 92) return true;
    if (fieldAt(x, z)) return true;
    if (Math.hypot(x - QUARRY.x, z - QUARRY.z) < QUARRY.r + 4) return true;
    if (ditchDist(x, z) < 2.4) return true;
    return false;
  }

  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.3, 2.4, 6);
  const crownGeo = new THREE.SphereGeometry(1.55, 6, 5);
  const crown2Geo = new THREE.SphereGeometry(1.1, 5, 4);
  const pineGeo = new THREE.ConeGeometry(1.15, 3.4, 7);
  const poplarGeo = new THREE.SphereGeometry(0.85, 6, 5);
  const birchTrunkMat = new THREE.MeshPhongMaterial({ color: 0xd8d2c4, shininess: 12 });
  const trunkMat = new THREE.MeshPhongMaterial({ color: 0x3e2c20, shininess: 8 });
  const crownMat = new THREE.MeshPhongMaterial({ color: 0x3d6a34, shininess: 10, specular: 0x1a2a14 });
  const pineMat = new THREE.MeshPhongMaterial({ color: 0x2c4a30, shininess: 8, flatShading: true });
  const poplarMat = new THREE.MeshPhongMaterial({ color: 0x4a7a3c, shininess: 10 });
  const treeCount = mobile ? 120 : 210;
  const pineCount = mobile ? 40 : 70;
  const poplarCount = mobile ? 22 : 36;
  const fruitN = 28;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount + poplarCount + fruitN);
  const birches = new THREE.InstancedMesh(trunkGeo, birchTrunkMat, 40);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCount);
  const crowns2 = new THREE.InstancedMesh(crown2Geo, crownMat, treeCount);
  const pines = new THREE.InstancedMesh(pineGeo, pineMat, pineCount);
  const pineTrunks = new THREE.InstancedMesh(trunkGeo, trunkMat, pineCount);
  const poplars = new THREE.InstancedMesh(poplarGeo, poplarMat, poplarCount);
  trunks.castShadow = crowns.castShadow = pines.castShadow = poplars.castShadow = true;

  let placed = 0;
  let trunkN = 0;
  let birchN = 0;
  for (let i = 0; i < 1100 && placed < treeCount; i++) {
    let x = (hash2(i, 3) - 0.5) * (WORLD_SIZE - 24);
    let z = (hash2(i, 9) - 0.5) * (WORLD_SIZE - 24);
    const gt = groveT(x, z);
    if (gt < 1) {
      const [gx, gz, r] = GROVES[i % GROVES.length];
      const a = hash2(i, 5) * Math.PI * 2;
      const rad = hash2(i, 6) * r * 0.85;
      x = gx + Math.cos(a) * rad;
      z = gz + Math.sin(a) * rad;
    } else if (hash2(i, 17) > 0.38 && gt > 1.15) {
      continue;
    }
    if (occupied(x, z, 18)) continue;
    const y = terrainHeight(x, z);
    if (y < 0.45) continue;
    const birch = Math.hypot(x - BIRCH.x, z - BIRCH.z) < BIRCH.r || hash2(i, 19) > 0.88;
    const willow = riverDist(x, z) < 22 && riverDist(x, z) > 13;
    const s = (willow ? 0.9 : 0.72) + hash2(i, 11) * 1.05;
    dummy.rotation.set(0, hash2(i, 4) * 6, 0);
    dummy.position.set(x, y + 1.2 * s, z);
    dummy.scale.set(s * (birch ? 0.7 : 1), s * (willow ? 0.7 : birch ? 1.15 : 1), s * (birch ? 0.7 : 1));
    dummy.updateMatrix();
    if (birch && birchN < 40) {
      birches.setMatrixAt(birchN++, dummy.matrix);
    } else {
      trunks.setMatrixAt(trunkN++, dummy.matrix);
    }
    dummy.position.set(x, y + (willow ? 2.4 : 3.2) * s, z);
    dummy.scale.set(s * (willow ? 1.35 : 1.05), s * (willow ? 0.55 : 0.95), s * (willow ? 1.35 : 1.05));
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);
    if (willow) tmpC.setRGB(0.22 + hash2(i, 12) * 0.08, 0.42 + hash2(i, 13) * 0.12, 0.18);
    else if (birch) tmpC.setRGB(0.42 + hash2(i, 12) * 0.1, 0.52 + hash2(i, 13) * 0.12, 0.22);
    else tmpC.setRGB(0.18 + hash2(i, 12) * 0.12, 0.38 + hash2(i, 13) * 0.16, 0.14 + hash2(i, 14) * 0.06);
    crowns.setColorAt(placed, tmpC);
    dummy.position.set(x + 0.4 * s, y + (willow ? 2.8 : 3.9) * s, z - 0.2 * s);
    dummy.scale.set(s * 0.75, s * (willow ? 0.45 : 0.7), s * 0.75);
    dummy.updateMatrix();
    crowns2.setMatrixAt(placed, dummy.matrix);
    canopy.push({ x, z, r: 1.9 * s });
    if (s > 1.05) obstacles.push({ x, z, r: 0.42 * s });
    placed++;
  }
  trunks.count = trunkN;
  crowns.count = crowns2.count = placed;
  birches.count = birchN;
  if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
  group.add(trunks, birches, crowns, crowns2);
  track(trunkGeo, crownGeo, crown2Geo, trunkMat, crownMat, birchTrunkMat);

  let pi = 0;
  for (let i = 0; i < 400 && pi < pineCount; i++) {
    const a = hash2(i, 61) * Math.PI * 2;
    const rad = hash2(i, 62) * PINES.r;
    const x = PINES.x + Math.cos(a) * rad;
    const z = PINES.z + Math.sin(a) * rad + (hash2(i, 63) - 0.5) * 30;
    if (occupied(x, z, 12) || Math.hypot(x, z) > 190) continue;
    const y = terrainHeight(x, z);
    if (y < 1) continue;
    const s = 0.9 + hash2(i, 64) * 1.3;
    dummy.position.set(x, y + 1.1 * s, z);
    dummy.rotation.set(0, hash2(i, 65) * 6, 0);
    dummy.scale.set(s * 0.7, s * 1.4, s * 0.7);
    dummy.updateMatrix();
    pineTrunks.setMatrixAt(pi, dummy.matrix);
    dummy.position.set(x, y + 3.2 * s, z);
    dummy.scale.set(s, s * 1.15, s);
    dummy.updateMatrix();
    pines.setMatrixAt(pi, dummy.matrix);
    tmpC.setRGB(0.14 + hash2(i, 66) * 0.08, 0.28 + hash2(i, 67) * 0.1, 0.16);
    pines.setColorAt(pi, tmpC);
    canopy.push({ x, z, r: 1.6 * s });
    obstacles.push({ x, z, r: 0.4 * s });
    pi++;
  }
  pines.count = pineTrunks.count = pi;
  if (pines.instanceColor) pines.instanceColor.needsUpdate = true;
  group.add(pines, pineTrunks);
  track(pineGeo, pineMat);

  let pop = 0;
  const mainRoad = ROADS[0];
  for (let i = 0; i < mainRoad.length - 1 && pop < poplarCount; i++) {
    const a = mainRoad[i];
    const b = mainRoad[i + 1];
    const steps = 2;
    for (let s = 0; s < steps && pop < poplarCount; s++) {
      const t = (s + 0.35) / steps;
      const x0 = lerp(a[0], b[0], t);
      const z0 = lerp(a[1], b[1], t);
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      const side = pop % 2 === 0 ? 1 : -1;
      const x = x0 + (-dz / len) * 4.2 * side;
      const z = z0 + (dx / len) * 4.2 * side;
      if (Math.abs(z + 40) < 10) continue;
      if (Math.hypot(x + 18, z - 12) < 14) continue;
      const y = terrainHeight(x, z);
      const sc = 1.15 + hash2(pop, 71) * 0.55;
      dummy.position.set(x, y + 1.6 * sc, z);
      dummy.scale.set(sc * 0.55, sc * 1.8, sc * 0.55);
      dummy.rotation.set(0, hash2(pop, 72) * 6, 0);
      dummy.updateMatrix();
      trunks.setMatrixAt(trunkN++, dummy.matrix);
      dummy.position.set(x, y + 5.4 * sc, z);
      dummy.scale.set(sc * 0.85, sc * 2.4, sc * 0.85);
      dummy.updateMatrix();
      poplars.setMatrixAt(pop, dummy.matrix);
      tmpC.setRGB(0.28 + hash2(pop, 73) * 0.1, 0.48 + hash2(pop, 74) * 0.12, 0.2);
      poplars.setColorAt(pop, tmpC);
      canopy.push({ x, z, r: 1.4 * sc });
      obstacles.push({ x, z, r: 0.38 });
      pop++;
    }
  }
  trunks.count = trunkN;
  poplars.count = pop;
  if (poplars.instanceColor) poplars.instanceColor.needsUpdate = true;
  group.add(poplars);
  track(poplarGeo, poplarMat);

  const fruitGeo = new THREE.SphereGeometry(0.95, 5, 4);
  const fruitMat = new THREE.MeshPhongMaterial({ color: 0x4a6a30, shininess: 8 });
  const fruit = new THREE.InstancedMesh(fruitGeo, fruitMat, fruitN);
  for (let i = 0; i < fruitN; i++) {
    const lx = ((i % 7) - 3) * 1.35;
    const lz = (Math.floor(i / 7) - 1.5) * 1.7;
    const x = ORCHARD.x + lx;
    const z = ORCHARD.z + lz;
    const y = terrainHeight(x, z);
    dummy.position.set(x, y + 1.7, z);
    dummy.scale.set(0.7, 0.85, 0.7);
    dummy.rotation.y = hash2(i, 81) * 6;
    dummy.updateMatrix();
    fruit.setMatrixAt(i, dummy.matrix);
    dummy.position.set(x, y + 0.7, z);
    dummy.scale.set(0.45, 0.7, 0.45);
    dummy.updateMatrix();
    trunks.setMatrixAt(trunkN++, dummy.matrix);
    canopy.push({ x, z, r: 1.3 });
  }
  trunks.count = trunkN;
  fruit.castShadow = true;
  group.add(fruit);
  track(fruitGeo, fruitMat);

  const bushGeo = new THREE.SphereGeometry(0.7, 5, 4);
  const bushMat = new THREE.MeshPhongMaterial({ color: 0x2f542c, shininess: 6, flatShading: true });
  const bushN = mobile ? 90 : 160;
  const bushes = new THREE.InstancedMesh(bushGeo, bushMat, bushN);
  let bi = 0;
  for (const [ax, az, bx, bz] of HEDGES) {
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(4, Math.round(len / 1.35));
    for (let i = 0; i < n && bi < bushN; i++) {
      const t = i / (n - 1);
      const x = lerp(ax, bx, t) + (hash2(bi, 33) - 0.5) * 0.7;
      const z = lerp(az, bz, t) + (hash2(bi, 34) - 0.5) * 0.7;
      const y = terrainHeight(x, z);
      dummy.position.set(x, y + 0.55, z);
      dummy.scale.set(0.85 + hash2(bi, 35) * 0.5, 0.9 + hash2(bi, 36) * 0.7, 0.7 + hash2(bi, 37) * 0.4);
      dummy.rotation.y = hash2(bi, 38) * 6;
      dummy.updateMatrix();
      bushes.setMatrixAt(bi, dummy.matrix);
      tmpC.setRGB(0.14 + hash2(bi, 39) * 0.08, 0.32 + hash2(bi, 40) * 0.12, 0.12);
      bushes.setColorAt(bi, tmpC);
      obstacles.push({ x, z, r: 0.55 });
      canopy.push({ x, z, r: 1.1 });
      bi++;
    }
  }
  for (let i = 0; i < 180 && bi < bushN; i++) {
    const x = (hash2(i, 31) - 0.5) * WORLD_SIZE * 0.85;
    const z = (hash2(i, 32) - 0.5) * WORLD_SIZE * 0.85;
    if (occupied(x, z, 10)) continue;
    const y = terrainHeight(x, z);
    if (y < 0.4) continue;
    dummy.position.set(x, y + 0.35, z);
    dummy.scale.setScalar(0.55 + hash2(i, 33) * 1.0);
    dummy.rotation.y = hash2(i, 34) * 6;
    dummy.updateMatrix();
    bushes.setMatrixAt(bi, dummy.matrix);
    tmpC.setRGB(0.16 + hash2(i, 39) * 0.1, 0.34 + hash2(i, 40) * 0.14, 0.12);
    bushes.setColorAt(bi, tmpC);
    bi++;
  }
  bushes.count = bi;
  bushes.castShadow = true;
  if (bushes.instanceColor) bushes.instanceColor.needsUpdate = true;
  group.add(bushes);
  track(bushGeo, bushMat);

  const wheatGeo = new THREE.ConeGeometry(0.055, 1.05, 4);
  const wheatMat = new THREE.MeshPhongMaterial({ color: 0xc8b45c, shininess: 4, flatShading: true });
  const wheatN = mobile ? 420 : 920;
  const wheat = new THREE.InstancedMesh(wheatGeo, wheatMat, wheatN);
  const cornGeo = new THREE.CylinderGeometry(0.045, 0.07, 1.85, 5);
  const cornMat = new THREE.MeshPhongMaterial({ color: 0x3a6a30, shininess: 6, flatShading: true });
  const cobGeo = new THREE.BoxGeometry(0.07, 0.22, 0.05);
  const cobMat = new THREE.MeshPhongMaterial({ color: 0xe0c45a, shininess: 8 });
  const cornN = mobile ? 160 : 340;
  const corn = new THREE.InstancedMesh(cornGeo, cornMat, cornN);
  const cobs = new THREE.InstancedMesh(cobGeo, cobMat, cornN);
  const stemGeo = new THREE.CylinderGeometry(0.025, 0.04, 1.55, 5);
  const stemMat = new THREE.MeshPhongMaterial({ color: 0x4a6a30, shininess: 6 });
  const headGeo = new THREE.CircleGeometry(0.22, 8);
  const headMat = new THREE.MeshPhongMaterial({ color: 0xe8c430, shininess: 12, side: THREE.DoubleSide });
  const sunN = mobile ? 70 : 150;
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, sunN);
  const heads = new THREE.InstancedMesh(headGeo, headMat, sunN);

  function scatter(kind: FieldKind, max: number, fn: (x: number, z: number, i: number, k: number) => void): number {
    const plots = FIELDS.filter((f) => f.kind === kind);
    if (!plots.length) return 0;
    let k = 0;
    for (let i = 0; i < max * 3 && k < max; i++) {
      const f = plots[i % plots.length];
      const lx = (hash2(i, 51 + k) - 0.5) * f.w * 0.9;
      const lz = (hash2(i, 52 + k) - 0.5) * f.d * 0.9;
      const c = Math.cos(f.yaw);
      const s = Math.sin(f.yaw);
      const x = f.x + lx * c + lz * s;
      const z = f.z - lx * s + lz * c;
      if (roadDist(x, z) < 3.0) continue;
      fn(x, z, i, k);
      k++;
    }
    return k;
  }

  const wn = scatter("wheat", wheatN, (x, z, i, k) => {
    const y = terrainHeight(x, z);
    const sc = 0.85 + hash2(i, 55) * 0.7;
    dummy.position.set(x, y + 0.5 * sc, z);
    dummy.rotation.set(0.04, hash2(i, 56) * 6, 0.05);
    dummy.scale.set(0.7 + hash2(i, 57) * 0.5, sc, 0.7);
    dummy.updateMatrix();
    wheat.setMatrixAt(k, dummy.matrix);
    tmpC.setRGB(0.62 + hash2(i, 58) * 0.18, 0.55 + hash2(i, 59) * 0.14, 0.18 + hash2(i, 60) * 0.08);
    wheat.setColorAt(k, tmpC);
  });
  wheat.count = wn;
  wheat.castShadow = true;
  if (wheat.instanceColor) wheat.instanceColor.needsUpdate = true;
  group.add(wheat);
  track(wheatGeo, wheatMat);

  const cn = scatter("corn", cornN, (x, z, i, k) => {
    const y = terrainHeight(x, z);
    const sc = 0.95 + hash2(i, 61) * 0.45;
    dummy.position.set(x, y + 0.92 * sc, z);
    dummy.rotation.set(0.03, hash2(i, 62) * 6, 0.04);
    dummy.scale.set(1, sc, 1);
    dummy.updateMatrix();
    corn.setMatrixAt(k, dummy.matrix);
    tmpC.setRGB(0.18 + hash2(i, 63) * 0.1, 0.38 + hash2(i, 64) * 0.14, 0.12);
    corn.setColorAt(k, tmpC);
    dummy.position.set(x + 0.08, y + 1.15 * sc, z);
    dummy.rotation.set(0.4, hash2(i, 65), 0.2);
    dummy.scale.set(1, 1, 1);
    dummy.updateMatrix();
    cobs.setMatrixAt(k, dummy.matrix);
  });
  corn.count = cobs.count = cn;
  corn.castShadow = true;
  if (corn.instanceColor) corn.instanceColor.needsUpdate = true;
  group.add(corn, cobs);
  track(cornGeo, cornMat, cobGeo, cobMat);

  const sn = scatter("sunflower", sunN, (x, z, i, k) => {
    const y = terrainHeight(x, z);
    const sc = 0.9 + hash2(i, 71) * 0.4;
    dummy.position.set(x, y + 0.78 * sc, z);
    dummy.rotation.set(0.05, 0, 0.04);
    dummy.scale.set(1, sc, 1);
    dummy.updateMatrix();
    stems.setMatrixAt(k, dummy.matrix);
    dummy.position.set(x, y + 1.55 * sc, z);
    dummy.rotation.set(-0.55, hash2(i, 72) * 0.4, 0.15);
    dummy.scale.set(sc, sc, 1);
    dummy.updateMatrix();
    heads.setMatrixAt(k, dummy.matrix);
    tmpC.setRGB(0.82 + hash2(i, 73) * 0.12, 0.68 + hash2(i, 74) * 0.1, 0.12);
    heads.setColorAt(k, tmpC);
  });
  stems.count = heads.count = sn;
  stems.castShadow = true;
  if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  group.add(stems, heads);
  track(stemGeo, stemMat, headGeo, headMat);

  const cropGeo = new THREE.ConeGeometry(0.12, 0.42, 4);
  const cropMat = new THREE.MeshPhongMaterial({ color: 0x4a7a38, shininess: 4, flatShading: true });
  const cropN = mobile ? 140 : 280;
  const crops = new THREE.InstancedMesh(cropGeo, cropMat, cropN);
  const crn = scatter("crop", cropN, (x, z, i, k) => {
    const y = terrainHeight(x, z);
    dummy.position.set(x, y + 0.2, z);
    dummy.rotation.set(0.1, hash2(i, 81) * 6, 0.08);
    dummy.scale.set(0.8 + hash2(i, 82), 0.9 + hash2(i, 83) * 0.8, 0.8);
    dummy.updateMatrix();
    crops.setMatrixAt(k, dummy.matrix);
    tmpC.setRGB(0.22 + hash2(i, 84) * 0.12, 0.42 + hash2(i, 85) * 0.16, 0.14);
    crops.setColorAt(k, tmpC);
  });
  crops.count = crn;
  if (crops.instanceColor) crops.instanceColor.needsUpdate = true;
  group.add(crops);
  track(cropGeo, cropMat);

  const grassGeo = new THREE.ConeGeometry(0.16, 0.55, 3);
  const grassMat = new THREE.MeshPhongMaterial({ color: 0x5a8244, shininess: 4, flatShading: true });
  const grassN = mobile ? 140 : 360;
  const grass = new THREE.InstancedMesh(grassGeo, grassMat, grassN);
  let gi = 0;
  for (let i = 0; i < 800 && gi < grassN; i++) {
    const x = -50 + hash2(i, 41) * 150;
    const z = -70 + hash2(i, 42) * 130;
    if (roadDist(x, z) < 5) continue;
    const fld = fieldAt(x, z);
    if (fld && fld !== "pasture") continue;
    const y = terrainHeight(x, z);
    if (y < 0.4 || y > 9) continue;
    dummy.position.set(x, y + 0.22, z);
    dummy.rotation.set(0.05, hash2(i, 43) * 6, 0.08);
    dummy.scale.set(0.7 + hash2(i, 44), 0.8 + hash2(i, 45) * 1.4, 0.7);
    dummy.updateMatrix();
    grass.setMatrixAt(gi, dummy.matrix);
    tmpC.setRGB(0.26 + hash2(i, 46) * 0.12, 0.46 + hash2(i, 47) * 0.18, 0.14);
    grass.setColorAt(gi, tmpC);
    gi++;
  }
  grass.count = gi;
  if (grass.instanceColor) grass.instanceColor.needsUpdate = true;
  group.add(grass);
  track(grassGeo, grassMat);

  const reedGeo = new THREE.ConeGeometry(0.05, 1.15, 3);
  const reedMat = new THREE.MeshPhongMaterial({ color: 0x6a7a40, shininess: 4, flatShading: true });
  const reedN = mobile ? 50 : 90;
  const reeds = new THREE.InstancedMesh(reedGeo, reedMat, reedN);
  let ri = 0;
  for (let i = 0; i < 200 && ri < reedN; i++) {
    const pond = i % 2 === 0 ? POND2 : POND;
    const a = hash2(i, 91) * Math.PI * 2;
    const rad = pond.r * (0.72 + hash2(i, 92) * 0.4);
    const x = pond.x + Math.cos(a) * rad;
    const z = pond.z + Math.sin(a) * rad;
    const y = terrainHeight(x, z);
    dummy.position.set(x, y + 0.5, z);
    dummy.rotation.set(0.08, a, 0.05);
    dummy.scale.set(0.8, 0.8 + hash2(i, 93) * 0.9, 0.8);
    dummy.updateMatrix();
    reeds.setMatrixAt(ri++, dummy.matrix);
  }
  reeds.count = ri;
  group.add(reeds);
  track(reedGeo, reedMat);

  function snapWind(mesh: THREE.InstancedMesh) {
    return (mesh.instanceMatrix.array as Float32Array).slice(0, mesh.count * 16);
  }
  const windSet: Array<{ mesh: THREE.InstancedMesh; base: Float32Array; amp: number; phase: number }> = [
    { mesh: wheat, base: snapWind(wheat), amp: 0.22, phase: 0.1 },
    { mesh: corn, base: snapWind(corn), amp: 0.1, phase: 0.7 },
    { mesh: stems, base: snapWind(stems), amp: 0.12, phase: 1.2 },
    { mesh: crops, base: snapWind(crops), amp: 0.16, phase: 0.4 },
    { mesh: grass, base: snapWind(grass), amp: 0.2, phase: 1.8 },
    { mesh: reeds, base: snapWind(reeds), amp: 0.28, phase: 2.4 },
  ];

  const rockGeo = new THREE.IcosahedronGeometry(1.1, 0);
  const rockMat = new THREE.MeshPhongMaterial({ color: 0x6a6c62, shininess: 8, flatShading: true });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 70);
  for (let i = 0; i < 70; i++) {
    let x = (hash2(i, 21) - 0.5) * WORLD_SIZE * 0.9;
    let z = (hash2(i, 22) - 0.5) * WORLD_SIZE * 0.9;
    if (i < 18) {
      const a = hash2(i, 23) * Math.PI * 2;
      x = QUARRY.x + Math.cos(a) * (QUARRY.r * 0.7);
      z = QUARRY.z + Math.sin(a) * (QUARRY.r * 0.7);
    }
    dummy.position.set(x, terrainHeight(x, z) + 0.25, z);
    dummy.rotation.set(hash2(i, 1), hash2(i, 2), hash2(i, 3));
    dummy.scale.setScalar(0.4 + hash2(i, 5) * 1.4);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
  }
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  group.add(rocks);
  track(rockGeo, rockMat);

  const hayGeo = new THREE.CylinderGeometry(0.85, 0.9, 1.15, 8);
  const hayMat = new THREE.MeshPhongMaterial({ color: 0xc4a45a, shininess: 4, flatShading: true });
  const hay = new THREE.InstancedMesh(hayGeo, hayMat, 10);
  const hayPos: Array<[number, number]> = [
    [16, 12],
    [26, 4],
    [-2, 22],
    [50, -10],
    [62, 22],
    [-20, 18],
    [8, -6],
    [38, -18],
    [20, 30],
    [-40, 4],
  ];
  for (let i = 0; i < hayPos.length; i++) {
    const [x, z] = hayPos[i];
    dummy.position.set(x, terrainHeight(x, z) + 0.58, z);
    dummy.rotation.set(1.55, hash2(i, 3) * 6, 0);
    dummy.scale.setScalar(0.9 + hash2(i, 4) * 0.35);
    dummy.updateMatrix();
    hay.setMatrixAt(i, dummy.matrix);
    obstacles.push({ x, z, r: 1.05 });
  }
  hay.castShadow = true;
  group.add(hay);
  track(hayGeo, hayMat);

  const buildings: { x: number; z: number; r: number; h: number }[] = [];
  const boxMat = {
    concrete: new THREE.MeshPhongMaterial({ color: 0x7a7c70, shininess: 12 }),
    dark: new THREE.MeshPhongMaterial({ color: 0x3e4038, shininess: 18 }),
    rust: new THREE.MeshPhongMaterial({ color: 0x6a5240, shininess: 14 }),
    camo: new THREE.MeshPhongMaterial({ color: 0x556244, shininess: 10 }),
    metal: new THREE.MeshPhongMaterial({ color: 0x5a6058, shininess: 42, specular: 0x888888 }),
    wood: new THREE.MeshPhongMaterial({ color: 0x6a5038, shininess: 8 }),
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
    obstacles.push({ x, z, r: Math.max(w, d) * 0.52 });
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

  box(-30, 36, 6.2, 3.1, 5.4, boxMat.wood, 0.35);
  box(-30, 36, 6.8, 0.28, 5.9, boxMat.rust, 0.35, 1.65);
  windows(-30, 36, 6.2, 3.1, 5.4, 0.35);
  box(-26, 32, 3.4, 2.4, 3.2, boxMat.wood, 0.5);
  box(28, 12, 4.2, 2.6, 3.6, boxMat.wood, -0.2);
  windows(28, 12, 4.2, 2.6, 3.6, -0.2);

  for (let i = 0; i < 12; i++) {
    const x = -22 + i * 8;
    const z = -42;
    box(x, z, 1.7, 0.95, 1.15, boxMat.camo, 0.04 * i);
  }

  const plank = new THREE.MeshPhongMaterial({ color: 0x5a4834, shininess: 8 });
  track(plank);
  const brX = 2;
  const brZ = 16;
  box(brX, brZ, 5.2, 0.22, 2.1, plank, 0.08, 0.35);

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
  const padMat = new THREE.MeshPhongMaterial({ color: 0x545650, shininess: 20 });
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

  scene.fog = new THREE.Fog(FOG, 120, 460);
  scene.background = new THREE.Color(FOG);

  function coverAt(x: number, z: number) {
    let c = 0;
    for (const b of buildings) {
      if (Math.hypot(x - b.x, z - b.z) < b.r + 1.2) c = Math.max(c, 0.94);
    }
    for (const t of canopy) {
      if (Math.hypot(x - t.x, z - t.z) < t.r) c = Math.max(c, 0.72);
    }
    if (hedgeDist(x, z) < 1.4) c = Math.max(c, 0.64);
    const fld = fieldAt(x, z);
    if (fld === "corn") c = Math.max(c, 0.58);
    else if (fld === "sunflower") c = Math.max(c, 0.44);
    else if (fld === "wheat") c = Math.max(c, 0.34);
    else if (fld === "crop") c = Math.max(c, 0.28);
    const h = terrainHeight(x, z);
    if (h < 0.15) c = Math.max(c, 0.58);
    if (Math.abs(z + 40) < 5 && x > -30 && x < 90) c = Math.max(c, 0.7);
    return c;
  }

  function surfaceAt(x: number, z: number): "road" | "field" | "grass" | "water" {
    if (roadDist(x, z) < 4.3) return "road";
    if (riverDist(x, z) < 10 || streamDist(x, z) < 3.2) return "water";
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r || Math.hypot(x - POND2.x, z - POND2.z) < POND2.r) return "water";
    const fld = fieldAt(x, z);
    if (fld && fld !== "pasture" && fld !== "fallow") return "field";
    return "grass";
  }

  let windAng = 0.82;
  let windGust = 0;

  function updateWind(t: number) {
    windAng = 0.72 + Math.sin(t * 0.037) * 0.62 + Math.sin(t * 0.013) * 0.38;
    windGust = Math.max(0, Math.sin(t * 0.71) * 0.82 + Math.sin(t * 1.73) * 0.38 - 0.32);
  }

  function getWind() {
    return { x: Math.cos(windAng), z: Math.sin(windAng), gust: windGust };
  }

  function tick(t: number, camera: THREE.Camera) {
    updateWind(t);
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

    dummy.quaternion.identity();
    for (let i = 0; i < birdOrbit.length; i++) {
      const [cx, cy, cz, r, ph] = birdOrbit[i];
      const a = ph + t * (0.35 + i * 0.03);
      const flap = 0.35 + Math.sin(t * 14 + i) * 0.25;
      dummy.position.set(cx + Math.cos(a) * r, cy + Math.sin(t * 0.8 + i) * 1.2, cz + Math.sin(a) * r);
      dummy.rotation.set(flap * 0.15, -a + Math.PI / 2, flap);
      dummy.scale.setScalar(1.1);
      dummy.updateMatrix();
      birds.setMatrixAt(i, dummy.matrix);
    }
    birds.instanceMatrix.needsUpdate = true;

    for (const w of windSet) {
      const arr = w.mesh.instanceMatrix.array as Float32Array;
      arr.set(w.base);
      const n = w.mesh.count;
      const gust = 0.72 + windGust * 1.15;
      for (let i = 0; i < n; i++) {
        const o = i * 16;
        const x = arr[o + 12];
        const z = arr[o + 14];
        const lean = Math.sin(t * 1.55 + x * 0.11 + z * 0.09 + w.phase) * w.amp * gust;
        arr[o + 4] += lean;
        arr[o + 6] += lean * 0.35;
      }
      w.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  function setNight(on: boolean) {
    const fog = on ? 0x1a2834 : FOG;
    scene.fog = new THREE.Fog(fog, on ? 55 : 120, on ? 290 : 460);
    scene.background = new THREE.Color(fog);
    skyMat.color.setHex(on ? 0x2a3a58 : 0xffffff);
    sunGlowMat.opacity = on ? 0.12 : 0.78;
    sun.visible = !on;
    sunGlow.visible = !on;
    moon.visible = on;
    cloudMat.opacity = on ? 0.28 : 0.68;
    cloudMat.color.setHex(on ? 0x8899aa : 0xffffff);
    boxMat.pane.emissive.setHex(on ? 0xc4a05a : 0x1c2418);
    boxMat.pane.emissiveIntensity = on ? 1.45 : 0.18;
    birdMat.color.setHex(on ? 0x0a0c10 : 0x1c1e18);
  }

  return {
    group,
    heightAt: terrainHeight,
    spawnPad,
    spawns,
    buildings,
    obstacles,
    coverAt,
    surfaceAt,
    roads: ROADS,
    tick,
    setNight,
    getWind,
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
    return mesh;
  };

  if (kind === "infantry") {
    add(new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 3, 6), mats.olive), 0, 1.12, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), mats.skin), 0, 1.62, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mats.olive), 0, 1.72, 0.02);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.16), mats.dark), 0, 1.28, 0.18);
    const legL = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.48, 2, 5), mats.olive), -0.12, 0.4, 0);
    const legR = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.09, 0.48, 2, 5), mats.olive), 0.12, 0.4, 0);
    const armL = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 2, 5), mats.olive), -0.32, 1.18, 0.05);
    const armR = add(new THREE.Mesh(new THREE.CapsuleGeometry(0.07, 0.42, 2, 5), mats.olive), 0.32, 1.18, 0.05);
    const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.1), mats.dark);
    rifle.rotation.x = -0.15;
    add(rifle, 0.28, 1.15, 0.45);
    g.userData.anim = { legL, legR, armL, armR };
  } else if (kind === "jeep") {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.55, 3.4), mats.olive), 0, 0.72, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.62, 1.35), mats.dark), 0, 1.22, -0.35);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.42, 0.08), mats.glass);
    glass.rotation.x = -0.35;
    add(glass, 0, 1.22, 0.42);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 0.22), mats.metal), 0, 0.55, 1.72);
    const wheels: THREE.Mesh[] = [];
    for (const [x, z] of [
      [-0.85, 1.15],
      [0.85, 1.15],
      [-0.85, -1.15],
      [0.85, -1.15],
    ] as const) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 10), mats.dark);
      wheel.rotation.z = Math.PI / 2;
      add(wheel, x, 0.38, z);
      wheels.push(wheel);
    }
    g.userData.anim = { wheels };
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
