import * as THREE from "three";
import { TARGETS, WORLD_SIZE, type Armor, type TargetKind } from "./catalog";
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
  dispose: () => void;
};

const HALF = WORLD_SIZE * 0.5;

const BEACON: Record<Armor, number> = {
  soft: 0x8fb87a,
  light: 0xc4a05a,
  heavy: 0xc45c4a,
};

export function terrainHeight(x: number, z: number): number {
  const nx = x * 0.011;
  const nz = z * 0.011;
  let h = fbm(nx + 20, nz + 8) * 14 - 4;
  h += Math.sin(x * 0.018) * Math.cos(z * 0.014) * 3.2;

  const road = Math.abs(z + x * 0.08);
  if (road < 9) h = lerp(h, 1.2, 1 - road / 9);

  const river = Math.abs(z - 70 - Math.sin(x * 0.02) * 16);
  if (river < 14) h = lerp(h, -1.6, 1 - river / 14);

  const trenchZ = Math.abs(z + 40);
  const trenchX = x > -30 && x < 90;
  if (trenchX && trenchZ < 4.5) h = Math.min(h, -1.1);

  const pad = Math.hypot(x + 18, z - 12);
  if (pad < 16) h = lerp(h, 1.6, 1 - pad / 16);

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
  tex.anisotropy = 4;
  return tex;
}

