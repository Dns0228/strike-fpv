import * as THREE from "three";
import {
  BEST_GROUND_KEY,
  BEST_SCORE_KEY,
  DRONE_LIVES,
  ASSAULT_GOAL,
  WEAPON_ORDER,
  type WeaponId,
} from "./catalog";
import { createAudio } from "./audio";
import { createGround } from "./ground";
import { createInfiltrators } from "./infiltrators";
import { createInput } from "./input";
import { isGroundSeat, isFpvSeat, MODES } from "./modes";
import { lockLandscape } from "./orientation";
import { createReplay } from "./replay";
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
    __strikeFpv?: { phase: string; mode?: string };
  }
}

export type GameHandle = {
  dispose: () => void;
  startSortie: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  nextLife: () => void;
  skipReplay: () => void;
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
  const coarse = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 700;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, coarse ? 1.35 : 2));
  renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(88, 1, 0.12, 700);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(0xffe4c4, 0x3a4030, 0.72);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffe0b0, 2.05);
  sun.position.set(-90, 110, -70);
  sun.castShadow = true;
  const map = coarse ? 1024 : 2048;
  sun.shadow.mapSize.set(map, map);
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 280;
  sun.shadow.camera.left = -88;
  sun.shadow.camera.right = 88;
  sun.shadow.camera.top = 88;
  sun.shadow.camera.bottom = -88;
  sun.shadow.bias = -0.0007;
  sun.shadow.normalBias = 0.04;
  scene.add(sun);
  scene.add(sun.target);

  const fill = new THREE.DirectionalLight(0x8aa0b4, 0.32);
  fill.position.set(50, 18, 90);
  scene.add(fill);
  const bounce = new THREE.DirectionalLight(0x6a7a48, 0.18);
  bounce.position.set(0, -20, 10);
  scene.add(bounce);

  const world = buildWorld(scene);
  const sim = createSim(scene, world);
  const ground = createGround(scene, world);
  ground.setVisible(false);
  const infil = createInfiltrators(world, sim);
  infil.setActive(false);
  const replay = createReplay(scene);
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
  let pendingAfterReplay: "flight" | "dead" | "victory" | "dead-continue" | null = null;
  let fireLatch = false;

  const best = Number(localStorage.getItem(BEST_SCORE_KEY) || "0") || 0;
  const bestGround = Number(localStorage.getItem(BEST_GROUND_KEY) || "0") || 0;
  useGameStore.getState().patch({
    best,
    bestGround,
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
    replay.resize(w, h);
  }
  resize();
  const ro = new ResizeObserver(resize);
  if (canvas.parentElement) ro.observe(canvas.parentElement);
  window.addEventListener("resize", resize);

  function setPhase(phase: "hangar" | "flight" | "pause" | "dead" | "victory" | "replay") {
    useGameStore.getState().patch({ phase });
    window.__strikeFpv = { phase, mode: useGameStore.getState().mode };
  }

  function startFree() {
    ground.setVisible(false);
    infil.setActive(false);
    sim.resetMatch();
    sim.setStaticIdle(false);
    sim.setTargetBeacons(true);
    sim.setRules({ mortal: false, drainMul: 0.32 });
    sim.setWeapon(useGameStore.getState().weapon);
    setPhase("flight");
    useGameStore.getState().patch({
      score: 0,
      destroyed: 0,
      lives: 99,
      battery: 100,
      ammo: refillAmmo(),
      replay: null,
      detect: 0,
      locked: false,
      breaches: 0,
      wave: 0,
      message: "Свободный полёт. Пауза — выход в ангар.",
    });
    input.requestLock();
  }

  function startArcade() {
    ground.setVisible(false);
    sim.resetMatch();
    sim.setStaticIdle(true);
    sim.setTargetBeacons(false);
    sim.setRules({ mortal: true, drainMul: 1 });
    sim.setWeapon(useGameStore.getState().weapon);
    infil.setActive(true);
    infil.reset();
    setPhase("flight");
    useGameStore.getState().patch({
      score: 0,
      destroyed: 0,
      lives: sim.lives,
      battery: 100,
      ammo: refillAmmo(),
      replay: null,
      detect: 0,
      locked: false,
      wave: 1,
      waves: infil.waves,
      breaches: 0,
      breachMax: infil.breachMax,
      message: "Оборона линии. Не дайте пехоте пересечь красную ленту.",
    });
    input.requestLock();
  }

  function startAssault() {
    infil.setActive(false);
    sim.resetMatch();
    sim.setStaticIdle(true);
    sim.setTargetBeacons(false);
    sim.setRules({ mortal: true, drainMul: 1 });
    ground.reset(useGameStore.getState().unit);
    ground.snapCam(camera);
    fpvRig.visible = false;
    setPhase("flight");
    useGameStore.getState().patch({
      score: 0,
      destroyed: 0,
      lives: 1,
      battery: 100,
      replay: null,
      detect: 0,
      locked: false,
      message: "Штурм. Зелёный круг — линия фронта. Прячьтесь от FPV.",
    });
    input.requestLock();
  }

  function startSortie() {
    audio.unlock();
    lockLandscape();
    const mode = useGameStore.getState().mode;
    if (mode === "assault") startAssault();
    else if (mode === "free") startFree();
    else startArcade();
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
    const mode = useGameStore.getState().mode;
    if (mode === "assault") {
      startAssault();
      return;
    }
    if (mode === "free") {
      startFree();
      return;
    }
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
    const mode = useGameStore.getState().mode;
    const score = mode === "assault" ? ground.score : sim.score;
    if (mode === "assault") {
      const prev = Number(localStorage.getItem(BEST_GROUND_KEY) || "0") || 0;
      const nextBest = Math.max(prev, score);
      localStorage.setItem(BEST_GROUND_KEY, String(nextBest));
      useGameStore.getState().patch({ score, bestGround: nextBest, lives: 0 });
    } else {
      const prev = Number(localStorage.getItem(BEST_SCORE_KEY) || "0") || 0;
      const nextBest = Math.max(prev, score);
      localStorage.setItem(BEST_SCORE_KEY, String(nextBest));
      useGameStore.getState().patch({ score, best: nextBest, lives: sim.lives });
    }
    setPhase(win ? "victory" : "dead");
    const def = MODES[mode];
    useGameStore.getState().patch({
      message: win
        ? mode === "assault"
          ? "Вышли на линию фронта."
          : mode === "arcade"
            ? "Линия удержана."
            : "Полёт завершён."
        : mode === "assault"
          ? "FPV накрыл группу."
          : mode === "arcade"
            ? "Противник прорвал линию."
            : "Вылет сорван.",
    });
    void def;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function beginReplay(spec: Parameters<typeof replay.start>[0], after: typeof pendingAfterReplay) {
    pendingAfterReplay = after;
    replay.start(spec);
    sim.hideProjectiles(true);
    fpvRig.visible = false;
    setPhase("replay");
    useGameStore.getState().patch({
      replay: {
        label: spec.label,
        armor: spec.armor,
        damage: spec.damage,
        kill: spec.kill,
        weapon: spec.weapon,
        hp: spec.hp,
        maxHp: spec.maxHp,
        secondary: spec.secondary,
        impacted: false,
      },
      message: "Разведчик: повтор попадания",
    });
    if (document.pointerLockElement) document.exitPointerLock();
  }

  function endReplay() {
    sim.commitImpact();
    sim.drainEvents();
    replay.stop();
    sim.hideProjectiles(false);
    useGameStore.getState().patch({ replay: null });
    const after = pendingAfterReplay;
    pendingAfterReplay = null;
    if (after === "victory" || (sim.destroyed >= sim.total && after !== "dead" && after !== "dead-continue")) {
      finish(true);
    } else if (after === "dead") {
      finish(false);
    } else if (after === "dead-continue") {
      setPhase("dead");
    } else {
      setPhase("flight");
      input.requestLock();
    }
  }

  function skipReplay() {
    if (useGameStore.getState().phase !== "replay") return;
    const need = replay.skip();
    if (need) sim.commitImpact();
    endReplay();
  }

  function handleEvents(w: number, h: number) {
    const cam = camera;
    const events = sim.drainEvents();
    const st = useGameStore.getState();
    const floats = st.floats.filter((f) => performance.now() - f.born < 900);
    let killcam = null as (typeof events)[number] | null;
    let crashed = false;
    let kami = false;
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
        if (e.kill) useGameStore.getState().patch({ hitFlash: 1 });
      }
      if (e.type === "killcam") killcam = e;
      if (e.type === "crash") {
        audio.crash();
        crashed = true;
        kami = e.kamikaze;
      }
    }
    if (floats.length !== st.floats.length) useGameStore.getState().patch({ floats });

    if (killcam && st.mode === "free") sim.commitImpact();

    if (st.phase === "flight" && isFpvSeat(st.mode) && st.mode !== "free" && killcam && killcam.type === "killcam") {
      let after: typeof pendingAfterReplay = "flight";
      if (st.mode === "arcade") {
        after = infil.won
          ? "victory"
          : crashed
            ? sim.lives <= 0
              ? "dead"
              : "dead-continue"
            : "flight";
      } else if (crashed) {
        after = sim.lives <= 0 ? "dead" : "dead-continue";
      }
      beginReplay(killcam.spec, after);
      return;
    }
    if (st.phase === "flight" && crashed && (st.mode === "free" || !killcam)) {
      if (st.mode === "free") {
        sim.respawn();
        useGameStore.getState().patch({ battery: 100, ammo: { ...sim.ammo }, message: "Борт восстановлен." });
        return;
      }
      if (sim.destroyed >= sim.total && st.mode === "arcade") {
        /* infiltrators decide win */
      }
      if (sim.lives <= 0) finish(false);
      else setPhase("dead");
    }
    void kami;
  }

  function handleGroundEvents() {
    const ev = ground.drain();
    for (const e of ev) {
      if (e.type === "spotted") audio.warning();
      if (e.type === "lock") audio.lock();
      if (e.type === "dive") audio.warning();
      if (e.type === "boom") {
        audio.explode(1.2);
        sim.boomAt(e.x, e.y, e.z, 1.1);
      }
      if (e.type === "hit") {
        audio.crash();
        useGameStore.getState().patch({ hitFlash: 1, score: ground.score });
        finish(false);
      }
      if (e.type === "extract") {
        useGameStore.getState().patch({ score: ground.score, hitFlash: 0.6 });
        finish(true);
      }
    }
  }

  const _v = new THREE.Vector3();

  function pushHud(dt: number) {
    const st = useGameStore.getState();
    if (st.mode === "assault") {
      const heading = ((-ground.getYaw() * 180) / Math.PI + 36000) % 360;
      const hunterBlips: { id: number; x: number; z: number; armor: "soft" | "light" | "heavy"; alive: boolean }[] =
        ground.hunters.map((h) => ({
          id: 1000 + h.id,
          x: h.pos.x,
          z: h.pos.z,
          armor: "heavy",
          alive: h.state !== "dead",
        }));
      hunterBlips.push({
        id: 9999,
        x: ASSAULT_GOAL.x,
        z: ASSAULT_GOAL.z,
        armor: "soft",
        alive: true,
      });
      useGameStore.getState().patch({
        lives: ground.player.alive ? 1 : 0,
        battery: 100,
        altitude: 0,
        speed: ground.getSpeed(),
        heading,
        score: ground.score,
        destroyed: 0,
        totalTargets: 1,
        blips: hunterBlips,
        droneX: ground.player.pos.x,
        droneZ: ground.player.pos.z,
        detect: ground.player.detect,
        locked: ground.player.locked,
        conceal: ground.conceal,
        goalDist: ground.goalDist,
        hunters: ground.hunters.filter((h) => h.state !== "dead").length,
        lock: null,
        hitFlash: Math.max(0, st.hitFlash - dt * 3),
      });
      return;
    }

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
      totalTargets: st.mode === "arcade" ? infil.alive : sim.total,
      blips: sim.getBlips().slice(),
      droneX: sim.drone.pos.x,
      droneZ: sim.drone.pos.z,
      detect: 0,
      locked: false,
      wave: infil.wave,
      waves: infil.waves,
      breaches: infil.breaches,
      breachMax: infil.breachMax,
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
    if (st.phase === "flight" && st.mode === "arcade") {
      if (infil.won) finish(true);
      else if (infil.lost) finish(false);
    }
  }

  function cinematic(dt: number) {
    cineT += dt;
    const cx = 8 + Math.cos(cineT * 0.1) * 78;
    const cz = 18 + Math.sin(cineT * 0.1) * 64;
    camera.position.set(cx, 18 + Math.sin(cineT * 0.16) * 4.5, cz);
    camera.lookAt(22, 1.6, -38);
    camera.fov = 48;
    camera.updateProjectionMatrix();
  }

  function loop(now: number) {
    if (disposed) return;
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const st = useGameStore.getState();
    const flying = st.phase === "flight";
    const paused = st.phase === "pause";
    const replaying = st.phase === "replay";
    const isGround = isGroundSeat(st.mode);
    if (paused && document.pointerLockElement) document.exitPointerLock();
    if (st.phase === "hangar") {
      ground.setVisible(false);
      infil.setActive(false);
    }
    audio.setMuted(st.muted);
    if (st.weapon !== sim.weapon) sim.setWeapon(st.weapon);
    const actions = input.sample(st.invertY);
    const mouse = flying || replaying ? input.consumeMouse() : (input.consumeMouse(), { dx: 0, dy: 0 });

    if (replaying) {
      const fireEdge = actions.fire && !fireLatch;
      fireLatch = actions.fire;
      if (actions.pausePress || fireEdge) skipReplay();
      const r = replay.update(dt);
      if (r.justImpact) {
        sim.commitImpact();
        sim.drainEvents();
        audio.explode(1.6);
        const info = useGameStore.getState().replay;
        if (info) useGameStore.getState().patch({ replay: { ...info, impacted: true } });
      }
      sim.tick(dt * r.timeScale, actions, { dx: 0, dy: 0 }, st.invertY, false, camera, st.shake);
      fpvRig.visible = false;
      if (r.done && useGameStore.getState().phase === "replay") endReplay();
      world.tick(now * 0.001, replay.cam);
      renderer.render(scene, replay.cam);
      return;
    }
    fireLatch = actions.fire;

    if (flying && actions.pausePress) pause();
    else if (paused && actions.pausePress) resume();

    if (flying && !isGround && actions.weaponSlot !== null) {
      sim.setWeapon(WEAPON_ORDER[actions.weaponSlot]);
    }

    if (!paused) {
      if (flying && isGround) {
        fpvRig.visible = false;
        ground.tick(dt, actions, mouse);
        ground.chaseCam(camera, dt, st.shake ? ground.player.locked ? 0.45 : 0 : 0);
        sim.tick(dt, actions, { dx: 0, dy: 0 }, st.invertY, false, camera, false);
        audio.props(0.2 + ground.player.detect * 0.5);
        const focus = ground.player.pos;
        sun.position.set(focus.x - 90, 110, focus.z - 70);
        sun.target.position.copy(focus);
        sun.target.updateMatrixWorld();
        handleGroundEvents();
      } else if (flying) {
        if (camera.fov !== 88) {
          camera.fov = 88;
          camera.updateProjectionMatrix();
        }
        sim.tick(dt, actions, mouse, st.invertY, true, camera, st.shake);
        if (st.mode === "arcade") {
          infil.tick(dt);
          const ie = infil.drain();
          for (const e of ie) {
            if (e.type === "breach") audio.warning();
            if (e.type === "wave") {
              useGameStore.getState().patch({
                wave: e.n,
                message: `Волна ${e.n} из ${infil.waves}`,
              });
            }
          }
        }
        audio.props(sim.drone.throttle);
        fpvRig.visible = true;
        fpvRig.traverse((o) => {
          if (o.userData.prop) o.rotation.z += dt * (12 + sim.drone.throttle * 40);
        });
        sun.position.set(sim.drone.pos.x - 90, 110, sim.drone.pos.z - 70);
        sun.target.position.copy(sim.drone.pos);
        sun.target.updateMatrixWorld();
      } else {
        fpvRig.visible = false;
        sim.tick(dt, actions, { dx: 0, dy: 0 }, st.invertY, false, camera, false);
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

    world.tick(now * 0.001, replaying ? replay.cam : camera);
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(loop);

  function bindProbe() {
    window.__controlsTest = {
      getYaw: () => (isGroundSeat(useGameStore.getState().mode) ? ground.getYaw() : sim.getYaw()),
      getSpeed: () => (isGroundSeat(useGameStore.getState().mode) ? ground.getSpeed() : sim.getSpeed()),
      setKeys: (codes) => input.setKeys(codes),
      setSteer: (v) => input.setSteer(v),
    };
    window.__strikeFpv = {
      phase: useGameStore.getState().phase,
      mode: useGameStore.getState().mode,
    };
  }
  bindProbe();

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
      ground.dispose();
      replay.dispose();
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
    skipReplay,
    setWeapon: (id) => sim.setWeapon(id),
    input,
  };
}
