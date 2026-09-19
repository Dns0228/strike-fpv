import { create } from "zustand";
import type { Armor, GameMode, GroundUnit, TargetKind, WeaponId } from "./catalog";
import { SETTINGS_KEY, WEAPONS } from "./catalog";
import { parseMode } from "./modes";

export type Phase = "hangar" | "flight" | "pause" | "dead" | "victory" | "replay";

export type LockInfo = {
  label: string;
  kind: TargetKind;
  armor: Armor;
  hp: number;
  maxHp: number;
  dist: number;
  screenX: number;
  screenY: number;
  expected: number;
  weapon: WeaponId;
};

export type FloatText = {
  id: number;
  text: string;
  x: number;
  y: number;
  born: number;
  kind: "hit" | "kill" | "info";
};

export type RadarBlip = {
  id: number;
  x: number;
  z: number;
  armor: Armor;
  alive: boolean;
};

export type ReplayHudInfo = {
  label: string;
  armor: Armor;
  damage: number;
  kill: boolean;
  weapon: WeaponId | "kami";
  hp: number;
  maxHp: number;
  secondary: number;
  impacted: boolean;
};

export type GameHud = {
  phase: Phase;
  mode: GameMode;
  unit: GroundUnit;
  weapon: WeaponId;
  ammo: Record<WeaponId, number>;
  lives: number;
  battery: number;
  altitude: number;
  speed: number;
  heading: number;
  score: number;
  best: number;
  bestGround: number;
  destroyed: number;
  totalTargets: number;
  lock: LockInfo | null;
  floats: FloatText[];
  hitFlash: number;
  message: string;
  invertY: boolean;
  shake: boolean;
  muted: boolean;
  tod: "day" | "night";
  blips: RadarBlip[];
  droneX: number;
  droneZ: number;
  detect: number;
  locked: boolean;
  conceal: number;
  goalDist: number;
  hunters: number;
  wave: number;
  waves: number;
  breaches: number;
  breachMax: number;
  replay: ReplayHudInfo | null;
  patch: (partial: Partial<Omit<GameHud, "patch">>) => void;
};

function emptyAmmo(): Record<WeaponId, number> {
  return {
    frag: WEAPONS.frag.ammo,
    he: WEAPONS.he.ammo,
    ap: WEAPONS.ap.ammo,
  };
}

function persistSettings() {
  if (typeof localStorage === "undefined") return;
  const st = useGameStore.getState();
  localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      invertY: st.invertY,
      muted: st.muted,
      shake: st.shake,
      mode: st.mode,
      unit: st.unit,
      tod: st.tod,
    }),
  );
}

export function loadSettings(): void {
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return;
    const s = JSON.parse(raw) as {
      invertY?: boolean;
      muted?: boolean;
      shake?: boolean;
      mode?: GameMode;
      unit?: GroundUnit;
      tod?: "day" | "night";
    };
    useGameStore.getState().patch({
      invertY: !!s.invertY,
      muted: !!s.muted,
      shake: s.shake !== false,
      mode: parseMode(s.mode),
      unit: s.unit === "jeep" ? "jeep" : "soldier",
      tod: s.tod === "night" ? "night" : "day",
    });
  } catch {
    /* ignore */
  }
}

export const useGameStore = create<GameHud>((set) => ({
  phase: "hangar",
  mode: "arcade",
  unit: "soldier",
  weapon: "he",
  ammo: emptyAmmo(),
  lives: 3,
  battery: 100,
  altitude: 0,
  speed: 0,
  heading: 0,
  score: 0,
  best: 0,
  bestGround: 0,
  destroyed: 0,
  totalTargets: 0,
  lock: null,
  floats: [],
  hitFlash: 0,
  message: "",
  invertY: false,
  shake: true,
  muted: false,
  tod: "day",
  blips: [],
  droneX: 0,
  droneZ: 0,
  detect: 0,
  locked: false,
  conceal: 0,
  goalDist: 0,
  hunters: 0,
  wave: 1,
  waves: 3,
  breaches: 0,
  breachMax: 3,
  replay: null,
  patch: (partial) => {
    set(partial);
    if (
      "invertY" in partial ||
      "muted" in partial ||
      "shake" in partial ||
      "mode" in partial ||
      "unit" in partial ||
      "tod" in partial
    ) {
      persistSettings();
    }
  },
}));

export function refillAmmo(): Record<WeaponId, number> {
  return emptyAmmo();
}
