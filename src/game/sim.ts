import * as THREE from "three";
import {
  ARMOR_LABEL,
  BATTERY_MAX,
  DRONE_LIVES,
  expectedDamage,
  KAMIKAZE,
  TARGETS,
  WEAPON_ORDER,
  WEAPONS,
  WORLD_SIZE,
  type Armor,
  type TargetKind,
  type WeaponId,
} from "./catalog";
import { clamp, expDamp } from "./math";
import type { Actions } from "./input";
import type { KillcamSpec } from "./replay";
import type { RadarBlip } from "./store";
import type { WorldApi } from "./world";
import { createTargetMesh } from "./world";

export type Projectile = {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  weapon: WeaponId;
  mesh: THREE.Mesh;
};

export type Target = {
  id: number;
  kind: TargetKind;
  armor: Armor;
  hp: number;
  maxHp: number;
  label: string;
  score: number;
  radius: number;
  pos: THREE.Vector3;
  yaw: number;
  alive: boolean;
  mesh: THREE.Group;
  flash: number;
  wreckTilt: number;
  smokeAcc: number;
  holdWreck: boolean;
  live: boolean;
};

export type DroneState = {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  throttle: number;
  battery: number;
  alive: boolean;
  invuln: number;
};

export type CombatEvent =
  | { type: "shot"; weapon: WeaponId }
  | { type: "hit"; damage: number; kill: boolean; label: string; x: number; y: number; z: number }
  | { type: "explode"; x: number; y: number; z: number; size: number }
  | { type: "crash"; kamikaze: boolean }
  | { type: "killcam"; spec: KillcamSpec }
  | { type: "lock" };

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _tmp2 = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2(0, 0);
const _yAxis = new THREE.Vector3(0, 1, 0);

const GRAVITY = 18;
const THRUST = 42;
const HOVER = GRAVITY / THRUST;
const MAX_PITCH = 0.72;
const MAX_ROLL = 0.7;
const YAW_RATE = 1.85;
const FIXED = 1 / 60;
const FWD_THRUST = 22;
const NOSE_DOWN = 0.16;

const DEBRIS_TINT: Record<TargetKind, number> = {
  infantry: 1,
  jeep: 0,
  truck: 0,
  ifv: 0,
  radar: 3,
  bunker: 4,
  fuel: 2,
  sam: 0,
};

