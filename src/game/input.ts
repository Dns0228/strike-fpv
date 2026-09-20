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
  scanPress: boolean;
  visionPress: boolean;
  assist: boolean;
};

type Stick = { x: number; y: number; active: boolean; pointerId: number | null };

export type InputController = {
  attach: (el: HTMLElement) => void;
  detach: () => void;
  sample: (invertY: boolean, ground?: boolean) => Actions;
  consumeMouse: () => { dx: number; dy: number };
  setKeys: (codes: string[]) => void;
  setSteer: (v: number) => void;
  setAssist: (v: boolean) => void;
  leftStick: Stick;
  rightStick: Stick;
  setLeftStick: (x: number, y: number, active: boolean) => void;
  setRightStick: (x: number, y: number, active: boolean) => void;
  setTouchFire: (v: boolean) => void;
  setTouchDetonate: (v: boolean) => void;
  setTouchBoost: (v: boolean) => void;
  setTouchCrouch: (v: boolean) => void;
  setTouchScan: () => void;
  setTouchVision: () => void;
  requestLock: () => void;
  isLocked: () => boolean;
  padConnected: () => boolean;
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
  "KeyT",
  "KeyV",
  "KeyN",
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

function isCoarse(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(hover: none)").matches;
}

function btn(pad: Gamepad, i: number): boolean {
  return !!pad.buttons[i]?.pressed;
}

function trig(pad: Gamepad, i: number): number {
  return pad.buttons[i]?.value ?? 0;
}

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
  let touchBoost = false;
  let touchCrouch = false;
  let touchScan = false;
  let touchVision = false;
  let host: HTMLElement | null = null;
  let prevPause = false;
  let prevScan = false;
  let prevVision = false;
  let prevLB = false;
  let prevRB = false;
  let padWeapon = 1 as 0 | 1 | 2;
  let padOn = false;
  let assist = true;

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
    touchFire = false;
    touchDetonate = false;
    touchBoost = false;
    touchCrouch = false;
    touchScan = false;
    touchVision = false;
    padOn = false;
  }

  function readPad(ground: boolean): {
    lx: number;
    ly: number;
    rx: number;
    ry: number;
    fire: boolean;
    boost: boolean;
    detonate: boolean;
    crouch: boolean;
    pause: boolean;
    scan: boolean;
    vision: boolean;
    slot: 0 | 1 | 2 | null;
  } {
    const empty = {
      lx: 0,
      ly: 0,
      rx: 0,
      ry: 0,
      fire: false,
      boost: false,
      detonate: false,
      crouch: false,
      pause: false,
      scan: false,
      vision: false,
      slot: null as 0 | 1 | 2 | null,
    };
    if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
      padOn = false;
      return empty;
    }
    let pad: Gamepad | null = null;
    try {
      const list = navigator.getGamepads();
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p && p.connected) {
          pad = p;
          break;
        }
      }
    } catch {
      padOn = false;
      return empty;
    }
    padOn = !!pad;
    if (!pad) return empty;

    const l = radialDeadzone(pad.axes[0] || 0, pad.axes[1] || 0, 0.18);
    const r = radialDeadzone(pad.axes[2] || 0, pad.axes[3] || 0, 0.18);
    const a = btn(pad, 0);
    const b = btn(pad, 1);
    const x = btn(pad, 2);
    const y = btn(pad, 3);
    const lb = btn(pad, 4);
    const rb = btn(pad, 5);
    const lt = trig(pad, 6);
    const rt = trig(pad, 7);
    const start = btn(pad, 9);
    const select = btn(pad, 8) || btn(pad, 11);
    const dL = btn(pad, 14);
    const dR = btn(pad, 15);
    const dU = btn(pad, 12);

    let slot: 0 | 1 | 2 | null = null;
    if (dU) slot = 1;
    else if (dL) slot = 0;
    else if (dR) slot = 2;
    else if (lb && !prevLB) {
      padWeapon = ((padWeapon + 2) % 3) as 0 | 1 | 2;
      slot = padWeapon;
    } else if (rb && !prevRB) {
      padWeapon = ((padWeapon + 1) % 3) as 0 | 1 | 2;
      slot = padWeapon;
    }
    prevLB = lb;
    prevRB = rb;

    return {
      lx: l.x,
      ly: -l.y,
      rx: r.x,
      ry: -r.y,
      fire: ground ? false : a || rt > 0.35,
      boost: ground ? a || lt > 0.35 || rt > 0.35 : lt > 0.35,
      detonate: !ground && (b || x),
      crouch: ground && (b || x),
      pause: start,
      scan: y,
      vision: select,
      slot,
    };
  }

  function sample(invertY: boolean, ground = false): Actions {
    const pad = readPad(ground);

    let throttle = 0;
    if (mergedHas("KeyW")) throttle += 1;
    if (mergedHas("KeyS")) throttle -= 1;
    if (mergedHas("KeyR") || mergedHas("Space")) throttle += 0.35;
    if (mergedHas("KeyF") || mergedHas("KeyC") || mergedHas("ControlLeft")) throttle -= 0.35;
    throttle += leftStick.y + pad.ly;
    throttle = Math.max(-1, Math.min(1, throttle));

    let yaw = 0;
    if (mergedHas("KeyA")) yaw += 1;
    if (mergedHas("KeyD")) yaw -= 1;
    yaw -= leftStick.x + pad.lx;
    if (steerOverride !== null) yaw = steerOverride;
    yaw = Math.max(-1, Math.min(1, yaw));

    let pitch = 0;
    if (mergedHas("ArrowUp")) pitch -= 1;
    if (mergedHas("ArrowDown")) pitch += 1;
    pitch -= (rightStick.y + pad.ry) * (invertY ? -1 : 1);
    pitch = Math.max(-1, Math.min(1, pitch));

    let roll = 0;
    if (mergedHas("ArrowLeft") || mergedHas("KeyQ")) roll += 1;
    if (mergedHas("ArrowRight") || mergedHas("KeyE")) roll -= 1;
    roll -= rightStick.x + pad.rx;
    roll = Math.max(-1, Math.min(1, roll));

    const pauseNow = mergedHas("KeyP") || mergedHas("Enter") || mergedHas("Escape") || pad.pause;
    const pausePress = pauseNow && !prevPause;
    prevPause = pauseNow;

    const scanNow = mergedHas("KeyT") || mergedHas("KeyV") || pad.scan || touchScan;
    const scanPress = scanNow && !prevScan;
    prevScan = scanNow;
    touchScan = false;

    const visionNow = mergedHas("KeyN") || pad.vision || touchVision;
    const visionPress = visionNow && !prevVision;
    prevVision = visionNow;
    touchVision = false;

    let weaponSlot: 0 | 1 | 2 | null = null;
    if (mergedHas("Digit1")) weaponSlot = 0;
    else if (mergedHas("Digit2")) weaponSlot = 1;
    else if (mergedHas("Digit3")) weaponSlot = 2;
    else if (pad.slot !== null) weaponSlot = pad.slot;
    if (weaponSlot !== null) padWeapon = weaponSlot;

    const fire = fireHeld || touchFire || mergedHas("ShiftLeft") || pad.fire;
    const detonate = touchDetonate || mergedHas("KeyX") || mergedHas("KeyG") || pad.detonate;

    return {
      throttle,
      yaw,
      pitch,
      roll,
      boost: mergedHas("Space") || touchBoost || pad.boost,
      fire,
      detonate,
      crouch: mergedHas("KeyC") || mergedHas("ControlLeft") || touchCrouch || pad.crouch,
      pausePress,
      weaponSlot,
      scanPress,
      visionPress,
      assist,
    };
  }

  function consumeMouse() {
    const out = { dx: mouseDX, dy: mouseDY };
    mouseDX = 0;
    mouseDY = 0;
    return out;
  }

  function requestLock() {
    if (!host || isCoarse()) return;
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
    setAssist: (v) => {
      assist = v;
    },
    leftStick,
    rightStick,
    setLeftStick: (x, y, active) => {
      const d = radialDeadzone(x, y, 0.12);
      leftStick.x = d.x;
      leftStick.y = d.y;
      leftStick.active = active;
      if (!active) {
        leftStick.x = 0;
        leftStick.y = 0;
      }
    },
    setRightStick: (x, y, active) => {
      const d = radialDeadzone(x, y, 0.12);
      rightStick.x = d.x;
      rightStick.y = d.y;
      rightStick.active = active;
      if (!active) {
        rightStick.x = 0;
        rightStick.y = 0;
      }
    },
    setTouchFire: (v) => {
      touchFire = v;
    },
    setTouchDetonate: (v) => {
      touchDetonate = v;
    },
    setTouchBoost: (v) => {
      touchBoost = v;
    },
    setTouchCrouch: (v) => {
      touchCrouch = v;
    },
    setTouchScan: () => {
      touchScan = true;
    },
    setTouchVision: () => {
      touchVision = true;
    },
    requestLock,
    isLocked: () => locked,
    padConnected: () => padOn,
    keys,
  };
}
