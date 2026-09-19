import * as THREE from "three";
import { BEST_SCORE_KEY, DRONE_LIVES, WEAPON_ORDER, type WeaponId } from "./catalog";
import { createAudio } from "./audio";
import { createInput } from "./input";
import { createSim } from "./sim";
import { refillAmmo, useGameStore } from "./store";
import { buildWorld, createDroneBody } from "./world";

export type ControlsProbe = {
  getYaw: () => number;
  getSpeed: () => number;
  setSteer?: (v: number) => void;
  setKeys?: (codes: string[]) => void;
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
    __strikeFpv?: { phase: string };
  }
}

export type GameHandle = {
  dispose: () => void;
  startSortie: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  nextLife: () => void;
  setWeapon: (id: WeaponId) => void;
  input: ReturnType<typeof createInput>;
};

export function createGame(canvas: HTMLCanvasElement): GameHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(88, 1, 0.12, 700);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xc9d2c6, 0x3a3d32, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xf0ead8, 1.35);
  sun.position.set(-80, 120, -60);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 10;
  sun.shadow.camera.far = 260;
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x8a9aa0, 0.25);
  fill.position.set(40, 20, 80);
  scene.add(fill);

  const world = buildWorld(scene);
  const sim = createSim(scene, world);
  const input = createInput();
  input.attach(canvas);
  const audio = createAudio();

  const fpvRig = createDroneBody();
  fpvRig.position.set(0, -0.12, -0.28);
  fpvRig.scale.setScalar(0.85);
  camera.add(fpvRig);

  let disposed = false;
  let last = performance.now();
  let hudAcc = 0;
  let cineT = 0;
  let floatId = 1;
  let lastLock = false;

  const best = Number(localStorage.getItem(BEST_SCORE_KEY) || "0") || 0;
  useGameStore.getState().patch({
    best,
    totalTargets: sim.total,
    lives: DRONE_LIVES,
  });

  function resize() {
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || window.innerWidth;
    const h = parent?.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    camera.updateProjectionMatrix();
  }
  resize();
  const ro = new ResizeObserver(resize);
  if (canvas.parentElement) ro.observe(canvas.parentElement);
  window.addEventListener("resize", resize);

  function setPhase(phase: "hangar" | "flight" | "pause" | "dead" | "victory") {
    useGameStore.getState().patch({ phase });
    window.__strikeFpv = { phase };
  }

  function startSortie() {
    audio.unlock();
    sim.resetMatch();
    sim.setWeapon(useGameStore.getState().weapon);
    setPhase("flight");
    useGameStore.getState().patch({
      score: 0,
      destroyed: 0,
      lives: sim.lives,
      battery: 100,
      ammo: refillAmmo(),
      message: "Вылет. Цель: уничтожить все объекты.",
    });
    input.requestLock();
  }

  function pause() {
    if (useGameStore.getState().phase !== "flight") return;
    setPhase("pause");
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function resume() {
    if (useGameStore.getState().phase !== "pause") return;
    setPhase("flight");
    input.requestLock();
  }

  function restart() {
    startSortie();
  }

  function nextLife() {
    if (sim.lives <= 0) {
      finish(false);
      return;
    }
    sim.respawn();
    setPhase("flight");
    useGameStore.getState().patch({
      lives: sim.lives,
      battery: 100,
      ammo: { ...sim.ammo },
      message: `Дрон ${4 - sim.lives} из 3`,
    });
    input.requestLock();
  }

  function finish(win: boolean) {
    const score = sim.score;
    const prev = Number(localStorage.getItem(BEST_SCORE_KEY) || "0") || 0;
    const nextBest = Math.max(prev, score);
    localStorage.setItem(BEST_SCORE_KEY, String(nextBest));
    setPhase(win ? "victory" : "dead");
    useGameStore.getState().patch({
      score,
      best: nextBest,
      lives: sim.lives,
      message: win ? "Полигон зачищен." : "Вылет сорван.",
    });
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function handleEvents(w: number, h: number) {
    const cam = camera;
    const events = sim.drainEvents();
    const st = useGameStore.getState();
    const floats = st.floats.filter((f) => performance.now() - f.born < 900);
    for (const e of events) {
      if (e.type === "shot") audio.shot();
      if (e.type === "explode") audio.explode(e.size);
      if (e.type === "hit") {
        audio.hit();
        _v.set(e.x, e.y, e.z).project(cam);
        floats.push({
          id: floatId++,
          text: e.kill ? `${e.label}  +${e.damage}` : `−${e.damage}`,
          x: (_v.x * 0.5 + 0.5) * w,
          y: (-_v.y * 0.5 + 0.5) * h,
          born: performance.now(),
          kind: e.kill ? "kill" : "hit",
        });
        if (e.kill) {
          useGameStore.getState().patch({ hitFlash: 1 });
        }
      }
      if (e.type === "crash") {
        audio.crash();
        if (sim.destroyed >= sim.total) finish(true);
        else if (sim.lives <= 0) finish(false);
        else setPhase("dead");
      }
    }
    if (floats.length !== st.floats.length) useGameStore.getState().patch({ floats });
  }

  const _v = new THREE.Vector3();

  function pushHud(dt: number) {
    const st = useGameStore.getState();
    const lock = sim.pickLock(camera, canvas.clientWidth, canvas.clientHeight);
    if (lock && !lastLock) audio.lock();
    lastLock = !!lock;
    const heading = ((-sim.drone.yaw * 180) / Math.PI + 36000) % 360;
    useGameStore.getState().patch({
      weapon: sim.weapon,
      ammo: { ...sim.ammo },
      lives: sim.lives,
      battery: sim.drone.battery,
      altitude: Math.max(0, sim.drone.pos.y - world.heightAt(sim.drone.pos.x, sim.drone.pos.z)),
      speed: sim.getSpeed(),
      heading,
      score: sim.score,
      destroyed: sim.destroyed,
      totalTargets: sim.total,
      lock: lock
        ? {
            label: lock.label,
            kind: lock.kind,
            armor: lock.armor,
            hp: lock.hp,
            maxHp: lock.maxHp,
            dist: lock.dist,
            screenX: lock.screenX,
            screenY: lock.screenY,
            expected: lock.expected,
            weapon: lock.weapon,
          }
        : null,
      hitFlash: Math.max(0, st.hitFlash - dt * 3),
    });
    if (sim.destroyed >= sim.total && st.phase === "flight") finish(true);
  }

  function cinematic(dt: number) {
    cineT += dt;
    const cx = 20 + Math.cos(cineT * 0.12) * 92;
    const cz = -10 + Math.sin(cineT * 0.12) * 92;
    camera.position.set(cx, 26 + Math.sin(cineT * 0.18) * 6, cz);
    camera.lookAt(8, 3, -6);
    camera.fov = 52;
    camera.updateProjectionMatrix();
  }

  function loop(now: number) {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const st = useGameStore.getState();
    const flying = st.phase === "flight";
    const paused = st.phase === "pause";
    if (paused && document.pointerLockElement) document.exitPointerLock();
    audio.setMuted(st.muted);
    if (st.weapon !== sim.weapon) sim.setWeapon(st.weapon);
    const actions = input.sample(st.invertY);
    const mouse = flying ? input.consumeMouse() : (input.consumeMouse(), { dx: 0, dy: 0 });

    if (flying && actions.pausePress) pause();
    else if (paused && actions.pausePress) resume();

    if (flying && actions.weaponSlot !== null) {
      sim.setWeapon(WEAPON_ORDER[actions.weaponSlot]);
    }

    if (!paused) {
      if (flying) {
        if (camera.fov !== 88) {
          camera.fov = 88;
          camera.updateProjectionMatrix();
        }
        sim.tick(dt, actions, mouse, st.invertY, true, camera);
        audio.props(sim.drone.throttle);
        fpvRig.visible = true;
        fpvRig.traverse((o) => {
          if (o.userData.prop) o.rotation.z += dt * (12 + sim.drone.throttle * 40);
        });
        sun.position.set(sim.drone.pos.x - 80, 120, sim.drone.pos.z - 60);
        sun.target.position.copy(sim.drone.pos);
        sun.target.updateMatrixWorld();
      } else {
        fpvRig.visible = false;
        sim.tick(dt, actions, { dx: 0, dy: 0 }, st.invertY, false, camera);
        if (st.phase === "hangar") cinematic(dt);
        audio.props(st.phase === "hangar" ? 0.15 : 0);
      }
    }

    handleEvents(canvas.clientWidth, canvas.clientHeight);
    hudAcc += dt;
    if (hudAcc > 0.08) {
      hudAcc = 0;
      if (flying || st.phase === "dead" || st.phase === "victory") pushHud(0.08);
    }

    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(loop);

  window.__controlsTest = {
    getYaw: () => sim.getYaw(),
    getSpeed: () => sim.getSpeed(),
    setKeys: (codes) => input.setKeys(codes),
    setSteer: (v) => input.setSteer(v),
  };
  window.__strikeFpv = { phase: useGameStore.getState().phase };

  document.addEventListener("visibilitychange", () => {
    if (document.hidden && useGameStore.getState().phase === "flight") pause();
    else audio.unlock();
  });

  return {
    dispose: () => {
      disposed = true;
      renderer.setAnimationLoop(null);
      input.detach();
      audio.dispose();
      sim.dispose();
      world.dispose();
      ro.disconnect();
      window.removeEventListener("resize", resize);
      renderer.dispose();
      delete window.__controlsTest;
    },
    startSortie,
    pause,
    resume,
    restart,
    nextLife,
    setWeapon: (id) => sim.setWeapon(id),
    input,
  };
}
