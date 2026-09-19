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
      p.life = 0.35 + Math.random() * 0.4;
      p.mesh.visible = true;
      p.mesh.position.set(x, y, z);
      p.vel.set((Math.random() - 0.5) * power, Math.random() * power * 0.7, (Math.random() - 0.5) * power);
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
    t.mesh.visible = true;
    t.mesh.scale.set(1, 1, 1);
    t.mesh.rotation.set(0, t.yaw, 0);
    setBeacons(t, true);
  }

  function applyDamage(t: Target, amount: number, src: THREE.Vector3) {
    if (!t.alive) return;
    t.hp -= amount;
    t.flash = 0.18;
    const kill = t.hp <= 0;
    if (kill) {
      t.alive = false;
      t.hp = 0;
      destroyed += 1;
      score += t.score;
      wreckTarget(t);
      spawnBurst(t.pos.x, t.pos.y + 0.8, t.pos.z, 14, 18);
      events.push({ type: "explode", x: t.pos.x, y: t.pos.y, z: t.pos.z, size: 1.2 });
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
  }

  function splashAt(x: number, y: number, z: number, weaponId: WeaponId | "kami") {
    const def =
      weaponId === "kami"
        ? { splash: KAMIKAZE.splash, base: KAMIKAZE.baseDamage, vs: KAMIKAZE.vs }
        : { splash: WEAPONS[weaponId].splash, base: WEAPONS[weaponId].baseDamage, vs: WEAPONS[weaponId].vs };
    for (const t of targets) {
      if (!t.alive) continue;
      const d = Math.hypot(t.pos.x - x, t.pos.y - y, t.pos.z - z);
      if (d > def.splash + t.radius) continue;
      const fall = 1 - d / (def.splash + t.radius);
      const dmg = def.base * def.vs[t.armor] * (0.45 + 0.55 * fall);
      applyDamage(t, dmg, t.pos);
    }
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

  function crash(kamikaze: boolean) {
    if (!drone.alive) return;
    drone.alive = false;
    spawnBurst(drone.pos.x, drone.pos.y, drone.pos.z, 20, kamikaze ? 28 : 14);
    spawnSmoke(drone.pos.x, drone.pos.y, drone.pos.z, 6);
    events.push({
      type: "explode",
      x: drone.pos.x,
      y: drone.pos.y,
      z: drone.pos.z,
      size: kamikaze ? 2 : 1,
    });
    if (kamikaze) splashAt(drone.pos.x, drone.pos.y, drone.pos.z, "kami");
    events.push({ type: "crash", kamikaze });
    trauma = 1;
    lives = Math.max(0, lives - 1);
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
      drone.battery - (0.5 + drone.throttle * 0.85 + (actions.boost ? 2.8 : 0)) * dt,
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
      if (!hit) {
        for (const t of targets) {
          if (!t.alive) continue;
          if (p.pos.distanceTo(t.pos) < t.radius + 0.4) {
            const w = WEAPONS[p.weapon];
            applyDamage(t, w.baseDamage * w.vs[t.armor], t.pos);
            splashAt(p.pos.x, p.pos.y, p.pos.z, p.weapon);
            hit = true;
            trauma = Math.min(1, trauma + 0.28);
            hitstop = 0.045;
            break;
          }
        }
      } else if (p.pos.y < ground + 0.5) {
        splashAt(p.pos.x, ground, p.pos.z, p.weapon);
      }
      if (hit) {
        p.active = false;
        p.mesh.visible = false;
        spawnBurst(p.pos.x, p.pos.y, p.pos.z, 6, 8);
      }
    }
  }

  function updateVisuals(dt: number, camera: THREE.Camera, shakeOn: boolean) {
    simTime += dt;
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

  function resetMatch() {
    lives = DRONE_LIVES;
    score = 0;
    destroyed = 0;
    weapon = "he";
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
    respawn();
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
      for (const t of targets) scene.remove(t.mesh);
      for (const p of pool) scene.remove(p.mesh);
      for (const p of particles) scene.remove(p.mesh);
      for (const p of smokes) {
        scene.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
      }
      projGeo.dispose();
      pGeo.dispose();
      pMat.dispose();
      smokeGeo.dispose();
      for (const m of Object.values(projMats)) m.dispose();
    },
  };
}

export type Sim = ReturnType<typeof createSim>;
