import * as THREE from "three";
import { EXTRACTION, GROUND_START, WORLD_SIZE, type GroundUnit } from "./catalog";
import type { Actions } from "./input";
import { clamp, expDamp } from "./math";
import type { WorldApi } from "./world";
import { createDroneBody, createTargetMesh } from "./world";

export type GroundEvent =
  | { type: "spotted" }
  | { type: "lock" }
  | { type: "dive" }
  | { type: "boom"; x: number; y: number; z: number }
  | { type: "hit" }
  | { type: "extract" }
  | { type: "step" };

type HunterState = "patrol" | "search" | "dive" | "dead";

type Hunter = {
  id: number;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pitch: number;
  state: HunterState;
  wp: number;
  lock: number;
  deadT: number;
  mesh: THREE.Group;
};

const WAYPOINTS: Array<[number, number, number]> = [
  [18, 20, -22],
  [48, 22, -36],
  [-8, 18, -32],
  [36, 24, -10],
  [64, 21, -42],
  [8, 19, -38],
];

type Anim = {
  legL?: THREE.Object3D;
  legR?: THREE.Object3D;
  armL?: THREE.Object3D;
  armR?: THREE.Object3D;
  wheels?: THREE.Mesh[];
};

export function createGround(scene: THREE.Scene, world: WorldApi) {
  const playerGrp = new THREE.Group();
  scene.add(playerGrp);
  let unit: GroundUnit = "soldier";
  let soldierMesh = createTargetMesh("infantry");
  let jeepMesh = createTargetMesh("jeep");
  soldierMesh.traverse((o) => {
    if (o.userData.beacon) o.visible = false;
  });
  jeepMesh.traverse((o) => {
    if (o.userData.beacon) o.visible = false;
  });
  playerGrp.add(soldierMesh, jeepMesh);
  jeepMesh.visible = false;

  const player = {
    pos: new THREE.Vector3(GROUND_START.x, 0, GROUND_START.z),
    yaw: Math.atan2(-(EXTRACTION.x - GROUND_START.x), -(EXTRACTION.z - GROUND_START.z)),
    speed: 0,
    crouch: false,
    sprint: false,
    alive: true,
    detect: 0,
    locked: false,
    spottedOnce: false,
  };

  let lookYaw = 0;
  let lookPitch = 0.38;
  const camPos = new THREE.Vector3();
  const camTgt = new THREE.Vector3();
  const camPosS = new THREE.Vector3();
  const camTgtS = new THREE.Vector3();
  let camReady = false;

  const hunters: Hunter[] = [];
  for (let i = 0; i < 3; i++) {
    const mesh = createDroneBody();
    mesh.scale.setScalar(3.4);
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshPhongMaterial) {
        if (o.material.color.getHex() === 0xb7c4a8) o.material.color.setHex(0xc45c4a);
      }
    });
    scene.add(mesh);
    const wp = WAYPOINTS[i % WAYPOINTS.length];
    hunters.push({
      id: i,
      pos: new THREE.Vector3(wp[0], wp[1], wp[2]),
      vel: new THREE.Vector3(),
      yaw: 0,
      pitch: 0.15,
      state: "patrol",
      wp: i,
      lock: 0,
      deadT: 0,
      mesh,
    });
  }

  const goal = new THREE.Group();
  const ringGeo = new THREE.RingGeometry(EXTRACTION.r - 0.6, EXTRACTION.r, 40);
  ringGeo.rotateX(-Math.PI / 2);
  const ringMat = new THREE.MeshBasicMaterial({
    color: 0x7d9a6e,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
  });
  const ring = new THREE.Mesh(ringGeo, ringMat);
  goal.add(ring);
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.1, 6.2, 6),
    new THREE.MeshLambertMaterial({ color: 0x3e403a }),
  );
  pole.position.y = 3.1;
  goal.add(pole);
  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(2.4, 1.3),
    new THREE.MeshBasicMaterial({ color: 0x7d9a6e, side: THREE.DoubleSide }),
  );
  flag.position.set(1.15, 5.4, 0);
  goal.add(flag);
  scene.add(goal);

  const lamp = new THREE.SpotLight(0xffe2b0, 0, 44, 0.4, 0.5, 1.05);
  lamp.position.set(0, 1.2, 1.55);
  const lampTgt = new THREE.Object3D();
  lampTgt.position.set(0, 0.15, 14);
  playerGrp.add(lamp, lampTgt);
  lamp.target = lampTgt;

  const DUST_N = 72;
  const dustPos = new Float32Array(DUST_N * 3);
  const dustLife = new Float32Array(DUST_N);
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    color: 0xc2b08a,
    size: 0.62,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);
  for (let i = 0; i < DUST_N; i++) dustPos[i * 3 + 1] = -40;

  type Trail = { line: THREE.Line; pos: Float32Array; n: number };
  const trails: Trail[] = hunters.map(() => {
    const n = 22;
    const pos = new Float32Array(n * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xc45c4a,
      transparent: true,
      opacity: 0.55,
    });
    const line = new THREE.Line(geo, mat);
    scene.add(line);
    return { line, pos, n };
  });

  let nightMode = false;
  let bodyRoll = 0;
  let stepAcc = 0;
  let dustAcc = 0;

  let active = false;
  let time = 0;
  let score = 0;
  const events: GroundEvent[] = [];
  const _fwd = new THREE.Vector3();
  const _look = new THREE.Vector3();
  let lastWarn = 0;

  function drain(): GroundEvent[] {
    return events.splice(0, events.length);
  }

  function setVisible(on: boolean) {
    active = on;
    playerGrp.visible = on;
    goal.visible = on;
    dust.visible = on;
    lamp.intensity = on && nightMode ? (unit === "jeep" ? 2.7 : 0.35) : 0;
    for (const h of hunters) h.mesh.visible = on && h.state !== "dead";
    for (let i = 0; i < trails.length; i++) {
      trails[i].line.visible = on && hunters[i].state !== "dead";
    }
  }

  function placeGoal() {
    const y = world.heightAt(EXTRACTION.x, EXTRACTION.z);
    goal.position.set(EXTRACTION.x, y + 0.05, EXTRACTION.z);
  }

  function snapPlayer() {
    player.pos.set(GROUND_START.x, 0, GROUND_START.z);
    player.pos.y = world.heightAt(player.pos.x, player.pos.z);
    player.yaw = Math.atan2(-(EXTRACTION.x - GROUND_START.x), -(EXTRACTION.z - GROUND_START.z));
    player.speed = 0;
    player.crouch = false;
    player.sprint = false;
    player.alive = true;
    player.detect = 0;
    player.locked = false;
    player.spottedOnce = false;
    lookYaw = 0;
    lookPitch = 0.38;
    camReady = false;
  }

  function reset(next: GroundUnit) {
    unit = next;
    soldierMesh.visible = next === "soldier";
    jeepMesh.visible = next === "jeep";
    snapPlayer();
    time = 0;
    score = 0;
    placeGoal();
    for (let i = 0; i < hunters.length; i++) {
      const h = hunters[i];
      const wp = WAYPOINTS[i % WAYPOINTS.length];
      h.pos.set(wp[0], wp[1], wp[2]);
      h.vel.set(0, 0, 0);
      h.state = "patrol";
      h.wp = i;
      h.lock = 0;
      h.deadT = 0;
      h.mesh.visible = active;
    }
    setVisible(true);
  }

  function los(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      const z = az + (bz - az) * t;
      for (const b of world.buildings) {
        if (Math.hypot(x - b.x, z - b.z) < b.r && y < world.heightAt(b.x, b.z) + b.h) return false;
      }
    }
    return true;
  }

  function collide(rad: number) {
    for (const o of world.obstacles) {
      const d = Math.hypot(player.pos.x - o.x, player.pos.z - o.z);
      if (d < rad + o.r) {
        const nx = (player.pos.x - o.x) / (d || 1);
        const nz = (player.pos.z - o.z) / (d || 1);
        player.pos.x = o.x + nx * (rad + o.r);
        player.pos.z = o.z + nz * (rad + o.r);
        player.speed *= 0.45;
      }
    }
  }

  function movePlayer(dt: number, actions: Actions) {
    const jeep = unit === "jeep";
    player.sprint = !jeep && (actions.boost || actions.fire) && !player.crouch;
    player.crouch = !jeep && actions.crouch;
    const surf = world.surfaceAt(player.pos.x, player.pos.z);
    const mul = surf === "road" ? 1.16 : surf === "field" ? (jeep ? 0.7 : 0.78) : surf === "water" ? 0.52 : 1;
    const max = (jeep ? (actions.boost ? 21 : 16.5) : player.crouch ? 2.6 : player.sprint ? 8.2 : 5.1) * mul;
    const want = actions.throttle * max;
    player.speed = expDamp(player.speed, want, jeep ? 3.2 : 8, dt);
    const spdAbs = Math.abs(player.speed);
    const reverse = player.speed >= 0 ? 1 : -1;
    const turn = jeep ? clamp(spdAbs / 8, 0.28, 1) * 1.55 : player.crouch ? 1.4 : 2.15;
    player.yaw += actions.yaw * turn * reverse * dt;
    if (Math.abs(actions.yaw) > 0.25) lookYaw = expDamp(lookYaw, 0, 1.15, dt);

    _fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    player.pos.x += _fwd.x * player.speed * dt;
    player.pos.z += _fwd.z * player.speed * dt;
    const half = WORLD_SIZE * 0.48;
    player.pos.x = clamp(player.pos.x, -half, half);
    player.pos.z = clamp(player.pos.z, -half, half);

    collide(jeep ? 1.35 : 0.48);
    player.pos.y = world.heightAt(player.pos.x, player.pos.z);
  }

  function signature() {
    const jeep = unit === "jeep";
    let s = jeep ? 1.38 : player.crouch ? 0.4 : player.sprint ? 1.12 : 0.7;
    if (spdFactor() < 0.08) s *= 0.72;
    const cover = world.coverAt(player.pos.x, player.pos.z);
    s *= 1 - cover * 0.78;
    return s;
  }

  function spdFactor() {
    return clamp(Math.abs(player.speed) / (unit === "jeep" ? 16.5 : 8.2), 0, 1);
  }

  function animate(dt: number) {
    const jeep = unit === "jeep";
    const mesh = jeep ? jeepMesh : soldierMesh;
    const anim = mesh.userData.anim as Anim | undefined;
    const spd = spdFactor();
    if (!jeep && anim?.legL && anim.legR) {
      const a = time * (7 + spd * 9);
      const amp = 0.62 * spd;
      anim.legL.rotation.x = Math.sin(a) * amp;
      anim.legR.rotation.x = -Math.sin(a) * amp;
      if (anim.armL) anim.armL.rotation.x = -Math.sin(a) * amp * 0.7;
      if (anim.armR) anim.armR.rotation.x = -0.5 + Math.sin(a) * amp * 0.45;
    }
    if (jeep && anim?.wheels) {
      const spin = player.speed * dt / 0.4;
      for (const w of anim.wheels) w.rotation.x += spin;
    }
    playerGrp.rotation.x = jeep ? -player.speed * 0.006 : 0;
    playerGrp.rotation.z = bodyRoll;
  }

  function puffDust(n: number) {
    let spawned = 0;
    for (let i = 0; i < DUST_N && spawned < n; i++) {
      if (dustLife[i] > 0.08) continue;
      dustLife[i] = 0.45 + Math.random() * 0.4;
      dustPos[i * 3] = player.pos.x + (Math.random() - 0.5) * 1.1;
      dustPos[i * 3 + 1] = player.pos.y + 0.18 + Math.random() * 0.25;
      dustPos[i * 3 + 2] = player.pos.z + (Math.random() - 0.5) * 1.1;
      spawned++;
    }
  }

  function stepDust(dt: number) {
    for (let i = 0; i < DUST_N; i++) {
      if (dustLife[i] <= 0) continue;
      dustLife[i] -= dt;
      dustPos[i * 3 + 1] += dt * 0.85;
      if (dustLife[i] <= 0) {
        dustPos[i * 3 + 1] = -40;
      }
    }
    (dustGeo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    dustMat.opacity = nightMode ? 0.22 : 0.42;
  }

  function stepTrails() {
    for (let i = 0; i < hunters.length; i++) {
      const h = hunters[i];
      const tr = trails[i];
      const dead = h.state === "dead";
      tr.line.visible = active && !dead;
      if (dead) continue;
      for (let k = tr.n - 1; k > 0; k--) {
        tr.pos[k * 3] = tr.pos[(k - 1) * 3];
        tr.pos[k * 3 + 1] = tr.pos[(k - 1) * 3 + 1];
        tr.pos[k * 3 + 2] = tr.pos[(k - 1) * 3 + 2];
      }
      tr.pos[0] = h.pos.x;
      tr.pos[1] = h.pos.y;
      tr.pos[2] = h.pos.z;
      (tr.line.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  function stepHunter(h: Hunter, dt: number) {
    if (h.state === "dead") {
      h.deadT -= dt;
      h.mesh.visible = false;
      if (h.deadT <= 0) {
        const wp = WAYPOINTS[h.wp % WAYPOINTS.length];
        h.pos.set(wp[0] + 8, 26, wp[2] - 6);
        h.state = "patrol";
        h.lock = 0;
        h.mesh.visible = active;
      }
      return;
    }

    const toP = _look.set(player.pos.x - h.pos.x, 0, player.pos.z - h.pos.z);
    const dist = Math.hypot(toP.x, toP.z);
    const hx = -Math.sin(h.yaw);
    const hz = -Math.cos(h.yaw);
    const facing = dist > 0.001 ? (toP.x * hx + toP.z * hz) / dist : 1;
    const see =
      player.alive &&
      dist < 92 * signature() &&
      (facing > 0.12 || dist < 16) &&
      los(h.pos.x, h.pos.y, h.pos.z, player.pos.x, player.pos.y + (player.crouch ? 0.7 : 1.4), player.pos.z);

    if (h.state === "patrol" || h.state === "search") {
      if (see) {
        h.lock = Math.min(1, h.lock + dt * (0.55 + (1 - dist / 90) * 0.7));
        if (h.state === "patrol") {
          h.state = "search";
          if (!player.spottedOnce) {
            player.spottedOnce = true;
            events.push({ type: "spotted" });
          }
        }
        if (h.lock >= 1) {
          h.state = "dive";
          events.push({ type: "dive" });
        }
      } else {
        h.lock = Math.max(0, h.lock - dt * 0.45);
        if (h.lock <= 0.05 && h.state === "search") h.state = "patrol";
      }

      const wp = WAYPOINTS[h.wp % WAYPOINTS.length];
      const tx = h.state === "search" ? player.pos.x : wp[0];
      const ty = h.state === "search" ? 16 : wp[1];
      const tz = h.state === "search" ? player.pos.z : wp[2];
      const dx = tx - h.pos.x;
      const dz = tz - h.pos.z;
      const dy = ty - h.pos.y;
      h.yaw = Math.atan2(-dx, -dz);
      const cruise = h.state === "search" ? 22 : 16;
      h.pos.x += -Math.sin(h.yaw) * cruise * dt;
      h.pos.z += -Math.cos(h.yaw) * cruise * dt;
      h.pos.y += clamp(dy, -8, 8) * dt * 0.6;
      if (h.state === "patrol" && Math.hypot(dx, dz) < 10) h.wp = (h.wp + 1) % WAYPOINTS.length;
    } else if (h.state === "dive") {
      const aimY = player.pos.y + 0.8;
      const dx = player.pos.x - h.pos.x;
      const dy = aimY - h.pos.y;
      const dz = player.pos.z - h.pos.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      h.yaw = Math.atan2(-dx, -dz);
      h.pitch = Math.atan2(-dy, Math.hypot(dx, dz));
      const dive = 38;
      h.pos.x += (dx / len) * dive * dt;
      h.pos.y += (dy / len) * dive * dt;
      h.pos.z += (dz / len) * dive * dt;
      const hitPlayer = Math.hypot(h.pos.x - player.pos.x, h.pos.y - player.pos.y, h.pos.z - player.pos.z) < (unit === "jeep" ? 2.6 : 1.7);
      const hitGround = h.pos.y < world.heightAt(h.pos.x, h.pos.z) + 0.4;
      let hitBld = false;
      for (const b of world.buildings) {
        if (Math.hypot(h.pos.x - b.x, h.pos.z - b.z) < b.r && h.pos.y < world.heightAt(b.x, b.z) + b.h + 0.3) {
          hitBld = true;
          break;
        }
      }
      if (hitPlayer || hitGround || hitBld) {
        events.push({ type: "boom", x: h.pos.x, y: h.pos.y, z: h.pos.z });
        if (hitPlayer && player.alive) {
          player.alive = false;
          events.push({ type: "hit" });
        }
        h.state = "dead";
        h.deadT = 5.5;
        h.mesh.visible = false;
      }
    }

    h.mesh.position.copy(h.pos);
    h.mesh.rotation.set(h.pitch, h.yaw, 0, "YXZ");
    h.mesh.traverse((o) => {
      if (o.userData.prop) o.rotation.z += dt * 28;
    });
  }

  function desiredCam() {
    const jeep = unit === "jeep";
    const yaw = player.yaw + lookYaw;
    const pitch = lookPitch;
    const dist = jeep ? 15.8 : player.crouch ? 8.6 : 11.4;
    const lift = jeep ? 2.35 : player.crouch ? 1.25 : 1.65;
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    camPos.set(
      player.pos.x - fwdX * dist * cp,
      player.pos.y + lift + dist * sp,
      player.pos.z - fwdZ * dist * cp,
    );
    const gy = world.heightAt(camPos.x, camPos.z) + 0.95;
    if (camPos.y < gy) camPos.y = gy;
    for (const b of world.buildings) {
      const d = Math.hypot(camPos.x - b.x, camPos.z - b.z);
      if (d < b.r + 1.4 && camPos.y < world.heightAt(b.x, b.z) + b.h + 0.6) {
        const nx = (camPos.x - b.x) / (d || 1);
        const nz = (camPos.z - b.z) / (d || 1);
        camPos.x = b.x + nx * (b.r + 1.4);
        camPos.z = b.z + nz * (b.r + 1.4);
      }
    }
    camTgt.set(
      player.pos.x + fwdX * (jeep ? 2.2 : 1.45),
      player.pos.y + (jeep ? 1.55 : player.crouch ? 0.92 : 1.32),
      player.pos.z + fwdZ * (jeep ? 2.2 : 1.45),
    );
  }

  function tick(dt: number, actions: Actions, mouse: { dx: number; dy: number }, invertY: boolean) {
    if (!active || !player.alive) {
      playerGrp.visible = active;
      return;
    }
    time += dt;
    lookYaw -= mouse.dx * 0.0024;
    lookPitch += (invertY ? -mouse.dy : mouse.dy) * 0.002;
    lookYaw += actions.roll * 2.15 * dt;
    lookPitch += actions.pitch * 1.35 * dt;
    lookPitch = clamp(lookPitch, -0.08, 0.72);
    lookYaw = clamp(lookYaw, -1.15, 1.15);

    movePlayer(dt, actions);
    const wantRoll = -actions.yaw * (unit === "jeep" ? 0.28 : 0.1) * (0.25 + spdFactor());
    bodyRoll = expDamp(bodyRoll, wantRoll, 7, dt);
    const sc = player.crouch && unit === "soldier" ? 0.82 : 1;
    soldierMesh.scale.set(1, sc, 1);
    playerGrp.position.copy(player.pos);
    playerGrp.rotation.y = player.yaw + Math.PI;
    animate(dt);

    const spdAbs = Math.abs(player.speed);
    if (unit === "soldier" && spdAbs > 0.7) {
      stepAcc += dt * (1.7 + spdAbs * 0.45);
      if (stepAcc >= 1) {
        stepAcc = 0;
        events.push({ type: "step" });
        puffDust(player.sprint ? 4 : 2);
      }
    } else {
      stepAcc = 0;
    }
    dustAcc += dt;
    if (unit === "jeep" && spdAbs > 2 && dustAcc > 0.05) {
      dustAcc = 0;
      puffDust(world.surfaceAt(player.pos.x, player.pos.z) === "road" ? 3 : 5);
    }
    stepDust(dt);
    lamp.intensity = nightMode ? (unit === "jeep" ? 2.7 : 0.35) : 0;

    for (const h of hunters) stepHunter(h, dt);
    stepTrails();

    const maxLock = hunters.reduce((m, h) => Math.max(m, h.state === "dead" ? 0 : h.lock), 0);
    const diving = hunters.some((h) => h.state === "dive");
    player.detect = diving ? 1 : maxLock;
    player.locked = diving || maxLock > 0.82;
    if (player.locked && time - lastWarn > 0.9) {
      lastWarn = time;
      events.push({ type: "lock" });
    }

    const gd = Math.hypot(player.pos.x - EXTRACTION.x, player.pos.z - EXTRACTION.z);
    if (gd < EXTRACTION.r && player.alive) {
      const stealth = player.spottedOnce ? 0 : 400;
      score = Math.max(score, Math.round(900 + stealth + Math.max(0, 180 - time) * 4));
      events.push({ type: "extract" });
      player.alive = false;
    }

    ringMat.opacity = 0.35 + 0.25 * Math.sin(time * 3);
  }

  function chaseCam(cam: THREE.PerspectiveCamera, dt: number, shake: number) {
    desiredCam();
    if (!camReady) {
      camPosS.copy(camPos);
      camTgtS.copy(camTgt);
      camReady = true;
    } else {
      camPosS.x = expDamp(camPosS.x, camPos.x, 9, dt);
      camPosS.y = expDamp(camPosS.y, camPos.y, 9, dt);
      camPosS.z = expDamp(camPosS.z, camPos.z, 9, dt);
      camTgtS.x = expDamp(camTgtS.x, camTgt.x, 10, dt);
      camTgtS.y = expDamp(camTgtS.y, camTgt.y, 10, dt);
      camTgtS.z = expDamp(camTgtS.z, camTgt.z, 10, dt);
    }
    cam.position.copy(camPosS);
    if (shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * shake * 0.35;
      cam.position.y += (Math.random() - 0.5) * shake * 0.25;
    }
    cam.lookAt(camTgtS);
    const fov = unit === "jeep" ? 52 : 50;
    if (cam.fov !== fov) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  function snapCam(cam: THREE.PerspectiveCamera) {
    desiredCam();
    camPosS.copy(camPos);
    camTgtS.copy(camTgt);
    camReady = true;
    cam.position.copy(camPos);
    cam.lookAt(camTgt);
    cam.fov = unit === "jeep" ? 52 : 50;
    cam.updateProjectionMatrix();
  }

  return {
    player,
    hunters,
    get unit() {
      return unit;
    },
    get time() {
      return time;
    },
    get score() {
      return score;
    },
    get conceal() {
      return world.coverAt(player.pos.x, player.pos.z);
    },
    get goalDist() {
      return Math.hypot(player.pos.x - EXTRACTION.x, player.pos.z - EXTRACTION.z);
    },
    tick,
    chaseCam,
    snapCam,
    reset,
    setVisible,
    setNight: (on: boolean) => {
      nightMode = on;
      lamp.intensity = on && active ? (unit === "jeep" ? 2.7 : 0.35) : 0;
      dustMat.color.setHex(on ? 0x8a7a62 : 0xc2b08a);
    },
    drain,
    getYaw: () => player.yaw,
    getSpeed: () => Math.abs(player.speed),
    dispose: () => {
      scene.remove(playerGrp, goal, dust);
      for (const h of hunters) scene.remove(h.mesh);
      for (const tr of trails) scene.remove(tr.line);
      ringGeo.dispose();
      ringMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
    },
  };
}

export type GroundSim = ReturnType<typeof createGround>;
