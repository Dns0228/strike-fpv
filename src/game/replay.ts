import * as THREE from "three";
import { WEAPONS, type Armor, type TargetKind, type WeaponId } from "./catalog";
import { clamp, lerp, smooth } from "./math";
import { createDroneBody } from "./world";

export type KillcamSpec = {
  x: number;
  y: number;
  z: number;
  ix: number;
  iy: number;
  iz: number;
  damage: number;
  kill: boolean;
  label: string;
  armor: Armor;
  kind: TargetKind;
  hp: number;
  maxHp: number;
  weapon: WeaponId | "kami";
  kamikaze: boolean;
  secondary: number;
  groundY: number;
};

const APPROACH = 0.92;
const SLOW = 0.78;
const SETTLE = 1.2;
export const REPLAY_DURATION = APPROACH + SLOW + SETTLE;

const _look = new THREE.Vector3();
const _y = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();

export function createReplay(scene: THREE.Scene) {
  const cam = new THREE.PerspectiveCamera(50, 1, 0.12, 720);

  const rocketGeo = new THREE.CylinderGeometry(0.08, 0.18, 1.25, 7);
  const rocketMat = new THREE.MeshBasicMaterial({ color: 0xb9b6a8 });
  const dummyRocket = new THREE.Mesh(rocketGeo, rocketMat);
  dummyRocket.visible = false;
  scene.add(dummyRocket);

  const dummyDrone = createDroneBody();
  dummyDrone.scale.setScalar(1.35);
  dummyDrone.visible = false;
  scene.add(dummyDrone);

  let active = false;
  let t = 0;
  let impacted = false;
  let spec: KillcamSpec | null = null;
  const impact = new THREE.Vector3();
  const inbound = new THREE.Vector3();
  const startPos = new THREE.Vector3();
  let trauma = 0;
  const fovBase = 50;

  function placeCam(u: number) {
    const ang = Math.atan2(inbound.x, inbound.z) + 1.12 + u * 0.92;
    const punch = trauma * trauma;
    const radius = lerp(17.4, 12.2, smooth(clamp(u * 1.35, 0, 1))) * (1 - punch * 0.1);
    const height = lerp(8.6, 5.6, smooth(clamp(u, 0, 1)));
    cam.position.set(
      impact.x + Math.sin(ang) * radius,
      impact.y + height,
      impact.z + Math.cos(ang) * radius,
    );
    _look.set(impact.x, impact.y + 0.85, impact.z);
    cam.lookAt(_look);
    if (punch > 0.002) {
      cam.position.x += (Math.random() - 0.5) * punch * 0.6;
      cam.position.y += (Math.random() - 0.5) * punch * 0.42;
      cam.position.z += (Math.random() - 0.5) * punch * 0.6;
      cam.fov = fovBase - punch * 7;
    } else {
      cam.fov = fovBase;
    }
    cam.updateProjectionMatrix();
  }

  function placeDummy(u: number) {
    const eased = u * u * (1.15 - 0.15 * u);
    dummyRocket.position.lerpVectors(startPos, impact, eased);
    dummyDrone.position.lerpVectors(startPos, impact, eased);
    _dir.copy(inbound);
    if (_dir.lengthSq() < 1e-6) _dir.set(0, 0, -1);
    dummyRocket.quaternion.setFromUnitVectors(_y, _dir);
    dummyDrone.lookAt(impact);
    dummyDrone.traverse((o) => {
      if (o.userData.prop) o.rotation.z += 0.9;
    });
  }

  function hideDummies() {
    dummyRocket.visible = false;
    dummyDrone.visible = false;
  }

  function start(s: KillcamSpec) {
    spec = s;
    active = true;
    t = 0;
    impacted = false;
    trauma = 0;
    impact.set(s.x, s.y, s.z);
    inbound.set(s.ix, s.iy, s.iz);
    if (inbound.lengthSq() < 0.0001) inbound.set(0, -0.05, -1);
    inbound.normalize();
    startPos.copy(impact).addScaledVector(inbound, -24);
    startPos.y = Math.max(s.groundY + 1.4, startPos.y);

    if (s.kamikaze) {
      dummyDrone.visible = true;
      dummyDrone.position.copy(startPos);
      dummyRocket.visible = false;
    } else {
      dummyRocket.visible = true;
      dummyRocket.position.copy(startPos);
      dummyDrone.visible = false;
      const col = s.weapon === "kami" ? 0xb9b6a8 : WEAPONS[s.weapon].color;
      rocketMat.color.setHex(col);
    }
    placeDummy(0);
    placeCam(0);
  }

  function update(dt: number) {
    if (!active) return { done: true, justImpact: false, timeScale: 1, impacted, t, spec };
    t += dt;
    trauma = Math.max(0, trauma - dt * 1.75);

    const u = clamp(t / REPLAY_DURATION, 0, 1);
    const approachU = clamp(t / APPROACH, 0, 1);
    if (!impacted) placeDummy(approachU);

    let justImpact = false;
    if (!impacted && t >= APPROACH) {
      impacted = true;
      justImpact = true;
      trauma = 1;
      hideDummies();
    }

    placeCam(u);

    let timeScale = 0.38;
    if (t >= APPROACH && t < APPROACH + SLOW) timeScale = 0.24;
    else if (t >= APPROACH + SLOW) timeScale = 0.52;

    const done = t >= REPLAY_DURATION;
    if (done) hideDummies();
    return { done, justImpact, timeScale, impacted, t, spec };
  }

  function skip(): boolean {
    const needImpact = active && !impacted;
    impacted = true;
    t = REPLAY_DURATION;
    hideDummies();
    active = false;
    return needImpact;
  }

  function stop() {
    active = false;
    hideDummies();
    spec = null;
  }

  function resize(w: number, h: number) {
    cam.aspect = w / Math.max(1, h);
    cam.updateProjectionMatrix();
  }

  return {
    cam,
    get active() {
      return active;
    },
    get spec() {
      return spec;
    },
    start,
    update,
    skip,
    stop,
    resize,
    dispose: () => {
      scene.remove(dummyRocket, dummyDrone);
      rocketGeo.dispose();
      rocketMat.dispose();
    },
  };
}

export type ReplayApi = ReturnType<typeof createReplay>;
