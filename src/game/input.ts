import { radialDeadzone } from "./math";

export type Actions = {
  throttle: number;
  yaw: number;
  pitch: number;
  roll: number;
  boost: boolean;
  fire: boolean;
  detonate: boolean;
  crouch: boolean;
  pausePress: boolean;
  weaponSlot: 0 | 1 | 2 | null;
};

type Stick = { x: number; y: number; active: boolean; pointerId: number | null };

export type InputController = {
  attach: (el: HTMLElement) => void;
  detach: () => void;
  sample: (invertY: boolean) => Actions;
  consumeMouse: () => { dx: number; dy: number };
  setKeys: (codes: string[]) => void;
  setSteer: (v: number) => void;
  leftStick: Stick;
  rightStick: Stick;
  setLeftStick: (x: number, y: number, active: boolean) => void;
  setRightStick: (x: number, y: number, active: boolean) => void;
  setTouchFire: (v: boolean) => void;
  setTouchDetonate: (v: boolean) => void;
  requestLock: () => void;
  isLocked: () => boolean;
  keys: Set<string>;
};

const GAME_CODES = new Set([
  "KeyW",
  "KeyA",
  "KeyS",
  "KeyD",
  "KeyQ",
  "KeyE",
  "KeyR",
  "KeyF",
  "KeyC",
  "KeyX",
  "KeyG",
  "Space",
  "ShiftLeft",
  "ControlLeft",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Digit1",
  "Digit2",
  "Digit3",
  "KeyP",
  "Enter",
  "Escape",
]);

export function createInput(): InputController {
  const keys = new Set<string>();
  const synthetic = new Set<string>();
  let steerOverride: number | null = null;
  let mouseDX = 0;
  let mouseDY = 0;
  let locked = false;
  let fireHeld = false;
  let touchFire = false;
  let touchDetonate = false;
  let host: HTMLElement | null = null;
  let prevPause = false;

  const leftStick: Stick = { x: 0, y: 0, active: false, pointerId: null };
  const rightStick: Stick = { x: 0, y: 0, active: false, pointerId: null };

  function mergedHas(code: string): boolean {
    return keys.has(code) || synthetic.has(code);
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.repeat) {
      if (GAME_CODES.has(e.code)) e.preventDefault();
      return;
    }
    keys.add(e.code);
    if (GAME_CODES.has(e.code)) e.preventDefault();
  }

  function onKeyUp(e: KeyboardEvent) {
    keys.delete(e.code);
  }

  function clearKeys() {
    keys.clear();
    fireHeld = false;
  }

  function onMouseMove(e: MouseEvent) {
    if (!locked) return;
    mouseDX += e.movementX;
    mouseDY += e.movementY;
  }

  function onMouseDown(e: MouseEvent) {
    if (e.button === 0) fireHeld = true;
  }

  function onMouseUp(e: MouseEvent) {
    if (e.button === 0) fireHeld = false;
  }

  function onLockChange() {
    locked = document.pointerLockElement === host;
  }

  function attach(el: HTMLElement) {
    host = el;
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", clearKeys);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) clearKeys();
    });
    window.addEventListener("mousemove", onMouseMove);
    el.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    document.addEventListener("pointerlockchange", onLockChange);
  }

  function detach() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", clearKeys);
    window.removeEventListener("mousemove", onMouseMove);
    window.removeEventListener("mouseup", onMouseUp);
    document.removeEventListener("pointerlockchange", onLockChange);
    if (host) host.removeEventListener("mousedown", onMouseDown);
    host = null;
    clearKeys();
    synthetic.clear();
  }

  function sample(invertY: boolean): Actions {
    let throttle = 0;
    if (mergedHas("KeyW")) throttle += 1;
    if (mergedHas("KeyS")) throttle -= 1;
    if (mergedHas("KeyR") || mergedHas("Space")) throttle += 0.35;
    if (mergedHas("KeyF") || mergedHas("KeyC") || mergedHas("ControlLeft")) throttle -= 0.35;
    throttle += leftStick.y;
    throttle = Math.max(-1, Math.min(1, throttle));

    let yaw = 0;
    if (mergedHas("KeyA")) yaw += 1;
    if (mergedHas("KeyD")) yaw -= 1;
    yaw -= leftStick.x;
    if (steerOverride !== null) yaw = steerOverride;
    yaw = Math.max(-1, Math.min(1, yaw));

    let pitch = 0;
    if (mergedHas("ArrowUp")) pitch -= 1;
    if (mergedHas("ArrowDown")) pitch += 1;
    pitch -= rightStick.y * (invertY ? -1 : 1);
    pitch = Math.max(-1, Math.min(1, pitch));

    let roll = 0;
    if (mergedHas("ArrowLeft") || mergedHas("KeyQ")) roll += 1;
    if (mergedHas("ArrowRight") || mergedHas("KeyE")) roll -= 1;
    roll -= rightStick.x;
    roll = Math.max(-1, Math.min(1, roll));

    const pauseNow = mergedHas("KeyP") || mergedHas("Enter") || mergedHas("Escape");
    const pausePress = pauseNow && !prevPause;
    prevPause = pauseNow;

    let weaponSlot: 0 | 1 | 2 | null = null;
    if (mergedHas("Digit1")) weaponSlot = 0;
    else if (mergedHas("Digit2")) weaponSlot = 1;
    else if (mergedHas("Digit3")) weaponSlot = 2;

    const fire = fireHeld || touchFire || mergedHas("ShiftLeft");
    const detonate = touchDetonate || mergedHas("KeyX") || mergedHas("KeyG");

    return {
      throttle,
      yaw,
      pitch,
      roll,
      boost: mergedHas("Space"),
      fire,
      detonate,
      crouch: mergedHas("KeyC") || mergedHas("ControlLeft"),
      pausePress,
      weaponSlot,
    };
  }

  function consumeMouse() {
    const out = { dx: mouseDX, dy: mouseDY };
    mouseDX = 0;
    mouseDY = 0;
    return out;
  }

  function requestLock() {
    if (!host) return;
    const req = host.requestPointerLock?.bind(host);
    if (!req) return;
    try {
      const p = req({ unadjustedMovement: true } as PointerLockOptions);
      if (p && typeof (p as Promise<void>).catch === "function") {
        (p as Promise<void>).catch(() => {
          host?.requestPointerLock?.();
        });
      }
    } catch {
      host.requestPointerLock?.();
    }
  }

  return {
    attach,
    detach,
    sample,
    consumeMouse,
    setKeys: (codes) => {
      synthetic.clear();
      for (const c of codes) synthetic.add(c);
    },
    setSteer: (v) => {
      steerOverride = v;
    },
    leftStick,
    rightStick,
    setLeftStick: (x, y, active) => {
      const d = radialDeadzone(x, y);
      leftStick.x = d.x;
      leftStick.y = d.y;
      leftStick.active = active;
    },
    setRightStick: (x, y, active) => {
      const d = radialDeadzone(x, y);
      rightStick.x = d.x;
      rightStick.y = d.y;
      rightStick.active = active;
    },
    setTouchFire: (v) => {
      touchFire = v;
    },
    setTouchDetonate: (v) => {
      touchDetonate = v;
    },
    requestLock,
    isLocked: () => locked,
    keys,
  };
}