export function createSim(scene: THREE.Scene, world: WorldApi) {
  const droneBodyGroup = new THREE.Group();
  scene.add(droneBodyGroup);

  const drone: DroneState = {
    pos: world.spawnPad.clone(),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    roll: 0,
    throttle: HOVER,
    battery: BATTERY_MAX,
    alive: true,
    invuln: 0,
  };

  const targets: Target[] = [];
  let idSeq = 1;
  for (const s of world.spawns) {
    const def = TARGETS[s.kind];
    const mesh = createTargetMesh(s.kind);
    const y = world.heightAt(s.x, s.z);
    mesh.position.set(s.x, y, s.z);
    mesh.rotation.y = s.yaw;
    scene.add(mesh);
    targets.push({
      id: idSeq++,
      kind: s.kind,
      armor: def.armor,
      hp: def.hp,
      maxHp: def.hp,
      label: def.label,
      score: def.score,
      radius: def.radius,
      pos: new THREE.Vector3(s.x, y + def.height * 0.45, s.z),
      yaw: s.yaw,
      alive: true,
      mesh,
      flash: 0,
      wreckTilt: 0,
      smokeAcc: 0,
      holdWreck: false,
      live: false,
    });
  }

  const projGeo = new THREE.CylinderGeometry(0.04, 0.09, 0.7, 6);
  const projMats: Record<WeaponId, THREE.MeshBasicMaterial> = {
    frag: new THREE.MeshBasicMaterial({ color: WEAPONS.frag.color }),
    he: new THREE.MeshBasicMaterial({ color: WEAPONS.he.color }),
    ap: new THREE.MeshBasicMaterial({ color: WEAPONS.ap.color }),
  };
  const pool: Projectile[] = [];
  for (let i = 0; i < 24; i++) {
    const mesh = new THREE.Mesh(projGeo, projMats.he);
    mesh.visible = false;
    scene.add(mesh);
    pool.push({
      active: false,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      life: 0,
      weapon: "he",
      mesh,
    });
  }

  const particles: Array<{
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    life: number;
  }> = [];
  const pGeo = new THREE.SphereGeometry(0.18, 4, 4);
  const pMat = new THREE.MeshBasicMaterial({ color: 0xc4b89a });
  for (let i = 0; i < 56; i++) {
    const mesh = new THREE.Mesh(pGeo, pMat);
    mesh.visible = false;
    scene.add(mesh);
    particles.push({ mesh, vel: new THREE.Vector3(), life: 0 });
  }

  const smokeGeo = new THREE.SphereGeometry(0.65, 6, 6);
  const smokes: Array<{
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    life: number;
    max: number;
  }> = [];
  for (let i = 0; i < 40; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0x5a5c54,
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(smokeGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    smokes.push({ mesh, vel: new THREE.Vector3(), life: 0, max: 1 });
  }

  const debrisGeos = [
    new THREE.BoxGeometry(0.46, 0.1, 0.58),
    new THREE.TetrahedronGeometry(0.3),
    new THREE.BoxGeometry(0.24, 0.24, 0.24),
    new THREE.CylinderGeometry(0.14, 0.16, 0.24, 5),
  ];
  const debrisMats = [
    new THREE.MeshLambertMaterial({ color: 0x4c5538 }),
    new THREE.MeshLambertMaterial({ color: 0x2c2e28 }),
    new THREE.MeshLambertMaterial({ color: 0x6a4e3a }),
    new THREE.MeshLambertMaterial({ color: 0x5c615a }),
    new THREE.MeshLambertMaterial({ color: 0x6b6754 }),
  ];
  const debris: Array<{
    mesh: THREE.Mesh;
    vel: THREE.Vector3;
    spin: THREE.Vector3;
    life: number;
  }> = [];
  for (let i = 0; i < 64; i++) {
    const mesh = new THREE.Mesh(debrisGeos[i % debrisGeos.length], debrisMats[i % debrisMats.length]);
    mesh.visible = false;
    mesh.castShadow = true;
    scene.add(mesh);
    debris.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
  }

  const fireGeo = new THREE.SphereGeometry(1, 12, 10);
  const fireCols = [0xfff1c2, 0xe08932, 0x5a2414];
  const fires: Array<{ mesh: THREE.Mesh; life: number; max: number; grow: number }> = [];
  for (let i = 0; i < 9; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: fireCols[i % 3],
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(fireGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    fires.push({ mesh, life: 0, max: 1, grow: 4 });
  }

  const waveGeo = new THREE.RingGeometry(0.55, 0.85, 28);
  waveGeo.rotateX(-Math.PI / 2);
  const waves: Array<{ mesh: THREE.Mesh; life: number; max: number }> = [];
  for (let i = 0; i < 4; i++) {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd2c4a0,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(waveGeo, mat);
    mesh.visible = false;
    scene.add(mesh);
    waves.push({ mesh, life: 0, max: 1 });
  }

  const flashLight = new THREE.PointLight(0xffc27a, 0, 52, 2);
  scene.add(flashLight);

  let weapon: WeaponId = "he";
  const ammo: Record<WeaponId, number> = {
    frag: WEAPONS.frag.ammo,
    he: WEAPONS.he.ammo,
    ap: WEAPONS.ap.ammo,
  };
  let cooldown = 0;
  let detonateLatch = false;
  let lives = DRONE_LIVES;
  let score = 0;
  let destroyed = 0;
  const events: CombatEvent[] = [];
  let accumulator = 0;
  let trauma = 0;
  let hitstop = 0;
  let simTime = 0;
  const blips: RadarBlip[] = [];
  let impactCommitted = true;
  let pendingImpact: { x: number; y: number; z: number; power: number } | null = null;
  let inboundScratch = new THREE.Vector3();
  let drainMul = 1;
  let mortal = true;

  function drainEvents(): CombatEvent[] {
    const out = events.splice(0, events.length);
    return out;
  }

  function basis() {
    _euler.set(drone.pitch, drone.yaw, drone.roll, "YXZ");
    _quat.setFromEuler(_euler);
    _fwd.set(0, 0, -1).applyQuaternion(_quat);
    _up.set(0, 1, 0).applyQuaternion(_quat);
    _right.set(1, 0, 0).applyQuaternion(_quat);
  }

  function spawnBurst(x: number, y: number, z: number, n: number, power: number) {
    let used = 0;
    for (const p of particles) {
      if (p.life > 0) continue;
      p.life = 0.4 + Math.random() * 0.5;
      p.mesh.visible = true;
      p.mesh.position.set(x, y, z);
      p.vel.set((Math.random() - 0.5) * power, Math.random() * power * 0.85, (Math.random() - 0.5) * power);
      used++;
      if (used >= n) break;
    }
  }

  function spawnSmoke(x: number, y: number, z: number, n: number) {
    let used = 0;
    for (const p of smokes) {
      if (p.life > 0) continue;
      p.max = 1.6 + Math.random() * 2.4;
      p.life = p.max;
      p.mesh.visible = true;
      p.mesh.position.set(x + (Math.random() - 0.5) * 0.8, y, z + (Math.random() - 0.5) * 0.8);
      p.vel.set((Math.random() - 0.5) * 1.1, 1.2 + Math.random() * 1.8, (Math.random() - 0.5) * 1.1);
      p.mesh.scale.setScalar(0.55);
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.38;
      used++;
      if (used >= n) break;
    }
  }

  function spawnDebris(t: Target, n: number, power: number, dir: THREE.Vector3) {
    const tint = DEBRIS_TINT[t.kind];
    let used = 0;
    for (let i = 0; i < debris.length && used < n; i++) {
      const p = debris[(i * 7 + t.id) % debris.length];
      if (p.life > 0) continue;
      p.life = 1.6 + Math.random() * 1.4;
      p.mesh.visible = true;
      p.mesh.material = debrisMats[(tint + used) % debrisMats.length];
      p.mesh.position.set(
        t.pos.x + (Math.random() - 0.5) * t.radius,
        t.pos.y + Math.random() * 1.4,
        t.pos.z + (Math.random() - 0.5) * t.radius,
      );
      p.vel.set(
        (Math.random() - 0.5) * power + dir.x * (4 + Math.random() * 6),
        6 + Math.random() * power * 0.55,
        (Math.random() - 0.5) * power + dir.z * (4 + Math.random() * 6),
      );
      p.spin.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 8);
      p.mesh.scale.setScalar(0.7 + Math.random() * 1.1);
      p.mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      used++;
    }
  }

  function spawnFireball(x: number, y: number, z: number, power: number) {
    let used = 0;
    for (const f of fires) {
      if (f.life > 0) continue;
      f.max = 0.45 + used * 0.18;
      f.life = f.max;
      f.grow = 3.2 + used * 2.4 + power * 1.6;
      f.mesh.visible = true;
      f.mesh.position.set(x, y + 0.5, z);
      f.mesh.scale.setScalar(0.4);
      const mat = f.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.95 - used * 0.18;
      used++;
      if (used >= 3) break;
    }
  }

  function spawnWave(x: number, y: number, z: number) {
    for (const w of waves) {
      if (w.life > 0) continue;
      w.max = 0.7;
      w.life = w.max;
      w.mesh.visible = true;
      w.mesh.position.set(x, y, z);
      w.mesh.scale.setScalar(0.4);
      const mat = w.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.62;
      break;
    }
  }

  function setBeacons(t: Target, on: boolean) {
    t.mesh.traverse((o) => {
      if (o.userData.beacon) o.visible = on;
    });
  }

  function wreckTarget(t: Target) {
    t.wreckTilt = (t.id % 2 === 0 ? 1 : -1) * (0.38 + Math.random() * 0.35);
    t.mesh.rotation.z = t.wreckTilt;
    t.mesh.rotation.x = 0.16;
    t.mesh.scale.y = 0.58;
    setBeacons(t, false);
    spawnSmoke(t.pos.x, t.pos.y + 0.5, t.pos.z, 8);
  }

  function restoreTarget(t: Target) {
    t.alive = true;
    t.hp = t.maxHp;
    t.flash = 0;
    t.smokeAcc = 0;
    t.wreckTilt = 0;
    t.holdWreck = false;
    t.mesh.visible = true;
    t.mesh.scale.set(1, 1, 1);
    t.mesh.rotation.set(0, t.yaw, 0);
    setBeacons(t, true);
    t.mesh.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) {
        o.material.emissive.setHex(0x000000);
      }
    });
  }

  function applyDamage(t: Target, amount: number, src: THREE.Vector3, hold: boolean) {
    if (!t.alive) return 0;
    t.hp -= amount;
    t.flash = 0.18;
    const kill = t.hp <= 0;
    if (kill) {
      t.alive = false;
      t.hp = 0;
      destroyed += 1;
      score += t.score;
      if (hold) t.holdWreck = true;
      else {
        wreckTarget(t);
        spawnBurst(t.pos.x, t.pos.y + 0.8, t.pos.z, 14, 18);
        events.push({ type: "explode", x: t.pos.x, y: t.pos.y, z: t.pos.z, size: 1.2 });
      }
    }
    events.push({
      type: "hit",
      damage: Math.round(amount),
      kill,
      label: t.label,
      x: src.x,
      y: src.y,
      z: src.z,
    });
    return amount;
  }

  function splashAt(
    x: number,
    y: number,
    z: number,
    weaponId: WeaponId | "kami",
    hold: boolean,
    skipId: number | null,
  ) {
    const def =
      weaponId === "kami"
        ? { splash: KAMIKAZE.splash, base: KAMIKAZE.baseDamage, vs: KAMIKAZE.vs }
        : { splash: WEAPONS[weaponId].splash, base: WEAPONS[weaponId].baseDamage, vs: WEAPONS[weaponId].vs };
    const killed: Target[] = [];
    let primaryDmg = 0;
    for (const t of targets) {
      if (!t.alive && !t.holdWreck) continue;
      if (skipId !== null && t.id === skipId) continue;
      if (!t.alive) continue;
      const d = Math.hypot(t.pos.x - x, t.pos.y - y, t.pos.z - z);
      if (d > def.splash + t.radius) continue;
      const fall = 1 - d / (def.splash + t.radius);
      const dmg = def.base * def.vs[t.armor] * (0.45 + 0.55 * fall);
      applyDamage(t, dmg, t.pos, hold);
      if (!t.alive) killed.push(t);
      if (primaryDmg === 0) primaryDmg = dmg;
    }
    return killed;
  }

  function emitKillcam(
    t: Target,
    damage: number,
    dir: THREE.Vector3,
    weaponId: WeaponId | "kami",
    kamikaze: boolean,
    secondary: number,
  ) {
    impactCommitted = false;
    pendingImpact = { x: t.pos.x, y: t.pos.y + 0.6, z: t.pos.z, power: kamikaze ? 1.6 : 1.15 };
    inboundScratch.copy(dir);
    if (inboundScratch.lengthSq() < 0.0001) inboundScratch.set(0, 0, -1);
    inboundScratch.normalize();
    events.push({
      type: "killcam",
      spec: {
        x: t.pos.x,
        y: t.pos.y + 0.4,
        z: t.pos.z,
        ix: inboundScratch.x,
        iy: inboundScratch.y,
        iz: inboundScratch.z,
        damage: Math.round(damage),
        kill: true,
        label: t.label,
        armor: t.armor,
        kind: t.kind,
        hp: 0,
        maxHp: t.maxHp,
        weapon: weaponId,
        kamikaze,
        secondary,
        groundY: world.heightAt(t.pos.x, t.pos.z),
      },
    });
  }

  function commitImpact() {
    if (impactCommitted) return;
    impactCommitted = true;
    const hit = pendingImpact;
    pendingImpact = null;
    const x = hit?.x ?? drone.pos.x;
    const y = hit?.y ?? drone.pos.y;
    const z = hit?.z ?? drone.pos.z;
    const power = hit?.power ?? 1;
    flashLight.position.set(x, y + 1.1, z);
    flashLight.intensity = 42 * power;
    spawnFireball(x, y, z, power);
    spawnWave(x, world.heightAt(x, z) + 0.14, z);
    spawnBurst(x, y + 0.4, z, 18, 20 * power);
    spawnSmoke(x, y, z, 12);
    for (const t of targets) {
      if (!t.holdWreck) continue;
      t.holdWreck = false;
      wreckTarget(t);
      spawnDebris(t, 16, 16 * power, inboundScratch);
    }
    events.push({ type: "explode", x, y, z, size: 1.5 * power });
    trauma = Math.min(1, trauma + 0.85);
  }

  function orientRocket(p: Projectile) {
    if (p.vel.lengthSq() < 1e-4) return;
    _tmp.copy(p.vel).normalize();
    p.mesh.quaternion.setFromUnitVectors(_yAxis, _tmp);
  }

  function fire(camera: THREE.Camera) {
    const w = WEAPONS[weapon];
    if (ammo[weapon] <= 0 || cooldown > 0) return;
    ammo[weapon] -= 1;
    cooldown = 1 / w.fireRate;
    basis();
    let p: Projectile | undefined;
    for (const it of pool) if (!it.active) { p = it; break; }
    if (!p) return;
    p.active = true;
    p.weapon = weapon;
    p.life = 2.6;
    p.mesh.material = projMats[weapon];
    p.mesh.visible = true;
    camera.getWorldDirection(_tmp);
    p.pos.copy(drone.pos).addScaledVector(_tmp, 1.2);
    p.vel.copy(_tmp).multiplyScalar(w.speed).addScaledVector(drone.vel, 0.25);
    p.mesh.position.copy(p.pos);
    orientRocket(p);
    spawnBurst(p.pos.x, p.pos.y, p.pos.z, 3, 4);
    events.push({ type: "shot", weapon });
    trauma = Math.min(1, trauma + 0.18);
  }

  function presentCrash(kamikaze: boolean) {
    spawnBurst(drone.pos.x, drone.pos.y, drone.pos.z, 20, kamikaze ? 28 : 14);
    spawnSmoke(drone.pos.x, drone.pos.y, drone.pos.z, 6);
    spawnFireball(drone.pos.x, drone.pos.y, drone.pos.z, kamikaze ? 1.4 : 0.8);
    events.push({
      type: "explode",
      x: drone.pos.x,
      y: drone.pos.y,
      z: drone.pos.z,
      size: kamikaze ? 2 : 1,
    });
  }

  function crash(kamikaze: boolean) {
    if (!drone.alive) return;
    drone.alive = false;
    if (mortal) lives = Math.max(0, lives - 1);
    trauma = 1;
    events.push({ type: "crash", kamikaze });

    if (kamikaze) {
      basis();
      inboundScratch.copy(drone.vel.lengthSq() > 4 ? drone.vel : _fwd);
      const nearby = targets
        .filter((t) => t.alive && t.pos.distanceTo(drone.pos) < KAMIKAZE.splash + t.radius + 2)
        .sort((a, b) => a.pos.distanceTo(drone.pos) - b.pos.distanceTo(drone.pos));
      const primary = nearby[0] ?? null;
      if (primary) {
        const dmg = KAMIKAZE.baseDamage * KAMIKAZE.vs[primary.armor];
        applyDamage(primary, dmg, primary.pos, true);
        const extra = splashAt(drone.pos.x, drone.pos.y, drone.pos.z, "kami", true, primary.id);
        emitKillcam(primary, dmg, inboundScratch, "kami", true, extra.length);
      } else {
        splashAt(drone.pos.x, drone.pos.y, drone.pos.z, "kami", false, null);
        presentCrash(true);
      }
    } else {
      presentCrash(false);
    }
  }

  function respawn() {
    drone.pos.copy(world.spawnPad);
    drone.pos.y += 6.4;
    drone.vel.set(0, 0, 0);
    drone.yaw = -1.15;
    drone.pitch = 0.08;
    drone.roll = 0;
    drone.throttle = HOVER;
    drone.battery = BATTERY_MAX;
    drone.alive = true;
    drone.invuln = 2.2;
    ammo.frag = WEAPONS.frag.ammo;
    ammo.he = WEAPONS.he.ammo;
    ammo.ap = WEAPONS.ap.ammo;
  }

  function buildingHit(x: number, y: number, z: number): boolean {
    for (const b of world.buildings) {
      const d = Math.hypot(x - b.x, z - b.z);
      if (d < b.r + 0.6 && y < world.heightAt(b.x, b.z) + b.h + 0.4) return true;
    }
    return false;
  }

  function step(dt: number, actions: Actions, mouse: { dx: number; dy: number }, invertY: boolean, flying: boolean) {
    if (hitstop > 0) {
      hitstop -= dt;
      return;
    }
    if (!flying || !drone.alive) {
      drone.throttle = expDamp(drone.throttle, 0, 3, dt);
      return;
    }

    if (actions.weaponSlot !== null) weapon = WEAPON_ORDER[actions.weaponSlot];

    const lookX = mouse.dx * 0.0022;
    const lookY = mouse.dy * 0.0020 * (invertY ? 1 : -1);
    drone.yaw += actions.yaw * YAW_RATE * dt - lookX;
    drone.yaw += drone.roll * 0.85 * dt;
    const autoPitch = -actions.throttle * NOSE_DOWN;
    const pitchTarget = actions.pitch * MAX_PITCH + autoPitch;
    const rollTarget = actions.roll * MAX_ROLL;
    drone.pitch = expDamp(drone.pitch, pitchTarget, 7, dt) + lookY;
    drone.pitch = clamp(drone.pitch, -1.15, 1.15);
    drone.roll = expDamp(drone.roll, rollTarget, 8, dt);

    const thrTarget = clamp(HOVER + actions.throttle * 0.22 + (actions.boost ? 0.28 : 0), 0.08, 1);
    drone.throttle = expDamp(drone.throttle, thrTarget, 6, dt);

    basis();
    const lift = drone.throttle * THRUST;
    drone.vel.addScaledVector(_up, lift * dt);
    drone.vel.y -= GRAVITY * dt;
    const hx = -Math.sin(drone.yaw);
    const hz = -Math.cos(drone.yaw);
    drone.vel.x += hx * actions.throttle * FWD_THRUST * dt;
    drone.vel.z += hz * actions.throttle * FWD_THRUST * dt;
    drone.vel.multiplyScalar(Math.exp(-1.55 * dt));
    if (Math.abs(actions.throttle) < 0.08 && !actions.boost && Math.abs(actions.pitch) < 0.08) {
      drone.vel.y *= Math.exp(-3.2 * dt);
    }
    drone.pos.addScaledVector(drone.vel, dt);

    const half = WORLD_SIZE * 0.48;
    drone.pos.x = clamp(drone.pos.x, -half, half);
    drone.pos.z = clamp(drone.pos.z, -half, half);

    const ground = world.heightAt(drone.pos.x, drone.pos.z) + 0.55;
    if (drone.pos.y < ground) {
      drone.pos.y = ground;
      const spd = drone.vel.length();
      if (spd > 12 && drone.invuln <= 0) crash(spd > 18);
      else {
        drone.vel.y = Math.max(0, drone.vel.y);
        drone.vel.multiplyScalar(0.35);
      }
    }
    if (buildingHit(drone.pos.x, drone.pos.y, drone.pos.z)) {
      const spd = drone.vel.length();
      if (drone.invuln <= 0 && spd > 15) crash(spd > 20);
      else {
        drone.vel.x *= -0.45;
        drone.vel.z *= -0.45;
        drone.vel.y = Math.max(2.2, drone.vel.y);
        drone.pos.y += 0.35;
      }
    }

    drone.battery = clamp(
      drone.battery - (0.5 + drone.throttle * 0.85 + (actions.boost ? 2.8 : 0)) * dt * drainMul,
      0,
      100,
    );
    if (drone.battery <= 0 && drone.invuln <= 0) crash(false);
    drone.invuln = Math.max(0, drone.invuln - dt);

    cooldown = Math.max(0, cooldown - dt);
    if (actions.fire) fireDummy();
    if (actions.detonate && !detonateLatch) crash(true);
    detonateLatch = actions.detonate;

    trauma = Math.max(0, trauma - dt * 1.6);

    for (const t of targets) {
      if (t.alive) continue;
      if (t.holdWreck) continue;
      t.smokeAcc += dt;
      if (t.smokeAcc > 0.28) {
        t.smokeAcc = 0;
        spawnSmoke(t.pos.x, t.pos.y + 0.45, t.pos.z, 1);
      }
    }
  }

  let shootCam: THREE.Camera | null = null;
  function fireDummy() {
    if (shootCam) fire(shootCam);
  }

  function updateProjectiles(dt: number) {
    for (const p of pool) {
      if (!p.active) continue;
      p.pos.addScaledVector(p.vel, dt);
      p.vel.y -= 4 * dt;
      p.life -= dt;
      p.mesh.position.copy(p.pos);
      orientRocket(p);
      const ground = world.heightAt(p.pos.x, p.pos.z);
      let hit = p.pos.y < ground || p.life <= 0 || buildingHit(p.pos.x, p.pos.y, p.pos.z);
      let primary: Target | null = null;
      if (!hit) {
        for (const t of targets) {
          if (!t.alive) continue;
          if (p.pos.distanceTo(t.pos) < t.radius + 0.4) {
            primary = t;
            hit = true;
            break;
          }
        }
      }
      if (primary) {
        const w = WEAPONS[p.weapon];
        const dmg = w.baseDamage * w.vs[primary.armor];
        const willKill = primary.hp - dmg <= 0;
        applyDamage(primary, dmg, primary.pos, willKill);
        const extra = splashAt(p.pos.x, p.pos.y, p.pos.z, p.weapon, willKill, primary.id);
        const anyKill = !primary.alive || extra.length > 0;
        if (anyKill) {
          const focus = !primary.alive ? primary : extra[0];
          const focusDmg = !primary.alive ? dmg : w.baseDamage * w.vs[focus.armor];
          emitKillcam(focus, focusDmg, p.vel, p.weapon, false, extra.filter((t) => t !== focus).length);
        } else {
          spawnBurst(p.pos.x, p.pos.y, p.pos.z, 6, 8);
        }
        trauma = Math.min(1, trauma + 0.28);
        hitstop = 0.045;
      } else if (hit && p.pos.y < ground + 0.5) {
        const extra = splashAt(p.pos.x, ground, p.pos.z, p.weapon, false, null);
        spawnBurst(p.pos.x, p.pos.y, p.pos.z, 6, 8);
        if (extra.length) {
          emitKillcam(extra[0], WEAPONS[p.weapon].baseDamage * WEAPONS[p.weapon].vs[extra[0].armor], p.vel, p.weapon, false, extra.length - 1);
        }
      }
      if (hit) {
        p.active = false;
        p.mesh.visible = false;
      }
    }
  }

  function updateVisuals(dt: number, camera: THREE.Camera, shakeOn: boolean) {
    simTime += dt;
    flashLight.intensity = Math.max(0, flashLight.intensity - dt * 70);

    for (const t of targets) {
      if (t.flash > 0) {
        t.flash -= dt;
        t.mesh.traverse((o) => {
          if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) {
            o.material.emissive.setHex(t.flash > 0 ? 0x665544 : 0x000000);
          }
        });
      }
      if (t.alive) {
        const pulse = 0.28 + 0.16 * Math.sin(simTime * 3.4 + t.id);
        t.mesh.traverse((o) => {
          if (o.userData.beacon && o instanceof THREE.Mesh) {
            o.visible = true;
            const mat = o.material as THREE.MeshBasicMaterial;
            if (mat.opacity !== undefined) mat.opacity = pulse;
          }
        });
      }
    }
    for (const p of particles) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-2 * dt));
      p.vel.y -= 8 * dt;
      const s = Math.max(0.1, p.life * 2);
      p.mesh.scale.setScalar(s);
      if (p.life <= 0) p.mesh.visible = false;
    }
    for (const p of smokes) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-0.55 * dt));
      p.vel.y += 0.55 * dt;
      const u = 1 - p.life / p.max;
      p.mesh.scale.setScalar(0.7 + u * 2.4);
      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.36 * (1 - u);
      if (p.life <= 0) p.mesh.visible = false;
    }
    for (const p of debris) {
      if (p.life <= 0) continue;
      p.life -= dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.vel.multiplyScalar(Math.exp(-1.15 * dt));
      p.vel.y -= 16 * dt;
      p.mesh.rotation.x += p.spin.x * dt;
      p.mesh.rotation.y += p.spin.y * dt;
      p.mesh.rotation.z += p.spin.z * dt;
      const gy = world.heightAt(p.mesh.position.x, p.mesh.position.z) + 0.12;
      if (p.mesh.position.y < gy) {
        p.mesh.position.y = gy;
        p.vel.y *= -0.32;
        p.vel.x *= 0.55;
        p.vel.z *= 0.55;
        p.spin.multiplyScalar(0.6);
      }
      if (p.life <= 0) p.mesh.visible = false;
    }
    for (const f of fires) {
      if (f.life <= 0) continue;
      f.life -= dt;
      const u = 1 - f.life / f.max;
      const s = 0.5 + u * f.grow;
      f.mesh.scale.setScalar(s);
      const mat = f.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (1 - u) * 0.85;
      f.mesh.position.y += dt * 1.8;
      if (f.life <= 0) f.mesh.visible = false;
    }
    for (const w of waves) {
      if (w.life <= 0) continue;
      w.life -= dt;
      const u = 1 - w.life / w.max;
      w.mesh.scale.setScalar(0.6 + u * 18);
      const mat = w.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.55 * (1 - u);
      if (w.life <= 0) w.mesh.visible = false;
    }

    _euler.set(drone.pitch, drone.yaw, drone.roll, "YXZ");
    camera.quaternion.setFromEuler(_euler);
    camera.position.copy(drone.pos);
    const shake = trauma * trauma;
    if (shakeOn && shake > 0.002) {
      camera.position.x += (Math.random() - 0.5) * shake * 0.7;
      camera.position.y += (Math.random() - 0.5) * shake * 0.55;
      camera.position.z += (Math.random() - 0.5) * shake * 0.7;
    }
    droneBodyGroup.position.copy(drone.pos);
    droneBodyGroup.quaternion.copy(camera.quaternion);
  }

  function pickLock(camera: THREE.Camera, w: number, h: number) {
    _ray.setFromCamera(_ndc, camera);
    let best: Target | null = null;
    let bestDot = 0.92;
    camera.getWorldDirection(_tmp);
    for (const t of targets) {
      if (!t.alive) continue;
      _tmp2.copy(t.pos).sub(camera.position);
      const dist = _tmp2.length();
      if (dist < 2 || dist > 220) continue;
      _tmp2.multiplyScalar(1 / dist);
      const dot = _tmp2.dot(_tmp);
      if (dot > bestDot) {
        bestDot = dot;
        best = t;
      }
    }
    if (!best) return null;
    _tmp.copy(best.pos).project(camera);
    if (_tmp.z > 1) return null;
    const wpn = WEAPONS[weapon];
    return {
      label: best.label,
      kind: best.kind,
      armor: best.armor,
      hp: best.hp,
      maxHp: best.maxHp,
      dist: camera.position.distanceTo(best.pos),
      screenX: clamp((_tmp.x * 0.5 + 0.5) * w, 72, w - 72),
      screenY: clamp((-_tmp.y * 0.5 + 0.5) * h, 64, h - 140),
      expected: expectedDamage(wpn.baseDamage, wpn.vs, best.armor),
      weapon,
      armorLabel: ARMOR_LABEL[best.armor],
    };
  }

  function refreshBlips() {
    blips.length = 0;
    for (const t of targets) {
      if (!t.alive && !t.live) continue;
      blips.push({ id: t.id, x: t.pos.x, z: t.pos.z, armor: t.armor, alive: t.alive });
    }
    return blips;
  }

  function tick(
    dtRaw: number,
    actions: Actions,
    mouse: { dx: number; dy: number },
    invertY: boolean,
    flying: boolean,
    camera: THREE.Camera,
    shakeOn: boolean,
  ) {
    shootCam = camera;
    const dt = Math.min(dtRaw, 0.1);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED && steps < 5) {
      step(FIXED, actions, steps === 0 ? mouse : { dx: 0, dy: 0 }, invertY, flying);
      if (flying && drone.alive) updateProjectiles(FIXED);
      accumulator -= FIXED;
      steps++;
    }
    updateVisuals(dt, camera, shakeOn);
  }

  function hideProjectiles(hide: boolean) {
    for (const p of pool) {
      if (hide) p.mesh.visible = false;
      else if (p.active) p.mesh.visible = true;
    }
  }

  function spawnLive(kind: TargetKind, x: number, z: number, yaw: number): number {
    const def = TARGETS[kind];
    const mesh = createTargetMesh(kind);
    const y = world.heightAt(x, z);
    mesh.position.set(x, y, z);
    mesh.rotation.y = yaw;
    scene.add(mesh);
    const t: Target = {
      id: idSeq++,
      kind,
      armor: def.armor,
      hp: def.hp,
      maxHp: def.hp,
      label: def.label,
      score: def.score,
      radius: def.radius,
      pos: new THREE.Vector3(x, y + def.height * 0.45, z),
      yaw,
      alive: true,
      mesh,
      flash: 0,
      wreckTilt: 0,
      smokeAcc: 0,
      holdWreck: false,
      live: true,
    };
    targets.push(t);
    return t.id;
  }

  function clearLive() {
    for (let i = targets.length - 1; i >= 0; i--) {
      if (!targets[i].live) continue;
      scene.remove(targets[i].mesh);
      targets.splice(i, 1);
    }
  }

  function syncLive(id: number, x: number, y: number, z: number, yaw: number) {
    const t = targets.find((it) => it.id === id);
    if (!t || !t.alive) return;
    const def = TARGETS[t.kind];
    t.pos.set(x, y + def.height * 0.45, z);
    t.yaw = yaw;
    t.mesh.position.set(x, y, z);
    t.mesh.rotation.y = yaw + Math.PI;
  }

  function setStaticIdle(idle: boolean) {
    for (const t of targets) {
      if (t.live) continue;
      if (idle) {
        t.alive = false;
        t.holdWreck = false;
        t.mesh.visible = false;
        setBeacons(t, false);
      } else restoreTarget(t);
    }
  }

  function getTarget(id: number) {
    return targets.find((it) => it.id === id);
  }

  function setRules(opts: { mortal?: boolean; drainMul?: number }) {
    if (opts.mortal !== undefined) mortal = opts.mortal;
    if (opts.drainMul !== undefined) drainMul = opts.drainMul;
  }

  function resetMatch() {
    lives = DRONE_LIVES;
    score = 0;
    destroyed = 0;
    weapon = "he";
    impactCommitted = true;
    pendingImpact = null;
    flashLight.intensity = 0;
    clearLive();
    for (const t of targets) restoreTarget(t);
    for (const p of pool) {
      p.active = false;
      p.mesh.visible = false;
    }
    for (const p of smokes) {
      p.life = 0;
      p.mesh.visible = false;
    }
    for (const p of particles) {
      p.life = 0;
      p.mesh.visible = false;
    }
    for (const p of debris) {
      p.life = 0;
      p.mesh.visible = false;
    }
    for (const f of fires) {
      f.life = 0;
      f.mesh.visible = false;
    }
    for (const w of waves) {
      w.life = 0;
      w.mesh.visible = false;
    }
    respawn();
  }

  function debugKillcam(): KillcamSpec | null {
    const t = targets.find((x) => x.alive);
    if (!t) return null;
    const dmg = t.maxHp;
    applyDamage(t, dmg, t.pos, true);
    inboundScratch.set(0.55, -0.12, -0.82).normalize();
    emitKillcam(t, dmg, inboundScratch, weapon, false, 0);
    const ev = events.find((e) => e.type === "killcam");
    return ev && ev.type === "killcam" ? ev.spec : null;
  }

  return {
    drone,
    targets,
    tick,
    drainEvents,
    pickLock,
    respawn,
    resetMatch,
    crash,
    commitImpact,
    hideProjectiles,
    debugKillcam,
    spawnLive,
    clearLive,
    syncLive,
    setStaticIdle,
    getTarget,
    setRules,
    puff: (x: number, y: number, z: number) => spawnSmoke(x, y, z, 1),
    boomAt: (x: number, y: number, z: number, power = 1) => {
      spawnBurst(x, y, z, 14, 16 * power);
      spawnSmoke(x, y, z, 8);
      spawnFireball(x, y, z, power);
      spawnWave(x, world.heightAt(x, z) + 0.12, z);
      flashLight.position.set(x, y + 1, z);
      flashLight.intensity = 32 * power;
    },
    setTargetBeacons: (on: boolean) => {
      for (const t of targets) setBeacons(t, on && t.alive);
    },
    getBlips: refreshBlips,
    get weapon() {
      return weapon;
    },
    setWeapon: (id: WeaponId) => {
      weapon = id;
    },
    ammo,
    get lives() {
      return lives;
    },
    get score() {
      return score;
    },
    get destroyed() {
      return destroyed;
    },
    get total() {
      return targets.length;
    },
    get trauma() {
      return trauma;
    },
    getSpeed: () => drone.vel.length(),
    getYaw: () => drone.yaw,
    dispose: () => {
      scene.remove(droneBodyGroup);
      scene.remove(flashLight);
      for (const t of targets) scene.remove(t.mesh);
      for (const p of pool) scene.remove(p.mesh);
      for (const p of particles) scene.remove(p.mesh);
      for (const p of smokes) {
        scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
      }
      for (const p of debris) scene.remove(p.mesh);
      for (const f of fires) {
        scene.remove(f.mesh);
        (f.mesh.material as THREE.Material).dispose();
      }
      for (const w of waves) {
        scene.remove(w.mesh);
        (w.mesh.material as THREE.Material).dispose();
      }
      projGeo.dispose();
      pGeo.dispose();
      pMat.dispose();
      smokeGeo.dispose();
      fireGeo.dispose();
      waveGeo.dispose();
      for (const g of debrisGeos) g.dispose();
      for (const m of debrisMats) m.dispose();
      for (const m of Object.values(projMats)) m.dispose();
    },
  };
}

export type Sim = ReturnType<typeof createSim>;
