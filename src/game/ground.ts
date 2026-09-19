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
  | { type: "extract" };

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

  const hunters: Hunter[] = [];
  for (let i = 0; i < 3; i++) {
    const mesh = createDroneBody();
    mesh.scale.setScalar(3.4);
    mesh.traverse((o) => {
      if (o instanceof THREE.Mesh && o.material instanceof THREE.MeshLambertMaterial) {
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
    for (const h of hunters) h.mesh.visible = on && h.state !== "dead";
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

  function movePlayer(dt: number, actions: Actions) {
    const jeep = unit === "jeep";
    player.sprint = !jeep && (actions.boost || actions.fire) && !player.crouch;
    player.crouch = !jeep && (actions.crouch || actions.detonate || actions.pitch > 0.45);
    const max = jeep ? (actions.boost ? 21 : 16.5) : player.crouch ? 2.6 : player.sprint ? 8.2 : 5.1;
    const accel = jeep ? 14 : 18;
    const want = actions.throttle * max;
    player.speed = expDamp(player.speed, want, jeep ? 3.2 : 8, dt);
    const spdAbs = Math.abs(player.speed);
    const reverse = player.speed >= 0 ? 1 : -1;
    const turn = jeep
      ? clamp(spdAbs / 8, 0.28, 1) * 1.55
      : player.crouch
        ? 1.4
        : 2.15;
    player.yaw += actions.yaw * turn * reverse * dt;

    _fwd.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
    player.pos.x += _fwd.x * player.speed * dt;
    player.pos.z += _fwd.z * player.speed * dt;
    const half = WORLD_SIZE * 0.48;
    player.pos.x = clamp(player.pos.x, -half, half);
    player.pos.z = clamp(player.pos.z, -half, half);

    const groundY = world.heightAt(player.pos.x, player.pos.z);
    player.pos.y = groundY;

    for (const b of world.buildings) {
      const d = Math.hypot(player.pos.x - b.x, player.pos.z - b.z);
      const rad = b.r + (jeep ? 1.1 : 0.45);
      if (d < rad && player.pos.y < world.heightAt(b.x, b.z) + b.h) {
        const nx = (player.pos.x - b.x) / (d || 1);
        const nz = (player.pos.z - b.z) / (d || 1);
        player.pos.x = b.x + nx * rad;
        player.pos.z = b.z + nz * rad;
        player.speed *= 0.4;
      }
    }
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

  function tick(dt: number, actions: Actions, _mouse: { dx: number; dy: number }) {
    if (!active || !player.alive) {
      playerGrp.visible = active;
      return;
    }
    time += dt;
    movePlayer(dt, actions);
    const sc = player.crouch && unit === "soldier" ? 0.78 : 1;
    soldierMesh.scale.set(1, sc, 1);
    playerGrp.position.copy(player.pos);
    playerGrp.rotation.y = player.yaw + Math.PI;

    for (const h of hunters) stepHunter(h, dt);

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
    const jeep = unit === "jeep";
    const fwdX = -Math.sin(player.yaw);
    const fwdZ = -Math.cos(player.yaw);
    const dist = jeep ? 9.2 : 6.4;
    const height = jeep ? 3.4 : player.crouch ? 2.1 : 2.55;
    const tx = player.pos.x - fwdX * dist;
    const ty = player.pos.y + height;
    const tz = player.pos.z - fwdZ * dist;
    cam.position.x = expDamp(cam.position.x, tx, 8, dt);
    cam.position.y = expDamp(cam.position.y, ty, 8, dt);
    cam.position.z = expDamp(cam.position.z, tz, 8, dt);
    if (shake > 0.01) {
      cam.position.x += (Math.random() - 0.5) * shake * 0.35;
      cam.position.y += (Math.random() - 0.5) * shake * 0.25;
    }
    cam.lookAt(player.pos.x + fwdX * 3.5, player.pos.y + (jeep ? 1.3 : 1.15), player.pos.z + fwdZ * 3.5);
    if (cam.fov !== 60) {
      cam.fov = 60;
      cam.updateProjectionMatrix();
    }
  }

  function snapCam(cam: THREE.PerspectiveCamera) {
    const jeep = unit === "jeep";
    const fwdX = -Math.sin(player.yaw);
    const fwdZ = -Math.cos(player.yaw);
    const dist = jeep ? 9.2 : 6.4;
    cam.position.set(player.pos.x - fwdX * dist, player.pos.y + (jeep ? 3.4 : 2.55), player.pos.z - fwdZ * dist);
    cam.lookAt(player.pos.x + fwdX * 3.5, player.pos.y + 1.2, player.pos.z + fwdZ * 3.5);
    cam.fov = 60;
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
    drain,
    getYaw: () => player.yaw,
    getSpeed: () => Math.abs(player.speed),
    dispose: () => {
      scene.remove(playerGrp, goal);
      for (const h of hunters) scene.remove(h.mesh);
      ringGeo.dispose();
      ringMat.dispose();
    },
  };
}

export type GroundSim = ReturnType<typeof createGround>;