function groundTexture(): THREE.CanvasTexture {
  return canvasTex(256, (ctx, s) => {
    ctx.fillStyle = "#2c4a28";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 1600; i++) {
      const g = 48 + Math.random() * 70;
      ctx.fillStyle = `rgba(${g * 0.55},${g},${g * 0.38},${0.18 + Math.random() * 0.4})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2 + Math.random() * 6, 2 + Math.random() * 4);
    }
  });
}

export function buildWorld(scene: THREE.Scene): WorldApi {
  const group = new THREE.Group();
  scene.add(group);
  const disposers: Array<() => void> = [];
  const track = (...obj: Array<THREE.BufferGeometry | THREE.Material | THREE.Texture>) => {
    for (const o of obj) disposers.push(() => o.dispose());
  };

  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 96, 96);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const ridge = new THREE.Color(0x6e8a62);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);
    const road = Math.abs(z + x * 0.08) < 7;
    const river = Math.abs(z - 70 - Math.sin(x * 0.02) * 16) < 11;
    if (river) col.setRGB(0.14, 0.36, 0.34);
    else if (road) col.setRGB(0.28, 0.26, 0.2);
    else {
      const n = fbm(x * 0.03, z * 0.03);
      col.setRGB(0.16 + n * 0.1, 0.34 + n * 0.18, 0.12 + n * 0.05);
      if (y < 0.4) col.setRGB(0.26, 0.34, 0.16);
      if (y > 10) col.lerp(ridge, 0.35);
    }
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const groundTex = groundTexture();
  groundTex.repeat.set(48, 48);
  const groundMat = new THREE.MeshLambertMaterial({
    vertexColors: true,
    map: groundTex,
  });
  const ground = new THREE.Mesh(geo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);
  track(geo, groundMat, groundTex);

  const riverGeo = new THREE.PlaneGeometry(WORLD_SIZE, 18, 20, 4);
  riverGeo.rotateX(-Math.PI / 2);
  const rp = riverGeo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < rp.count; i++) {
    const x = rp.getX(i);
    const z = 70 + Math.sin(x * 0.02) * 16 + rp.getZ(i);
    rp.setXYZ(i, x, terrainHeight(x, z) + 0.15, z);
  }
  riverGeo.computeVertexNormals();
  const riverMat = new THREE.MeshLambertMaterial({
    color: 0x2f6a66,
    transparent: true,
    opacity: 0.78,
  });
  const river = new THREE.Mesh(riverGeo, riverMat);
  group.add(river);
  track(riverGeo, riverMat);

  const skyGeo = new THREE.SphereGeometry(520, 24, 16);
  const skyCol = new Float32Array(skyGeo.attributes.position.count * 3);
  const skyC = new THREE.Color();
  const zenith = new THREE.Color(0x7eb4d0);
  for (let i = 0; i < skyGeo.attributes.position.count; i++) {
    const y = skyGeo.attributes.position.getY(i) / 520;
    skyC.setRGB(0.42, 0.56, 0.58).lerp(zenith, Math.max(0, y));
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

  const sunGeo = new THREE.CircleGeometry(22, 24);
  const sunMat = new THREE.MeshBasicMaterial({ color: 0xfff4d4, fog: false });
  const sun = new THREE.Mesh(sunGeo, sunMat);
  sun.position.set(-180, 110, -220);
  sun.lookAt(0, 0, 0);
  group.add(sun);
  track(sunGeo, sunMat);

  const trunkGeo = new THREE.CylinderGeometry(0.18, 0.28, 2.2, 5);
  const crownGeo = new THREE.ConeGeometry(1.6, 4.2, 6);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4a3828 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0x3a6a32 });
  const treeCount = 220;
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeCount);
  trunks.castShadow = crowns.castShadow = true;
  const dummy = new THREE.Object3D();
  let placed = 0;
  for (let i = 0; i < 600 && placed < treeCount; i++) {
    const x = (hash2(i, 3) - 0.5) * (WORLD_SIZE - 24);
    const z = (hash2(i, 9) - 0.5) * (WORLD_SIZE - 24);
    if (Math.abs(z + x * 0.08) < 12) continue;
    if (Math.abs(z - 70 - Math.sin(x * 0.02) * 16) < 16) continue;
    if (Math.hypot(x + 18, z - 12) < 22) continue;
    const y = terrainHeight(x, z);
    if (y < 0.6) continue;
    const s = 0.7 + hash2(i, 11) * 0.9;
    dummy.position.set(x, y + 1.1 * s, z);
    dummy.rotation.set(0, hash2(i, 4) * 6, 0);
    dummy.scale.set(s, s, s);
    dummy.updateMatrix();
    trunks.setMatrixAt(placed, dummy.matrix);
    dummy.position.y = y + 3.4 * s;
    dummy.updateMatrix();
    crowns.setMatrixAt(placed, dummy.matrix);
    placed++;
  }
  trunks.count = crowns.count = placed;
  group.add(trunks, crowns);
  track(trunkGeo, crownGeo, trunkMat, crownMat);

  const rockGeo = new THREE.IcosahedronGeometry(1.1, 0);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x5a5c54 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, 70);
  let ri = 0;
  for (let i = 0; i < 70; i++) {
    const x = (hash2(i, 21) - 0.5) * WORLD_SIZE * 0.9;
    const z = (hash2(i, 22) - 0.5) * WORLD_SIZE * 0.9;
    dummy.position.set(x, terrainHeight(x, z) + 0.3, z);
    dummy.rotation.set(hash2(i, 1), hash2(i, 2), hash2(i, 3));
    dummy.scale.setScalar(0.5 + hash2(i, 5) * 1.4);
    dummy.updateMatrix();
    rocks.setMatrixAt(ri++, dummy.matrix);
  }
  group.add(rocks);
  track(rockGeo, rockMat);

  const buildings: { x: number; z: number; r: number; h: number }[] = [];
  const boxMat = {
    concrete: new THREE.MeshLambertMaterial({ color: 0x6a6b62 }),
    dark: new THREE.MeshLambertMaterial({ color: 0x3e403a }),
    rust: new THREE.MeshLambertMaterial({ color: 0x5a4638 }),
    camo: new THREE.MeshLambertMaterial({ color: 0x4a533c }),
    metal: new THREE.MeshLambertMaterial({ color: 0x4d524c }),
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

  box(-8, 8, 18, 6, 12, boxMat.concrete, 0.1);
  box(-8, 8, 18.4, 0.4, 12.4, boxMat.dark, 0.1, 3.1);
  box(-28, 18, 10, 4.2, 16, boxMat.camo, 0.2);
  box(8, -6, 6, 8, 6, boxMat.concrete, 0);
  box(8, -6, 2.2, 3.5, 2.2, boxMat.dark, 0, 4);
  box(22, 24, 14, 3.2, 8, boxMat.rust, -0.4);
  box(-40, -8, 22, 5, 10, boxMat.concrete, 0.05);
  box(40, -30, 9, 3, 9, boxMat.camo, 0.7);
  box(-60, 40, 8, 3.5, 18, boxMat.dark, 1.1);

  for (let i = 0; i < 10; i++) {
    const x = -20 + i * 8;
    const z = -42;
    box(x, z, 1.6, 1.1, 1.6, boxMat.camo, 0.05 * i);
  }

  const spawnPad = new THREE.Vector3(-18, terrainHeight(-18, 12) + 0.8, 12);
  const padGeo = new THREE.CylinderGeometry(5.5, 5.5, 0.35, 16);
  const padMat = new THREE.MeshLambertMaterial({ color: 0x4a4c46 });
  const pad = new THREE.Mesh(padGeo, padMat);
  pad.position.copy(spawnPad).setY(spawnPad.y - 0.4);
  group.add(pad);
  track(padGeo, padMat);

  const ringGeo = new THREE.RingGeometry(4.6, 5.2, 24);
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

  scene.fog = new THREE.Fog(0x87a898, 120, 420);
  scene.background = new THREE.Color(0x87a898);

  return {
    group,
    heightAt: terrainHeight,
    spawnPad,
    spawns,
    buildings,
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
    olive: new THREE.MeshLambertMaterial({ color: 0x4c5538 }),
    dark: new THREE.MeshLambertMaterial({ color: 0x2c2e28 }),
    sand: new THREE.MeshLambertMaterial({ color: 0x6b6754 }),
    rust: new THREE.MeshLambertMaterial({ color: 0x6a4e3a }),
    skin: new THREE.MeshLambertMaterial({ color: 0x6a5a48 }),
    metal: new THREE.MeshLambertMaterial({ color: 0x5c615a }),
    amber: new THREE.MeshLambertMaterial({ color: 0x8a7a4a }),
  };

  const add = (mesh: THREE.Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
  };

  if (kind === "infantry") {
    add(new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.7, 3, 6), mats.olive), 0, 0.9, 0);
    add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), mats.skin), 0, 1.55, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.18, 0.18), mats.dark), 0, 1.2, 0.15);
  } else if (kind === "jeep") {
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 3.4), mats.olive), 0, 0.7, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.7, 1.4), mats.dark), 0, 1.25, -0.3);
    for (const [x, z] of [
      [-0.85, 1.1],
      [0.85, 1.1],
      [-0.85, -1.1],
      [0.85, -1.1],
    ] as const) {
      add(new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 8), mats.dark), x, 0.38, z);
    }
  } else if (kind === "truck") {
    add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 5.6), mats.sand), 0, 0.9, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.1, 1.1, 2.1), mats.dark), 0, 1.6, 1.6);
    add(new THREE.Mesh(new THREE.BoxGeometry(2.05, 1.5, 3.2), mats.olive), 0, 1.85, -1.1);
  } else if (kind === "ifv") {
    add(new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 5.2), mats.olive), 0, 0.85, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 2.2), mats.olive), 0, 1.6, -0.2);
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 6), mats.dark);
    barrel.rotation.x = Math.PI / 2;
    add(barrel, 0, 1.7, 2.0);
  } else if (kind === "radar") {
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 5.5, 6), mats.metal), 0, 2.8, 0);
    const dish = new THREE.Mesh(new THREE.CircleGeometry(2.1, 16), mats.metal);
    dish.rotation.x = -0.7;
    add(dish, 0, 5.6, 0.4);
  } else if (kind === "bunker") {
    add(new THREE.Mesh(new THREE.BoxGeometry(8.5, 2.6, 6.5), mats.sand), 0, 1.3, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(3.2, 1.2, 2.2), mats.dark), 0, 2.5, 1.6);
    add(new THREE.Mesh(new THREE.BoxGeometry(9, 0.35, 7), mats.metal), 0, 2.7, 0);
  } else if (kind === "fuel") {
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 4.2, 10), mats.rust);
    tank.rotation.z = Math.PI / 2;
    add(tank, 0, 1.4, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1, 2.2, 1), mats.dark), 2.2, 1.2, 0);
  } else if (kind === "sam") {
    add(new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.9, 4.4), mats.olive), 0, 0.8, 0);
    add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.6, 1.8), mats.dark), 0, 1.5, -0.4);
    for (const x of [-0.45, 0.45]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 2.8, 6), mats.amber);
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
  const carbon = new THREE.MeshLambertMaterial({ color: 0x1c1e1a });
  const accent = new THREE.MeshLambertMaterial({ color: 0xb7c4a8 });
  const motor = new THREE.MeshLambertMaterial({ color: 0x2a2c28 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.28), carbon);
  g.add(body);
  const cam = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.06, 0.08), accent);
  cam.position.set(0, -0.02, -0.16);
  g.add(cam);

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
      new THREE.CircleGeometry(0.16, 12),
      new THREE.MeshBasicMaterial({ color: 0x9aa392, transparent: true, opacity: 0.28, side: THREE.DoubleSide }),
    );
    prop.rotation.x = -Math.PI / 2;
    prop.position.set(x, 0.05, z);
    prop.userData.prop = true;
    g.add(prop);
  }
  return g;
}

export const WORLD_HALF = HALF;
